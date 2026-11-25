/**
 * v3-swarm.test.ts — strict offline smoke checks for V3 local contract modules.
 * Synthetic fixtures only; no network, model service, credential validation or child subprocess.
 */
import assert from "node:assert/strict";
import { createTaskEnvelope } from "../extension/task-envelope.ts";
import { globalWorkerPool } from "../extension/worker-pool.ts";
import { globalHostMutex } from "../extension/concurrency.ts";
import { globalAdaptiveThrottler } from "../extension/throttler.ts";
import { globalModelRouter } from "../extension/model-tiering.ts";
import { globalEscalationPromoter } from "../extension/escalation.ts";
import { WatchdogCeiling, globalWatchdogCeiling } from "../extension/watchdog.ts";
import { validateTerminationContract } from "../extension/termination.ts";
import { createWorkerResult, reconcileWorkerResult } from "../extension/worker-result.ts";
import { redactEvidenceRequest } from "../extension/redaction.ts";
import { runResponseHygieneGate } from "../extension/pii-masker.ts";
import { ADSafetyGate } from "../extension/ad-safety.ts";
import { assembleDataPlaneReport } from "../extension/report-engine.ts";
import { generateExecutiveSummary } from "../extension/executive-summary.ts";
import { recordEndpoint, getAllEndpoints } from "../extension/state.ts";

const endpoint = recordEndpoint({ url: "https://example.test/v3/fixture", method: "GET" });
const envelope = createTaskEnvelope({ endpointId: endpoint.id, targetUrl: endpoint.url, httpMethod: "GET" });
assert.equal(envelope.boundary.readOnly, true);
assert.equal(Object.isFrozen(envelope), true);
assert.throws(() => createTaskEnvelope({ endpointId: endpoint.id, targetUrl: endpoint.url, httpMethod: "POST" }), /只读任务仅允许/);

globalWorkerPool.reset();
globalHostMutex.reset();
globalAdaptiveThrottler.reset();
const workerId = "v3-fixture-worker";
const taskEnvelopeId = envelope.id;
assert.ok(globalWorkerPool.acquireSlot({ workerId, endpointId: endpoint.id, taskEnvelopeId, targetHost: envelope.targetHost }));
assert.equal(globalWorkerPool.acquireSlot({ workerId: "v3-duplicate", endpointId: endpoint.id, taskEnvelopeId, targetHost: envelope.targetHost }), null);
assert.equal(globalAdaptiveThrottler.recordFeedback({ statusCode: 429 }).currentWindow, 1);

const planner = globalModelRouter.resolveModelForRole("planner");
const worker = globalModelRouter.resolveModelForRole("worker");
assert.equal(planner.tier, "SmartTier");
assert.equal(worker.tier, "FastTier");
const decision = globalEscalationPromoter.evaluateEscalation({ id: endpoint.id, status: "bypassing", failureStreak: 2, escalationLevel: 1 });
assert.equal(decision.shouldEscalate, true);

const watchdog = new WatchdogCeiling();
watchdog.register({ workerId, taskEnvelopeId, endpointId: endpoint.id, maxTurns: 2, timeoutMs: 1000 });
assert.equal(watchdog.recordTurn(workerId).tripped, false);
assert.equal(watchdog.recordTurn(workerId).tripped, false);
assert.equal(watchdog.recordTurn(workerId).tripped, true);
assert.equal(validateTerminationContract({ workerId, taskEnvelopeId, endpointId: endpoint.id, outcome: "confirmed", summary: "fixture" }).valid, false);
assert.equal(validateTerminationContract({
	workerId, taskEnvelopeId, endpointId: endpoint.id, outcome: "confirmed", summary: "fixture",
	vulnerabilityTitle: "Synthetic fixture", evidenceRequest: "GET /fixture HTTP/1.1", evidenceResponse: "HTTP/1.1 200 OK",
}).valid, true);

const cleanRequest = redactEvidenceRequest("GET /fixture HTTP/1.1\r\nCookie: synthetic-fixture-session\r\n\r\n");
assert.match(cleanRequest, /\[REDACTED_COOKIE\]/);
assert.doesNotMatch(cleanRequest, /synthetic-fixture-session/);
const rows = Array.from({ length: 5 }, (_, i) => ({ id: i, label: `fixture-${i}` }));
const hygiene = runResponseHygieneGate(JSON.stringify(rows));
assert.equal(hygiene.truncated, true);
assert.equal(hygiene.totalRecordCount, 5);
assert.doesNotMatch(hygiene.sanitized, /fixture-3/);

const adGate = new ADSafetyGate();
assert.equal(adGate.getMaxAllowedAttempts("example.test"), 0);
adGate.registerPolicy({ domain: "example.test", lockoutThreshold: 5 });
assert.equal(adGate.getMaxAllowedAttempts("example.test"), 3);
for (let i = 0; i < 3; i++) adGate.recordAttempt("example.test", "fixture-user");
assert.equal(adGate.canAttempt("example.test", "fixture-user").allowed, false);

const report = assembleDataPlaneReport({ scopedEndpoints: getAllEndpoints(), generatedAt: 1800000000000 });
const snapshot = JSON.stringify(report);
const summary = generateExecutiveSummary(report, { generatedAt: 1800000000000, cLevelAudience: "BOARD" });
assert.equal(summary.overallRiskLevel, "UNASSESSED");
assert.equal(JSON.stringify(report), snapshot);

globalWatchdogCeiling.reset();
globalWatchdogCeiling.register({ workerId, taskEnvelopeId, endpointId: endpoint.id });
const result = createWorkerResult({
	workerId, taskEnvelopeId, endpointId: endpoint.id, status: "confirmed", action: "fixture",
	vulnerabilityTitle: "Synthetic fixture", evidenceRequest: "GET /fixture HTTP/1.1", evidenceResponse: "HTTP/1.1 200 OK",
});
assert.equal(reconcileWorkerResult(result).reconciled, true);
assert.throws(() => reconcileWorkerResult(result), /结果 ID 已处理|端点已闭环/);
console.log("V3 local contract smoke checks passed; no network, model or subprocess execution.");
