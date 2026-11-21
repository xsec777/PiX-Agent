import assert from "node:assert/strict";
import { maskPII, truncateEvidenceResponse, runResponseHygieneGate } from "../extension/pii-masker.ts";
import { createWorkerResult, reconcileWorkerResult } from "../extension/worker-result.ts";
import { getEndpointById, recordEndpoint } from "../extension/state.ts";
import { globalWorkerPool } from "../extension/worker-pool.ts";
import { globalWatchdogCeiling } from "../extension/watchdog.ts";

// Synthetic values only; no requests are sent.
const phone = ["138", "0000", "0000"].join("");
const secondPhone = ["159", "0000", "0000"].join("");
const identity = ["110101", "00000000", "000X"].join("");
const masked = maskPII(`${phone},${secondPhone}; ${identity} demo@example.test a@example.test`);
assert.equal(masked.count, 5);
assert.equal(masked.maskedText, "138****0000,159****0000; 110101********000X de***@example.test ***@example.test");
assert.equal(maskPII(masked.maskedText).count, 0);

const rows = Array.from({ length: 10 }, (_, i) => ({ label: `row-${i}`, phone }));
const body = JSON.stringify({ data: rows, users: rows, page: 1 });
const truncated = truncateEvidenceResponse(body);
const [sample, notice] = truncated.truncatedText.split("\n\n");
assert.deepEqual(JSON.parse(sample), { data: rows.slice(0, 3), users: rows.slice(0, 3), page: 1 });
assert.ok(notice.includes("输入 10 项，保留 3 项"));
assert.equal(truncateEvidenceResponse(JSON.stringify(rows)).totalCount, 10);
assert.equal(truncateEvidenceResponse("one\ntwo").truncated, false);
assert.equal(truncateEvidenceResponse(rows.map(({ label }) => label).join("\n")).totalCount, 10);
assert.throws(() => truncateEvidenceResponse(body, 4), RangeError);

const response = `HTTP/1.1 200 OK\nSet-Cookie: synthetic-session\n\tcontinued-synthetic\nX-Request-ID: fixture-trace\n\n${body}`;
const clean = runResponseHygieneGate(response).sanitized;
assert.ok(clean.includes("HTTP/1.1 200 OK\nSet-Cookie: [REDACTED_COOKIE]"));
assert.ok(clean.includes("X-Request-ID: fixture-trace"));
for (const sensitive of [phone, "synthetic-session", "continued-synthetic", "row-3"]) {
	assert.ok(!clean.includes(sensitive));
}
assert.ok(runResponseHygieneGate(`HTTP/1.1 200 OK\r\n\r\n${phone}`).sanitized.endsWith("138****0000"));
assert.equal(runResponseHygieneGate("").sanitized, "");

const endpoint = recordEndpoint({ url: "https://example.test/fixture", method: "GET" });
const workerId = "w-resp-gate";
const taskEnvelopeId = "env-resp-gate";
const binding = { workerId, taskEnvelopeId, endpointId: endpoint.id };
assert.ok(globalWorkerPool.acquireSlot({ ...binding, targetHost: "example.test" }));
globalWatchdogCeiling.register(binding);
const result = createWorkerResult({
	...binding,
	status: "confirmed",
	action: "Offline fixture",
	vulnerabilityTitle: "Synthetic evidence fixture",
	evidenceRequest: "GET /fixture HTTP/1.1\r\nHost: example.test\r\nCookie: fixture-session\r\n\r\n",
	evidenceResponse: response,
});
reconcileWorkerResult(result);
const saved = getEndpointById(endpoint.id);
assert.equal(saved?.evidenceResponse, clean);
assert.equal(saved?.diffSignature, clean.slice(0, 120));
assert.equal(saved?.testHistory.at(-1)?.responseSnippet, clean.slice(0, 300));
assert.ok(saved?.evidenceRequest?.includes("Cookie: [REDACTED_COOKIE]"));
assert.throws(() => reconcileWorkerResult(result), /结果 ID 已处理/);
console.log("Response masking, sample limits, and ledger reconciliation checks passed.");
