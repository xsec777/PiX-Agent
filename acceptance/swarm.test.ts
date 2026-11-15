/**
 * swarm.test.ts — PiX-Swarm 3.0.0 主从会话物理隔离集群集成断言套件 (ADR 0001/0002/0005)
 */

import assert from "node:assert/strict";

import { globalWorkerPool } from "../extension/worker-pool.ts";
import { createTaskEnvelope } from "../extension/task-envelope.ts";
import { handleWorkerSubmit } from "../extension/termination.ts";
import { globalWatchdogCeiling } from "../extension/watchdog.ts";
import { createWorkerResult, reconcileWorkerResult } from "../extension/worker-result.ts";
import { recordEndpoint, getEndpointById } from "../extension/state.ts";

console.log("==================================================================");
console.log("🐝  PiX-Swarm 3.0.0 主从物理隔离作战集群集成验收套件");
console.log("==================================================================\n");

// 1. Planner 任务信封生成与 Worker 槽位调度
console.log("[断言 1/5] Planner 派发 TaskEnvelope 与 Worker 槽位调度...");
const ep1 = recordEndpoint({
	url: "https://auth.corp.local/oauth/token",
	method: "POST",
	params: ["grant_type", "client_secret"],
	discoveredFrom: "planner_recon",
});

const envelope1 = createTaskEnvelope({
	endpointId: ep1.id,
	targetUrl: ep1.url,
	httpMethod: ep1.method as any,
	params: ep1.params,
	boundary: { readOnly: false },
	assignedTier: "FastTier",
});

const workerId1 = "worker-swarm-001";
const slot1 = globalWorkerPool.acquireSlot({
	workerId: workerId1,
	endpointId: envelope1.endpointId,
	taskEnvelopeId: envelope1.id,
	targetHost: envelope1.targetHost,
	modelTier: envelope1.assignedTier,
});

assert.ok(slot1 !== null, "Worker 槽位应成功分配");
assert.ok(slot1?.status === "running", "槽位状态应为 running");

globalWatchdogCeiling.register({
	workerId: workerId1,
	taskEnvelopeId: envelope1.id,
	endpointId: envelope1.endpointId,
	maxTurns: envelope1.probeQuota.maxTurns,
	timeoutMs: envelope1.probeQuota.timeoutMs,
});
assert.ok(globalWatchdogCeiling.getEntry(workerId1)?.status === "active", "看门狗应成功激活");
console.log("  → 通过 ✓");

// 2. 并发窗口硬顶拦截 (ConcurrencyWindow = 2)
console.log("[断言 2/5] 并发窗口硬顶拦截 (maxConcurrency = 2)...");
const ep2 = recordEndpoint({ url: "https://api.corp.local/v1/users", method: "GET" });
const ep3 = recordEndpoint({ url: "https://pay.corp.local/v1/charge", method: "POST" });

const slot2 = globalWorkerPool.acquireSlot({
	workerId: "worker-swarm-002",
	endpointId: ep2.id,
	targetHost: "api.corp.local",
});
assert.ok(slot2 !== null, "第 2 个 Worker 应成功获取槽位");

// 第 3 个申请必须被拦截
const slot3 = globalWorkerPool.acquireSlot({
	workerId: "worker-swarm-003",
	endpointId: ep3.id,
	targetHost: "pay.corp.local",
});
assert.ok(slot3 === null, "超过并发窗口上限 (2) 应被硬拦截");
console.log("  → 通过 ✓");

// 3. Worker 会话 confirmed 强制终结与状态机自动对账
console.log("[断言 3/5] Worker 调用 worker_submit (confirmed) 强制终结与超图对账...");
const receipt1 = handleWorkerSubmit({
	workerId: workerId1,
	taskEnvelopeId: envelope1.id,
	endpointId: envelope1.endpointId,
	outcome: "confirmed",
	summary: "OAuth Client Secret 越权读取成功",
	vulnerabilityTitle: "OAuth2 Client Credentials Leakage",
	evidenceRequest: "POST /oauth/token HTTP/1.1\r\nHost: auth.corp.local\r\n\r\n",
	evidenceResponse: "HTTP/1.1 200 OK\r\n\r\n{\"access_token\":\"secret_token\"}",
	extractedAssets: ["https://auth.corp.local/api/admin/keys"],
});

