/**
 * tactical-loader.ts — 即时战术装载器 (JIT Tactical Loader)
 *
 * 核心功能：
 * 1. 索引可选的外部实战技能包与安全规约（支持按需接入外部攻防战术库）
 * 2. 支持按需即时检索（JIT Retrieval）与动态切片装载，避免将全部文档无脑灌入 Prompt 导致上下文爆炸。
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = join(EXT_DIR, "..", "skills");

export interface TacticalEntry {
	name: string;
	theater: "recon" | "rules" | "intranet" | "web" | "special";
	title: string;
	summary: string;
	filePath: string;
}

let cachedIndex: TacticalEntry[] | null = null;

function buildIndex(): TacticalEntry[] {
	const entries: TacticalEntry[] = [];
	if (!existsSync(SKILLS_ROOT)) return entries;

	// 1. 测绘与信息搜集管线 (若存在)
	for (const sub of ["recon", "asset-recon"]) {
		const reconSkill = join(SKILLS_ROOT, sub, "SKILL.md");
		if (existsSync(reconSkill)) {
			entries.push({
				name: "recon-pipeline",
				theater: "recon",
				title: "全量信息搜集与攻击面测绘总编排",
				summary: "找资产(三平台/子域/股权/供应链) + 认指纹 + 扫端口 + 资产展开降噪 + 11-Sheet台账交付",
				filePath: reconSkill,
			});
			break;
		}
	}

	// 2. 外部战术规约库 (若用户外挂了规约目录)
	for (const sub of ["tactics", "xt", "custom-rules"]) {
		const rulesDir = join(SKILLS_ROOT, sub, "rules");
		if (existsSync(rulesDir)) {
			try {
				for (const f of readdirSync(rulesDir)) {
					if (!f.endsWith(".md")) continue;
					const full = join(rulesDir, f);
					entries.push({
						name: `rule-${f.replace(".md", "")}`,
						theater: "rules",
						title: `作战规约：${f}`,
						summary: `实战作战规约与安全测试方法论（${f}）`,
						filePath: full,
					});
				}
			} catch {
				// ignore
			}
		}

		// 3. 外部战术单元 (若用户外挂了战区技能)
		const subSkillsDir = join(SKILLS_ROOT, sub, "skills");
		if (existsSync(subSkillsDir)) {
			try {
				for (const dirName of readdirSync(subSkillsDir)) {
					const dirPath = join(subSkillsDir, dirName);
					if (!statSync(dirPath).isDirectory()) continue;
					let targetFile = join(dirPath, "SKILL.md");
					if (!existsSync(targetFile)) targetFile = join(dirPath, "README.md");
					if (!existsSync(targetFile)) continue;

					let theater: TacticalEntry["theater"] = "web";
					if (
						dirName.includes("active-directory") ||
						dirName.includes("lateral") ||
						dirName.includes("tunnel") ||
						dirName.includes("privilege") ||
					dirName.includes("ntlm") ||
					dirName.includes("kubernetes") ||
					dirName.includes("container-escape")
				) {
					theater = "intranet";
				} else if (dirName.includes("recon") || dirName.includes("fofo") || dirName.includes("hunter") || dirName.includes("infogather")) {
					theater = "recon";
				}

				entries.push({
					name: dirName,
					theater,
					title: dirName.replace(/-/g, " "),
					summary: `${theater === "intranet" ? "【内网横向/特战】" : "【战术攻坚】"} ${dirName}`,
					filePath: targetFile,
				});
				}
			} catch {
				// ignore
			}
		}
	}

	return entries;
}

const ALIASES: Record<string, string[]> = {
	// --- 外网打点与边界穿透 (External Initial Access & Perimeter Break-in) ---
	打点: ["recon-and-methodology", "upload-insecure-files", "cmdi-command-injection", "deserialization-insecure"],
	边界: ["recon-and-methodology", "waf-bypass-techniques", "api-recon-and-docs"],
	upload: ["upload-insecure-files"],
	上传: ["upload-insecure-files"],
	webshell: ["upload-insecure-files", "reverse-shell-techniques"],
	反序列化: ["deserialization-insecure", "jndi-injection"],
	fastjson: ["deserialization-insecure", "jndi-injection"],
	shiro: ["deserialization-insecure"],
	log4j: ["jndi-injection"],
	ssrf: ["ssrf-server-side-request-forgery"],
	ssti: ["ssti-server-side-template-injection", "expression-language-injection"],
	spel: ["expression-language-injection"],
	rce: ["cmdi-command-injection", "arbitrary-write-to-rce"],
	sqli: ["sqli-sql-injection"],
	注入: ["sqli-sql-injection", "cmdi-command-injection"],
	未授权: ["unauthorized-access-common-services", "authbypass-authentication-flaws"],
	越权: ["idor-broken-object-authorization", "api-authorization-and-bola"],
	xss: ["xss-cross-site-scripting"],
	bypass: ["401-403-bypass-techniques", "waf-bypass-techniques"],
	waf: ["waf-bypass-techniques", "401-403-bypass-techniques"],
	403: ["401-403-bypass-techniques"],
	走私: ["request-smuggling", "http2-specific-attacks"],
	转子: ["recon-pipeline", "infogather"],
	js: ["recon-pipeline", "infogather", "api-recon-and-docs"],
	测绘: ["recon-pipeline", "fofoapi", "hunter-qianxin", "quake"],
		子域: ["recon-pipeline", "subdomain-takeover"],

		// --- 穿透、提权与内网横向 (Pivoting, Privilege Escalation & Lateral Movement) ---
		adcs: ["active-directory-certificate-services", "certipy", "certificate", "esc1", "esc8"],
		esc1: ["active-directory-certificate-services", "certipy"],
		pth: ["windows-lateral-movement", "ntlm-relay-coercion", "netexec"],
		ntlm: ["windows-lateral-movement", "ntlm-relay-coercion", "netexec"],
		smb: ["windows-lateral-movement", "unauthorized-access-common-services", "netexec"],
		rdp: ["windows-lateral-movement"],
		kerberos: ["active-directory-kerberos-attacks", "asreproast", "kerberoast", "golden-ticket"],
		ticket: ["active-directory-kerberos-attacks"],
		dcsync: ["active-directory-kerberos-attacks", "active-directory-acl-abuse"],
		privesc: ["windows-privilege-escalation", "linux-privilege-escalation"],
		提权: ["windows-privilege-escalation", "linux-privilege-escalation"],
		tunnel: ["tunneling-and-pivoting", "chisel", "frp", "proxychains"],
		隧道: ["tunneling-and-pivoting", "chisel", "frp", "proxychains"],
		lateral: ["windows-lateral-movement", "linux-lateral-movement", "wmiexec"],
		横向: ["windows-lateral-movement", "linux-lateral-movement", "wmiexec"],
		域控: ["active-directory-kerberos-attacks", "active-directory-certificate-services", "active-directory-acl-abuse"],
	};

	const queryCache = new Map<string, TacticalEntry[]>();

	/**
	 * 检索战术知识库 (带 LRU 内存缓存与同义词扩展)
	 */
	export function searchTactics(query: string, limit = 4): TacticalEntry[] {
		const cacheKey = `${query.toLowerCase().trim()}:${limit}`;
		if (queryCache.has(cacheKey)) {
			return queryCache.get(cacheKey)!;
		}

		if (!cachedIndex) cachedIndex = buildIndex();
		const q = query.toLowerCase().trim();
		const tokens = new Set<string>(q.split(/[\s,+/_-]+/).filter((t) => t.length >= 1));

		// 别名与缩写扩展
		for (const [k, expansions] of Object.entries(ALIASES)) {
			if (q.includes(k) || tokens.has(k)) {
				for (const exp of expansions) tokens.add(exp);
			}
		}

		const scored = cachedIndex.map((entry) => {
			let score = 0;
			const nameLow = entry.name.toLowerCase();
			const summaryLow = entry.summary.toLowerCase();

			for (const t of tokens) {
				if (nameLow === t) score += 30;
				else if (nameLow.includes(t)) score += 15;
				if (summaryLow.includes(t)) score += 8;
			}

			// 领域加权
			if ((q.includes("内网") || q.includes("域") || q.includes("横向") || q.includes("pth") || q.includes("adcs")) && entry.theater === "intranet") {
				score += 15;
			}
			if ((q.includes("测绘") || q.includes("信息收集") || q.includes("资产")) && entry.theater === "recon") {
				score += 15;
			}

			return { entry, score };
		});

		const result = scored
			.filter((s) => s.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((s) => s.entry);

		queryCache.set(cacheKey, result);
		return result;
	}

/**
 * 结构感知智能切片 (Section-Aware Excerpting)
 * 优先保留 SOP、Playbook、Payload、Bypass 核心代码块与高价值实战小节，
 * 剔除冗长的前置免责/概述/参考链接，在有限 Token 内输出最高密度实战价值。
 */
export function extractTacticalSections(markdown: string, maxLength = 3500): string {
	// 1. 去除 frontmatter
	let text = markdown.replace(/^---[\s\S]*?---\s*/, "").trim();
	if (text.length <= maxLength) return text;

	// 2. 按 Markdown 二级标题分块
	const sections = text.split(/(?=\n##\s+)/);
	if (sections.length <= 1) {
		return text.slice(0, maxLength) + "\n\n... [战术文档截断，完整正本见原文件]";
	}

	interface ScoredSection {
		raw: string;
		title: string;
		score: number;
		hasCode: boolean;
	}

	const scoredSections: ScoredSection[] = sections.map((sec, idx) => {
		const lines = sec.trim().split("\n");
		const title = lines[0] || "";
		const lowerTitle = title.toLowerCase();
		const hasCode = sec.includes("```");
		let score = 0;

		// 核心实战关键词极大加权
		if (
			lowerTitle.includes("sop") ||
			lowerTitle.includes("playbook") ||
			lowerTitle.includes("bypass") ||
			lowerTitle.includes("attack") ||
			lowerTitle.includes("exploit") ||
			lowerTitle.includes("payload") ||
			lowerTitle.includes("command") ||
			lowerTitle.includes("实战") ||
			lowerTitle.includes("利用") ||
			lowerTitle.includes("绕过") ||
			lowerTitle.includes("命令") ||
			lowerTitle.includes("手法") ||
			lowerTitle.includes("技巧")
		) {
			score += 50;
		}

		if (hasCode) score += 30; // 包含实战命令/代码块优先

		// 纯参考/免责/防御降权
		if (
			lowerTitle.includes("related") ||
			lowerTitle.includes("reference") ||
			lowerTitle.includes("defense") ||
			lowerTitle.includes("remediation") ||
			lowerTitle.includes("防御") ||
			lowerTitle.includes("修复") ||
			lowerTitle.includes("免责")
		) {
			score -= 40;
		}

		// 保持前置首章的一定权重（概览/架构）
		if (idx === 0) score += 15;

		return { raw: sec.trim(), title, score, hasCode };
	});

	// 按原始顺序与分数挑选组合
	const selected: string[] = [];
	let currentLen = 0;

	// 首先如果首章是高概括性内容（且不长），保留作为背景
	if (scoredSections[0] && scoredSections[0].raw.length < 800) {
		selected.push(scoredSections[0].raw);
		currentLen += scoredSections[0].raw.length;
	}

	// 将其余章节按分数从高到低排序候选
	const candidates = scoredSections
		.slice(1)
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score);

	for (const cand of candidates) {
		if (currentLen + cand.raw.length + 20 <= maxLength) {
			selected.push(cand.raw);
			currentLen += cand.raw.length + 20;
		} else {
			// 尝试切出前 800 字符
			const remaining = maxLength - currentLen - 50;
			if (remaining > 300) {
				selected.push(cand.raw.slice(0, remaining) + "\n... [小节截断]");
				currentLen += remaining;
			}
			break;
		}
	}

	if (selected.length === 0) {
		return text.slice(0, maxLength) + "\n\n... [战术文档截断，完整正本见原文件]";
	}

	return selected.join("\n\n---\n\n") + "\n\n... [高精 SOP 战术摘录完毕]";
}

/**
 * 读取战术文档核心实战内容（结构感知智能提取 SOP / Payload 核心小节）
 */
export function readTacticalSOP(entry: TacticalEntry, maxLength = 3500): string {
	try {
		const raw = readFileSync(entry.filePath, "utf8");
		return extractTacticalSections(raw, maxLength);
	} catch (e) {
		return `读取战术失败: ${e}`;
	}
}
