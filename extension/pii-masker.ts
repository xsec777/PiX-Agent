/** Rule-based response evidence minimization for WorkerResult reconciliation (ADR 0006). */

export interface HygieneResponseResult {
	readonly original: string;
	readonly sanitized: string;
	readonly maskedPIICount: number;
	readonly truncated: boolean;
	readonly totalRecordCount?: number;
}

export function maskPII(text: string): { maskedText: string; count: number } {
	let count = 0;
	const maskedText = text
		.replace(/(?<!\d)([1-9]\d{5})\d{8}(\d{3}[\dXx])(?!\d)/g, (_match, start, end) => {
			count++;
			return `${start}********${end}`;
		})
		.replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, (_match, start, end) => {
			count++;
			return `${start}****${end}`;
		})
		.replace(/[\w.+-]+(@[a-z\d-]+(?:\.[a-z\d-]+)+)/gi, (match, domain: string) => {
			count++;
			const length = match.length - domain.length;
			return `${match.slice(0, Math.min(2, length - 1))}***${domain}`;
		});
	return { maskedText, count };
}

const LIST_FIELDS = ["data", "list", "items", "records", "users", "rows"];

function splitResponse(text: string): { headers: string; body: string } {
	const boundary = /^HTTP\/\d/i.test(text) ? /\r?\n\r?\n/.exec(text) : null;
	if (!boundary) return { headers: "", body: text };
	const end = boundary.index + boundary[0].length;
	return { headers: text.slice(0, end), body: text.slice(end) };
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export function truncateEvidenceResponse(
	rawResponse: string,
	maxItems = 3,
): { truncatedText: string; truncated: boolean; totalCount?: number } {
	if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 3) {
		throw new RangeError("maxItems must be an integer between 1 and 3");
	}
	const { headers, body } = splitResponse(rawResponse);
	const json = parseJson(body);
	const counts: Array<{ label: string; count: number }> = [];
	let sample = json;
	if (Array.isArray(json) && json.length > maxItems) {
		counts.push({ label: "数组", count: json.length });
		sample = json.slice(0, maxItems);
	} else if (json && typeof json === "object" && !Array.isArray(json)) {
		const object = json as Record<string, unknown>;
		for (const key of LIST_FIELDS) {
			const items = object[key];
			if (!Array.isArray(items) || items.length <= maxItems) continue;
			counts.push({ label: key, count: items.length });
			object[key] = items.slice(0, maxItems);
		}
	}
	if (counts.length) {
		const details = counts.map(({ label, count }) => `${label}：输入 ${count} 项，保留 ${maxItems} 项`);
		return {
			truncatedText: `${headers}${JSON.stringify(sample, null, 2)}\n\n[证据样本已截断；${details.join("；")}]`,
			truncated: true,
			totalCount: counts.length === 1 ? counts[0].count : undefined,
		};
	}
	if (json === undefined) {
		const lines = body.trimEnd().split(/\r?\n/);
		if (lines.length > 8) {
			return {
				truncatedText: `${headers}${lines.slice(0, maxItems).join("\n")}\n[证据样本已截断；输入 ${lines.length} 行，保留 ${maxItems} 行]`,
				truncated: true,
				totalCount: lines.length,
			};
		}
	}
	return { truncatedText: rawResponse, truncated: false };
}

/** original contains sensitive input and must not be stored or exported. */
export function runResponseHygieneGate(rawResponse: string): HygieneResponseResult {
	const truncation = truncateEvidenceResponse(rawResponse);
	const { headers, body } = splitResponse(truncation.truncatedText);
	const cleanHeaders = headers.replace(/^(Set-Cookie2?:[ \t]*)[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim, "$1[REDACTED_COOKIE]");
	const masking = maskPII(cleanHeaders + body);
	return {
		original: rawResponse,
		sanitized: masking.maskedText,
		maskedPIICount: masking.count,
		truncated: truncation.truncated,
		totalRecordCount: truncation.totalCount,
	};
}
