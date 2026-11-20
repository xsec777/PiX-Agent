/**
 * redaction.ts — 请求文本中指定凭据字段的规则替换 (ADR 0006)
 *
 * 仅覆盖列出的认证头、字符串 JSON 字段和查询参数；不是通用 PII 清洗器。
 * 包装器保留 original 原文，仅 redacted 字段适合输出。
 */

export interface RedactionResult {
	readonly original: string;
	readonly redacted: string;
	readonly redactedTokensCount: number;
	readonly modified: boolean;
}

function redactRequest(rawRequest: string): { text: string; count: number } {
	let count = 0;
	const replace = (text: string, pattern: RegExp, marker: string): string =>
		text.replace(pattern, (match: string, prefix: string, suffix: string = "") => {
			// A replacement without a suffix receives the numeric match offset here.
			const ending = typeof suffix === "string" ? suffix : "";
			const replacement = prefix + marker + ending;
			if (replacement !== match) count++;
			return replacement;
		});

	const boundary = rawRequest.search(/\r?\n\r?\n/);
	let headers = boundary < 0 ? rawRequest : rawRequest.slice(0, boundary);
	let body = boundary < 0 ? "" : rawRequest.slice(boundary);
	headers = replace(headers, /^(Authorization:[ \t]*Bearer[ \t]+)[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim, "[REDACTED_TOKEN]");
	headers = replace(headers, /^(Authorization:[ \t]*Basic[ \t]+)[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim, "[REDACTED_CREDENTIAL]");
	headers = replace(headers, /^(Cookie:[ \t]*)[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim, "[REDACTED_COOKIE]");
	headers = replace(headers, /^((?:X-(?:Api-Key|Token|Auth-Token|Access-Token)|Api-Key|Token|Private-Token):[ \t]*)[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim, "[REDACTED_TOKEN]");

	let text = headers + body;
	text = replace(text, /("(?:password|passwd|secret|client_secret|token|accessToken|access_token|refreshToken)"\s*:\s*")(?:\\.|[^"\\])*(")/gi, "[REDACTED_SECRET]");
	text = replace(text, /([?&](?:token|access_token|secret|password|key)=)[^& \r\n]+/gi, "[REDACTED_SECRET]");
	return { text, count };
}

export function redactEvidenceRequest(rawRequest: string): string {
	return redactRequest(rawRequest).text;
}

/** original contains sensitive input and must not be logged or exported. */
export function runRequestRedactionGate(rawRequest: string): RedactionResult {
	const result = redactRequest(rawRequest);
	return {
		original: rawRequest,
		redacted: result.text,
		redactedTokensCount: result.count,
		modified: result.text !== rawRequest,
	};
}
