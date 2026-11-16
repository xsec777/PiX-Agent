/**
 * worker-pool.test.ts — WorkerPool 内存级子会话调度池机制验收断言套件 (ADR 0001/0002/0004)
 */

import assert from "node:assert/strict";
import { WorkerPool } from "../extension/worker-pool.ts";

console.log("==================================================================");
console.log("🛡️  PiX-Swarm: WorkerPool 调度池引擎断言套件 (v3.0.0-alpha.1)");
console.log("==================================================================\n");

// 1. 初始化与容量约束
console.log("[断言 1/5] WorkerPool 初始化槽位与默认并发上限校验...");
const pool = new WorkerPool({ maxConcurrency: 2, maxCapacity: 4 });
const initialMetrics = pool.getMetrics();
assert.ok(initialMetrics.totalSlots === 4, "总槽位应初始化为 4");
assert.ok(initialMetrics.maxConcurrency === 2, "默认并发上限应为 2");
assert.ok(initialMetrics.activeSlots === 0, "初始活跃槽位应为 0");
assert.ok(initialMetrics.idleSlots === 4, "初始空闲槽位应为 4");
console.log("  → 通过 ✓");

// 2. 槽位申请与并发窗口控制
console.log("[断言 2/5] 申请 Worker 槽位与并发窗口 (maxConcurrency=2) 硬拦截...");
const slot1 = pool.acquireSlot({
	workerId: "worker-001",
	endpointId: "ep-auth-login",
	taskEnvelopeId: "env-001",
	targetHost: "auth.corp.local",
	modelTier: "FastTier",
});
assert.ok(slot1 !== null, "首个 Worker 应成功申请到槽位");
assert.ok(slot1?.id === "slot-1", "首个分配应为 slot-1");
assert.ok(slot1?.status === "running", "槽位状态应流转为 running");
assert.equal(pool.acquireSlot({ workerId: "worker-001", endpointId: "ep-other" }), null, "同一 Worker 不得占用第二个槽位");

const slot2 = pool.acquireSlot({
	workerId: "worker-002",
	endpointId: "ep-api-query",
	taskEnvelopeId: "env-002",
	targetHost: "api.corp.local",
	modelTier: "FastTier",
});
assert.ok(slot2 !== null, "第二个 Worker 应成功申请到槽位");
assert.ok(slot2?.id === "slot-2", "第二分配应为 slot-2");

// 超过并发窗口上限 (2) 必须被硬拦截
const slot3 = pool.acquireSlot({
	workerId: "worker-003",
	endpointId: "ep-admin-dash",
});
assert.ok(slot3 === null, "超出 maxConcurrency=2 时应被硬拦截，返回 null");
assert.ok(pool.getActiveSlots().length === 2, "活跃槽位应保持为 2");
console.log("  → 通过 ✓");

// 3. 槽位遥测状态更新与轮次累计
console.log("[断言 3/5] 槽位执行遥测数据更新与状态跟踪...");
const updated = pool.updateSlot("worker-001", {
	turnCount: 3,
	currentAction: "发送 SQLi 探测变异载荷",
});
assert.ok(updated !== null, "updateSlot 应成功返回更新后的快照");
assert.ok(updated?.turnCount === 3, "轮次计数应更新为 3");
assert.ok(updated?.currentAction === "发送 SQLi 探测变异载荷", "动作描述应更新");

const slot1Query = pool.getSlotByWorkerId("worker-001");
assert.ok(slot1Query?.turnCount === 3, "通过 workerId 检索槽位应一致");
console.log("  → 通过 ✓");

// 4. 槽位释放回收与复用
console.log("[断言 4/5] 释放 Worker 槽位并回收复用...");
const releaseSuccess = pool.releaseSlot("worker-001", "completed");
assert.ok(releaseSuccess === true, "释放槽位应成功返回 true");
assert.ok(pool.getActiveSlots().length === 1, "释放后活跃槽位应减少为 1");

// 此时由于释放了 1 个槽位，原本被阻塞的 slot3 应可重新申请
const slot3Retry = pool.acquireSlot({
	workerId: "worker-003",
	endpointId: "ep-admin-dash",
	targetHost: "admin.corp.local",
});
assert.ok(slot3Retry !== null, "释放后应能成功复用空闲槽位");
assert.ok(slot3Retry?.id === "slot-1", "slot-1 重新变为空闲后被优先复用");
console.log("  → 通过 ✓");

// 5. 动态并发窗口调节 (AdaptiveThrottle 支持)
console.log("[断言 5/5] 动态并发窗口调节 (1~4) 伸缩验证...");
pool.setMaxConcurrency(1);
assert.ok(pool.getMaxConcurrency() === 1, "并发窗口应成功收缩至 1");
// 释放一个
pool.releaseSlot("worker-002", "completed");
pool.releaseSlot("worker-003", "failed");
assert.ok(pool.getActiveSlots().length === 0, "全部释放后活跃槽位应为 0");

const metrics = pool.getMetrics();
assert.ok(metrics.completedCount === 2, "正常完成累计应为 2");
assert.ok(metrics.failedCount === 1, "失败/熔断累计应为 1");
assert.ok(metrics.totalDispatched === 3, "派发总数应为 3");
console.log("  → 通过 ✓");

console.log("==================================================================");
console.log("🎉  WorkerPool 调度池机制全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");
