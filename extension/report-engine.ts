/** Local endpoint-ledger report assembly; hashes detect content changes, not authenticity. */
import { createHash } from "node:crypto";
import { getAllEndpoints, type EndpointNode } from "./state.ts";
import { redactEvidenceRequest } from "./redaction.ts";
import { maskPII, runResponseHygieneGate } from "./pii-masker.ts";

export interface DataPlaneVulnerability {
	readonly endpointId: string;
	readonly url: string;
	readonly method: string;
	readonly title: string;
	readonly severity: "UNASSESSED";
	readonly evidenceRequest: string;
	readonly evidenceResponse: string;
	readonly testedTimes: number;
	readonly lastTestedAt?: string;
	readonly sha256Fingerprint: string;
}

export interface DataPlaneReport {
	readonly reportId: string;
	readonly generatedAt: number;
	/** Compatibility name: number of input ledger endpoints, not a verified scan count. */
	readonly totalEndpointsScanned: number;
	readonly confirmedCount: number;
	readonly rejectedCount: number;
	readonly bypassingCount: number;
	readonly blockedCount: number;
	readonly findingCount: number;
	readonly vulnerabilities: readonly DataPlaneVulnerability[];
	readonly markdownContent: string;
	/** SHA-256 of markdownContent only; not a cryptographic signature. */
	readonly integritySignature: string;
}

const digest = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const sanitizeText = (text: string): string => maskPII(redactEvidenceRequest(text)).maskedText;
const label = (text: string): string => text.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[&<>\\`*_{}\[\]()!|#~]/g, (char) => `&#${char.charCodeAt(0)};`);

function sanitizeUrl(rawUrl: string): string {
	try {
		const url = new URL(rawUrl);
		if (url.username || url.password) {
			url.username = "REDACTED";
			url.password = "";
		}
		return sanitizeText(url.href);
	} catch {
		return sanitizeText(rawUrl);
	}
}

function fenced(text: string): string {
	const runs = text.match(/`+/g) ?? [];
	const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
	return `${fence}http\n${text}\n${fence}`;
}

export function assembleDataPlaneReport(options?: {
	targetName?: string;
	scopedEndpoints?: readonly EndpointNode[];
	generatedAt?: number;
}): DataPlaneReport {
	const endpoints = options?.scopedEndpoints ?? getAllEndpoints();
	const generatedAt = options?.generatedAt ?? Date.now();
	if (!Number.isSafeInteger(generatedAt) || generatedAt < 0 || generatedAt > 8640000000000000) {
		throw new RangeError("generatedAt must be a valid non-negative integer timestamp");
	}
	const confirmed = endpoints.filter((endpoint) => endpoint.status === "confirmed");
	const rejectedCount = endpoints.filter((endpoint) => endpoint.status === "rejected").length;
	const bypassingCount = endpoints.filter((endpoint) => endpoint.status === "bypassing").length;
	const blockedCount = endpoints.filter((endpoint) => endpoint.status === "blocked").length;
	const vulnerabilities: DataPlaneVulnerability[] = [];
	for (const endpoint of confirmed) {
		const titles = endpoint.vulnerabilities?.length ? endpoint.vulnerabilities : ["台账未提供漏洞标题"];
		for (const title of titles) {
			const entry: Omit<DataPlaneVulnerability, "sha256Fingerprint"> = {
				endpointId: sanitizeText(endpoint.id),
				url: sanitizeUrl(endpoint.url),
				method: endpoint.method,
				title: sanitizeText(title),
				severity: "UNASSESSED",
				evidenceRequest: endpoint.evidenceRequest ? sanitizeText(endpoint.evidenceRequest) : "",
				evidenceResponse: endpoint.evidenceResponse ? sanitizeText(runResponseHygieneGate(endpoint.evidenceResponse).sanitized) : "",
				testedTimes: endpoint.testedTimes,
				lastTestedAt: endpoint.lastTestedAt ? sanitizeText(endpoint.lastTestedAt) : undefined,
			};
			vulnerabilities.push(Object.freeze({ ...entry, sha256Fingerprint: digest(JSON.stringify(entry)) }));
		}
	}
	const lines = [
		"# 端点台账证据报告",
		`生成时间：${new Date(generatedAt).toISOString()}`,
		`报告范围：${label(sanitizeText(options?.targetName ?? "输入端点台账"))}`,
		"",
		"本报告为本地模板读取台账生成。状态标签不等于独立验证；没有确认条目不代表目标安全。",
		"脱敏仅覆盖列出的规则，发布前仍须人工审查。证据可能被截断或替换，不能直接复放。",
		"SHA-256 仅校验展示内容，不是签名、原始报文存证或不可篡改保证。",
		"",
		"## 范围内台账统计",
		"| 项目 | 数量 |",
		"|---|---|",
		`| 输入端点 | ${endpoints.length} |`,
		`| confirmed 端点 | ${confirmed.length} |`,
		`| confirmed 标题条目 | ${vulnerabilities.length} |`,
		`| rejected 端点 | ${rejectedCount} |`,
		`| bypassing 端点 | ${bypassingCount} |`,
		`| blocked 端点 | ${blockedCount} |`,
		"",
		"## confirmed 台账条目（待独立复核）",
	];
	if (!vulnerabilities.length) lines.push("当前范围没有 confirmed 台账条目；不能据此认定不存在漏洞或全部端点已测。");
	for (const [index, entry] of vulnerabilities.entries()) {
		lines.push(
			`### ${index + 1}. ${label(entry.title)}`,
			`端点：${label(`${entry.method} ${entry.url}`)}；ID：${label(entry.endpointId)}`,
			`严重级别：未评估；台账测试计数：${entry.testedTimes}；最后时间：${label(entry.lastTestedAt ?? "未记录")}`,
			`展示条目 SHA-256：${entry.sha256Fingerprint}`,
			"",
			"#### 请求证据（规则处理后）",
			entry.evidenceRequest ? fenced(entry.evidenceRequest) : "未记录请求证据。",
			"",
			"#### 响应证据（规则处理后）",
			entry.evidenceResponse ? fenced(entry.evidenceResponse) : "未记录响应证据。",
			"",
		);
	}
	const markdownContent = lines.join("\n");
	return Object.freeze({
		reportId: `report-data-${generatedAt}`,
		generatedAt,
		totalEndpointsScanned: endpoints.length,
		confirmedCount: confirmed.length,
		rejectedCount,
		bypassingCount,
		blockedCount,
		findingCount: vulnerabilities.length,
		vulnerabilities: Object.freeze(vulnerabilities),
		markdownContent,
		integritySignature: digest(markdownContent),
	});
}