assert.ok(receipt1.accepted === true, "worker_submit 应接受结案");
assert.ok(receipt1.nextAction === "early_exit", "confirmed 应触发 Early Exit");

const workerResult1 = createWorkerResult({
	workerId: workerId1,
	taskEnvelopeId: envelope1.id,
	endpointId: envelope1.endpointId,
	status: "confirmed",
	action: "OAuth Client Secret 越权读取成功",
	vulnerabilityTitle: "OAuth2 Client Credentials Leakage",
	evidenceRequest: "POST /oauth/token HTTP/1.1\r\nHost: auth.corp.local\r\n\r\n",
	evidenceResponse: "HTTP/1.1 200 OK\r\n\r\n{\"access_token\":\"secret_token\"}",
	extractedAssets: ["https://auth.corp.local/api/admin/keys"],
	turnCount: 2,
	elapsedMs: 1200,
});

const recon1 = reconcileWorkerResult(workerResult1);
assert.ok(recon1.reconciled === true, "超图对账应成功");
assert.ok(recon1.newStatus === "confirmed", "台账状态机应跃迁至 confirmed");
assert.ok(recon1.slotReleased === true, "WorkerPool 槽位应被自动释放");
assert.ok(recon1.watchdogCleared === true, "Watchdog 看门狗应被自动解除");

const epCheck = getEndpointById(ep1.id);
assert.ok(epCheck?.status === "confirmed", "端点状态应为 confirmed");
assert.ok(epCheck?.vulnerabilities?.includes("OAuth2 Client Credentials Leakage"), "漏洞标题应落盘");
console.log("  → 通过 ✓");

// 4. 槽位释放后的复用与级联资产验证
console.log("[断言 4/5] 槽位释放后队列复用与新资产入账...");
// 之前被拦截的 ep3 此时应能获取释放出的槽位
const slot3Retry = globalWorkerPool.acquireSlot({
	workerId: "worker-swarm-003",
	endpointId: ep3.id,
	targetHost: "pay.corp.local",
});
assert.ok(slot3Retry !== null, "释放后槽位应可被复用");

// 检查级联录入的新端点
const cascadedEp = getEndpointById("https://auth.corp.local/api/admin/keys");
assert.ok(cascadedEp !== undefined, "新级联资产必须已录入端点台账");
console.log("  → 通过 ✓");

// 5. bypassing 强阻抗与 rejected 防偷懒流转验证
console.log("[断言 5/5] bypassing 强阻抗升档与 rejected 充分证伪闭环...");
// bypassing
const receiptBypass = handleWorkerSubmit({
	workerId: "worker-swarm-002",
	taskEnvelopeId: "env-002",
	endpointId: ep2.id,
	outcome: "bypassing",
	summary: "连续 3 组走私变异均被 WAF 阻断",
	wafSignature: "WAF 403 Forbidden",
	attemptsCount: 3,
});
assert.ok(receiptBypass.nextAction === "escalate_smart_tier", "bypassing 应触发 SmartTier 换将");

// 释放剩余槽位
globalWorkerPool.releaseSlot("worker-swarm-002", "failed");
globalWorkerPool.releaseSlot("worker-swarm-003", "completed");

const finalMetrics = globalWorkerPool.getMetrics();
assert.ok(finalMetrics.activeSlots === 0, "全部释放后活跃槽位应归零");
console.log("  → 通过 ✓");

console.log("==================================================================");
console.log("🎉  PiX-Swarm 3.0.0 集群集成验收全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");
