import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = join(EXT_DIR, "..", "skills");

export interface TacticalEntry {
	name: string;
	theater: "recon" | "rules" | "intranet" | "web";
	title: string;
	summary: string;
	filePath: string;
}

let cachedIndex: TacticalEntry[] | null = null;

function buildIndex(): TacticalEntry[] {
	const entries: TacticalEntry[] = [];
	if (!existsSync(SKILLS_ROOT)) return entries;

	for (const sub of ["recon", "asset-recon"]) {
		const reconSkill = join(SKILLS_ROOT, sub, "SKILL.md");
		if (existsSync(reconSkill)) {
			entries.push({ name: "recon-pipeline", theater: "recon", title: "全量信息搜集与攻击面测绘总编排", summary: "找资产(三平台/子域/股权/供应链) + 认指纹 + 扫端口 + 资产展开降噪 + 11-Sheet台账交付", filePath: reconSkill });
			break;
		}
	}

	for (const sub of ["tactics", "xt", "custom-rules"]) {
		const rulesDir = join(SKILLS_ROOT, sub, "rules");
		if (existsSync(rulesDir)) {
			try {
				for (const f of readdirSync(rulesDir)) {
					if (!f.endsWith(".md")) continue;
					const full = join(rulesDir, f);
					entries.push({ name: `rule-${f.replace(".md", "")}`, theater: "rules", title: `作战规约：${f}`, summary: `实战作战规约与安全测试方法论（${f}）`, filePath: full });
				}
			} catch {
				// Ignore unreadable rules directories.
			}
		}

		const subSkillsDir = join(SKILLS_ROOT, sub, "skills");
		if (!existsSync(subSkillsDir)) continue;
		try {
			for (const dirName of readdirSync(subSkillsDir)) {
				const dirPath = join(subSkillsDir, dirName);
				if (!statSync(dirPath).isDirectory()) continue;
				let targetFile = join(dirPath, "SKILL.md");
				if (!existsSync(targetFile)) targetFile = join(dirPath, "README.md");
				if (!existsSync(targetFile)) continue;

				let theater: TacticalEntry["theater"] = "web";
				if (["active-directory", "lateral", "tunnel", "privilege", "ntlm", "kubernetes", "container-escape"].some((s) => dirName.includes(s))) {
					theater = "intranet";
				} else if (["recon", "fofo", "hunter", "infogather"].some((s) => dirName.includes(s))) {
					theater = "recon";
				}
				entries.push({ name: dirName, theater, title: dirName.replace(/-/g, " "), summary: `${theater === "intranet" ? "【内网横向/特战】" : "【战术攻坚】"} ${dirName}`, filePath: targetFile });
			}
		} catch {
			// Ignore unreadable skill directories.
		}
	}
	return entries;
}

const ALIASES: Record<string, string[]> = {
	打点: ["recon-and-methodology", "upload-insecure-files", "cmdi-command-injection", "deserialization-insecure"],
	边界: ["recon-and-methodology", "waf-bypass-techniques", "api-recon-and-docs"],
	upload: ["upload-insecure-files"], 上传: ["upload-insecure-files"],
	webshell: ["upload-insecure-files", "reverse-shell-techniques"],
	反序列化: ["deserialization-insecure", "jndi-injection"], fastjson: ["deserialization-insecure", "jndi-injection"], shiro: ["deserialization-insecure"], log4j: ["jndi-injection"],
	ssrf: ["ssrf-server-side-request-forgery"], ssti: ["ssti-server-side-template-injection", "expression-language-injection"], spel: ["expression-language-injection"],
	rce: ["cmdi-command-injection", "arbitrary-write-to-rce"], sqli: ["sqli-sql-injection"], 注入: ["sqli-sql-injection", "cmdi-command-injection"],
	未授权: ["unauthorized-access-common-services", "authbypass-authentication-flaws"], 越权: ["idor-broken-object-authorization", "api-authorization-and-bola"], xss: ["xss-cross-site-scripting"],
	bypass: ["401-403-bypass-techniques", "waf-bypass-techniques"], waf: ["waf-bypass-techniques", "401-403-bypass-techniques"], 403: ["401-403-bypass-techniques"], 走私: ["request-smuggling", "http2-specific-attacks"],
	转子: ["recon-pipeline", "infogather"], js: ["recon-pipeline", "infogather", "api-recon-and-docs"], 测绘: ["recon-pipeline", "fofoapi", "hunter-qianxin", "quake"], 子域: ["recon-pipeline", "subdomain-takeover"],
	adcs: ["active-directory-certificate-services", "certificate"], pth: ["windows-lateral-movement", "ntlm-relay-coercion"], smb: ["windows-lateral-movement", "unauthorized-access-common-services"], rdp: ["windows-lateral-movement"], kerberos: ["active-directory-kerberos-attacks"],
	privesc: ["windows-privilege-escalation", "linux-privilege-escalation"], 提权: ["windows-privilege-escalation", "linux-privilege-escalation"], 隧道: ["tunneling-and-pivoting"], 横向: ["windows-lateral-movement", "linux-lateral-movement"], 域控: ["active-directory-kerberos-attacks", "active-directory-certificate-services", "active-directory-acl-abuse"],
};

