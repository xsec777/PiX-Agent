import assert from "node:assert/strict";
import { generateExecutiveSummary } from "../extension/executive-summary.ts";
import { assembleDataPlaneReport } from "../extension/report-engine.ts";
import { recordEndpoint, updateEndpointStatus } from "../extension/state.ts";

const generatedAt = 1800000000000;
const statuses = ["confirmed", "rejected", "bypassing", "blocked", "discovered"] as const;
const endpoints = statuses.map((status, i) => {
	const endpoint = recordEndpoint({ url: `https://example.test/summary-fixture-${i}`, method: "GET" });
	updateEndpointStatus(endpoint.id, status, {
		vuln: status === "confirmed" ? "Synthetic finding, severity unassessed" : undefined,
		evidenceRequest: "GET /fixture HTTP/1.1\r\nHost: example.test\r\n\r\n",
		evidenceResponse: "HTTP/1.1 200 OK\r\n\r\nsynthetic",
	});
	return endpoint;
});
const report = assembleDataPlaneReport({ scopedEndpoints: endpoints, generatedAt });
const before = JSON.stringify(report);
const summary = generateExecutiveSummary(report, { generatedAt, cLevelAudience: "BOARD" });
assert.equal(summary.overallRiskLevel, "UNASSESSED");
assert.ok(summary.executivePosture.includes("共 5 个端点"));
assert.ok(summary.executivePosture.includes("confirmed 标签 1 个"));
assert.ok(summary.executivePosture.includes("统计闭环状态 2 个"));
assert.ok(summary.executivePosture.includes("受阻端点"));
assert.equal(JSON.stringify(report), before);
assert.deepEqual(generateExecutiveSummary(report, { generatedAt, cLevelAudience: "BOARD" }), summary);
assert.ok(Object.isFrozen(summary) && Object.isFrozen(summary.strategicPriorities));
assert.ok(summary.markdownContent.includes("无 LLM 或网络调用"));
assert.ok(summary.markdownContent.includes("受众：BOARD"));

const empty = assembleDataPlaneReport({ scopedEndpoints: [], generatedAt });
const emptySummary = generateExecutiveSummary(empty, { generatedAt });
assert.equal(emptySummary.overallRiskLevel, "UNASSESSED");
assert.ok(emptySummary.executivePosture.includes("当前输入为空"));
assert.ok(!emptySummary.executivePosture.includes("LOW"));
const noConfirmed = generateExecutiveSummary(assembleDataPlaneReport({ scopedEndpoints: endpoints.slice(1), generatedAt }), { generatedAt });
assert.ok(noConfirmed.strategicPriorities.some((priority) => priority.includes("不等于目标安全")));

const safe = generateExecutiveSummary(report, {
	generatedAt,
	organizationName: "<script>\n# fixture demo@example.test?token=synthetic-organization-token",
	customStrategicFocus: ["<img> [fixture](https://example.test)\n# concern?token=synthetic-focus-token"],
});
assert.ok(!safe.markdownContent.includes("<script>"));
assert.ok(!safe.markdownContent.includes("<img>"));
assert.ok(!safe.markdownContent.includes("demo@example.test"));
assert.ok(!safe.markdownContent.includes("synthetic-organization-token"));
assert.ok(!safe.markdownContent.includes("synthetic-focus-token"));
assert.ok(safe.strategicPriorities.some((priority) => priority.includes("调用方关注项（未经验证）")));

const metricsOnly = { ...report, get vulnerabilities(): never { throw new Error("must not read details"); } };
assert.doesNotThrow(() => generateExecutiveSummary(metricsOnly, { generatedAt }));
assert.throws(() => generateExecutiveSummary(report, { generatedAt: Number.NaN }), RangeError);
assert.throws(() => generateExecutiveSummary({ ...report, confirmedCount: -1 }), RangeError);
assert.throws(() => generateExecutiveSummary({ ...report, blockedCount: 100 }), RangeError);
console.log("Executive summary draft: counts, limitations, privacy, immutability and determinism passed.");
