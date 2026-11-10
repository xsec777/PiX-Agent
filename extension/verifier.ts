/**
 * verifier.ts — 候选漏洞二次差分自动复测校验器 (Differential Finding Verifier)
 *
 * 核心哲学（借鉴 ARTEX Retester 与 LuaN1ao 因果推理）：
 *   “大模型极易因单次网络抖动、偶发 500 报错或通用 403 页面产生假阳性幻觉”
 *
 * 核心机制：
 * 1. 当模型发现疑似漏洞（SQLi/未授权/逻辑绕过）时，触发机械化二次真假特征反转探测；
 * 2. 自动化发送 Baseline 请求与 Inverted 异常请求，比对：
 *    - 状态码差分 (HTTP Status Diff)
 *    - 响应体长度波动率 (Length Delta > 15%)
 *    - 报错与回显关键词指纹 (Regex Keyword Signatures)
 *    - 时延差分 (Time Delay > 4000ms 用于时间盲注实证)；
 * 3. 差分坐实后，自动格式化并输出不可篡改的 evidenceRequest 与 evidenceResponse，
 *    供 record_fact / update_endpoint 直接绑定存证。
 */

export interface VerificationProbe {
	targetUrl: string;
	method?: "GET" | "POST";
	vulnType: "sqli_boolean" | "sqli_time" | "auth_bypass" | "idor" | "generic";
	truePayload: string;
	falsePayload?: string;
	headers?: Record<string, string>;
	bodyTemplate?: string;
}

export interface VerificationVerdict {
	reproduced: boolean;
	verdict: "confirmed" | "inconclusive" | "rejected";
	confidence: "high" | "medium" | "low";
	summary: string;
	evidenceRequest?: string;
	evidenceResponse?: string;
	diffSignature?: string;
}

/** 常见 SQL 数据库报错特征指纹库 */
const SQL_ERROR_PATTERNS = [
	/you have an error in your sql syntax/i,
	/warning: mysql_/i,
	/unclosed quotation mark after the character string/i,
	/quoted string not properly terminated/i,
	/pg_query\(\): query failed/i,
	/sqlite3::query/i,
	/microsoft ole db provider for sql server/i,
	/ora-00933: sql command not properly ended/i,
];

/** 评估两次 HTTP 探针响应的机械差分 */
export function evaluateDifferential(
	probe: VerificationProbe,
	trueResp: { status: number; body: string; timeMs: number },
	falseResp?: { status: number; body: string; timeMs: number },
): VerificationVerdict {
	// 1. 时间盲注机械差分判定
	if (probe.vulnType === "sqli_time") {
		const delayThresholdMs = 4000;
		if (trueResp.timeMs >= delayThresholdMs) {
			const baselineTime = falseResp ? falseResp.timeMs : 500;
			if (trueResp.timeMs - baselineTime >= 3500) {
				return {
					reproduced: true,
					verdict: "confirmed",
					confidence: "high",
					summary: `时间盲注差分坐实：延时探针触发 ${trueResp.timeMs}ms (基线: ${baselineTime}ms，有效时延差 > 3500ms)`,
					diffSignature: `TimeDelay_${trueResp.timeMs}ms_vs_${baselineTime}ms`,
					evidenceRequest: `${probe.method || "GET"} ${probe.targetUrl} (Payload: ${probe.truePayload})`,
					evidenceResponse: `HTTP ${trueResp.status} OK [Time: ${trueResp.timeMs}ms, 确认达到强制延时阈值]`,
				};
			}
		}
		return {
			reproduced: false,
			verdict: "inconclusive",
			confidence: "low",
			summary: `时延未达预期：探测时延 ${trueResp.timeMs}ms 未突破 4000ms 阈值`,
		};
	}

	// 2. 报错注入指纹匹配
	for (const pat of SQL_ERROR_PATTERNS) {
		if (pat.test(trueResp.body)) {
			const hit = trueResp.body.match(pat)?.[0] || "SQL Error";
			return {
				reproduced: true,
				verdict: "confirmed",
				confidence: "high",
				summary: `数据库底层报错特征确证：命中指纹「${hit}」`,
				diffSignature: `SQL_Error_Pattern_${hit.slice(0, 20)}`,
				evidenceRequest: `${probe.method || "GET"} ${probe.targetUrl} (Payload: ${probe.truePayload})`,
				evidenceResponse: `HTTP ${trueResp.status}\n${trueResp.body.slice(0, 300)}...`,
			};
		}
	}

	// 3. 布尔盲注 / 逻辑绕过 真假差分比对 (True vs False)
	if (falseResp) {
		const statusDiff = trueResp.status !== falseResp.status;
		const lenDiff = Math.abs(trueResp.body.length - falseResp.body.length);
		const baseLen = Math.max(1, falseResp.body.length);
		const changeRate = (lenDiff / baseLen) * 100;

		// 状态码差分 (例如 200 vs 403 / 500)
		if (statusDiff && (trueResp.status === 200 || falseResp.status === 200)) {
			return {
				reproduced: true,
				verdict: "confirmed",
				confidence: "high",
				summary: `状态码显式差分坐实：真探针返回 HTTP ${trueResp.status}，假探针返回 HTTP ${falseResp.status}`,
				diffSignature: `StatusDiff_${trueResp.status}_vs_${falseResp.status}`,
				evidenceRequest: `[TRUE] ${probe.targetUrl} (Payload: ${probe.truePayload})\n[FALSE] (Payload: ${probe.falsePayload})`,
				evidenceResponse: `[TRUE HTTP ${trueResp.status}] 长度 ${trueResp.body.length} 字节\n[FALSE HTTP ${falseResp.status}] 长度 ${falseResp.body.length} 字节`,
			};
		}

		// 响应体长度波动率 > 20%
		if (changeRate >= 20) {
			return {
				reproduced: true,
				verdict: "confirmed",
				confidence: "medium",
				summary: `布尔内容差分坐实：真假探针长度变化率达 ${changeRate.toFixed(1)}% (真: ${trueResp.body.length}B, 假: ${falseResp.body.length}B)`,
				diffSignature: `LengthChange_${changeRate.toFixed(1)}%`,
				evidenceRequest: `[TRUE] ${probe.targetUrl}\nPayload: ${probe.truePayload}`,
				evidenceResponse: `[TRUE Length] ${trueResp.body.length} Bytes vs [FALSE Length] ${falseResp.body.length} Bytes`,
			};
		}

		// 两次完全一致，说明参数被无害化过滤
		if (!statusDiff && lenDiff === 0) {
			return {
				reproduced: false,
				verdict: "rejected",
				confidence: "high",
				summary: "真假探针响应完全对称一致，未发现任何逻辑分支分化，漏洞被有效防御",
			};
		}
	}

	return {
		reproduced: false,
		verdict: "inconclusive",
		confidence: "low",
		summary: "响应差分未达到确定性门槛（无状态码分化且长度波动 < 20%），建议流转至 bypassing 深入变异",
	};
}