export function searchTactics(query: string, limit = 4): TacticalEntry[] {
	if (!cachedIndex) cachedIndex = buildIndex();
	const q = query.toLowerCase().trim();
	const tokens = new Set<string>(q.split(/[\s,+/_-]+/).filter((t) => t.length >= 1));
	for (const [key, expansions] of Object.entries(ALIASES)) if (q.includes(key) || tokens.has(key)) expansions.forEach((e) => tokens.add(e));
	return cachedIndex.map((entry) => {
		const haystack = `${entry.name} ${entry.title} ${entry.summary}`.toLowerCase();
		let score = 0;
		for (const token of tokens) score += entry.name === token ? 50 : haystack.includes(token) ? 10 : 0;
		if ((q.includes("测绘") || q.includes("信息收集") || q.includes("资产")) && entry.theater === "recon") score += 15;
		return { entry, score };
	}).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.entry);
}

export function extractTacticalSections(markdown: string, maxLength = 3500): string {
	const text = markdown.replace(/^---[\s\S]*?---\s*/, "").trim();
	if (text.length <= maxLength) return text;
	const sections = text.split(/(?=\n##\s+)/);
	if (sections.length <= 1) return text.slice(0, maxLength) + "\n\n... [战术文档截断，完整正本见原文件]";
	const scored = sections.map((section, index) => {
		const title = section.trim().split("\n")[0] || "";
		const lower = title.toLowerCase();
		let score = index === 0 ? 15 : 0;
		if (/sop|playbook|bypass|attack|exploit|payload|command|实战|利用|绕过|命令|手法|技巧/i.test(lower)) score += 50;
		if (section.includes("```")) score += 30;
		if (/related|reference|defense|remediation|防御|修复|免责/i.test(lower)) score -= 40;
		return { raw: section.trim(), score };
	});
	const selected: string[] = [];
	let currentLength = 0;
	if (scored[0]?.raw.length < 800) { selected.push(scored[0].raw); currentLength += scored[0].raw.length; }
	for (const candidate of scored.slice(1).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)) {
		if (currentLength + candidate.raw.length + 20 <= maxLength) { selected.push(candidate.raw); currentLength += candidate.raw.length + 20; }
		else { const remaining = maxLength - currentLength - 50; if (remaining > 300) selected.push(candidate.raw.slice(0, remaining) + "\n... [小节截断]"); break; }
	}
	return selected.length ? selected.join("\n\n---\n\n") + "\n\n... [高精 SOP 战术摘录完毕]" : text.slice(0, maxLength) + "\n\n... [战术文档截断，完整正本见原文件]";
}

export function readTacticalSOP(entry: TacticalEntry, maxLength = 3500): string {
	try { return extractTacticalSections(readFileSync(entry.filePath, "utf8"), maxLength); }
	catch (error) { return `读取战术失败: ${error}`; }
}
