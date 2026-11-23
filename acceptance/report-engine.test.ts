import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assembleDataPlaneReport } from "../extension/report-engine.ts";
import { recordEndpoint, type EndpointNode } from "../extension/state.ts";

const phone = ["138", "0000", "0000"].join("");
const endpoint: EndpointNode = {
	id: "fixture-1", url: "https://user:fixture-password@example.test/api?token=fixture-query",
	method: "GET", status: "confirmed", vulnerabilities: ["Fixture <script>\n# title", "second title"],
	testedTimes: 0, failureStreak: 0, escalationLevel: 0, testHistory: [],
	evidenceRequest: "GET /api HTTP/1.1\r\nCookie: fixture-session\r\n\r\n```\n# untrusted heading",
	evidenceResponse: `HTTP/1.1 200 OK\r\nSet-Cookie: fixture-response\r\n\r\n${JSON.stringify(Array.from({ length: 8 }, (_, id) => ({ id, phone })))}`,
};
const rejected: EndpointNode = { ...endpoint, id: "fixture-2", status: "rejected" };
const bypassing: EndpointNode = { ...endpoint, id: "fixture-3", status: "bypassing" };
const missing: EndpointNode = { ...endpoint, id: "fixture-4", evidenceRequest: undefined, evidenceResponse: undefined, vulnerabilities: [] };
recordEndpoint({ url: "https://unrelated.example.test/", method: "GET" });
const before = JSON.stringify(endpoint);
const options = { scopedEndpoints: [endpoint, rejected, bypassing, missing], generatedAt: 1000, targetName: "<img src=x>\n# injected" };
const report = assembleDataPlaneReport(options);
assert.equal(report.totalEndpointsScanned, 4);
assert.equal(report.confirmedCount, 2);
assert.equal(report.findingCount, 3);
assert.equal(report.rejectedCount, 1);
assert.equal(report.bypassingCount, 1);
assert.equal(report.vulnerabilities[0].severity, "UNASSESSED");
assert.equal(report.vulnerabilities[0].testedTimes, 0);
assert.equal(JSON.stringify(endpoint), before);
for (const secret of ["fixture-password", "fixture-query", "fixture-session", "fixture-response", phone]) {
	assert.ok(!JSON.stringify(report).includes(secret));
}
assert.ok(!report.markdownContent.includes("<script>"));
assert.ok(!report.markdownContent.includes("<img"));
assert.ok(report.markdownContent.includes("````http"));
assert.ok(report.markdownContent.includes("未记录请求证据。"));
assert.ok(report.markdownContent.includes("未记录响应证据。"));
const { sha256Fingerprint, ...entry } = report.vulnerabilities[0];
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
assert.equal(sha256Fingerprint, hash(JSON.stringify(entry)));
assert.equal(report.integritySignature, hash(report.markdownContent));
assert.deepEqual(assembleDataPlaneReport(options), report);
assert.notEqual(assembleDataPlaneReport({ ...options, targetName: "changed" }).integritySignature, report.integritySignature);
assert.ok(Object.isFrozen(report) && Object.isFrozen(report.vulnerabilities) && Object.isFrozen(report.vulnerabilities[0]));
const empty = assembleDataPlaneReport({ scopedEndpoints: [], generatedAt: 1000 });
assert.equal(empty.totalEndpointsScanned, 0);
assert.equal(empty.confirmedCount, 0);
assert.ok(empty.markdownContent.includes("不能据此认定不存在漏洞"));
assert.throws(() => assembleDataPlaneReport({ generatedAt: Number.NaN }), RangeError);
console.log("Report scope, privacy, missing evidence, rendering and SHA-256 checks passed.");
