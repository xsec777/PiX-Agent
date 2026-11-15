/**
 * worker-result.test.ts — WorkerResult 结构化回传与状态机对账验收断言套件 (ADR 0001/0002)
 */

import assert from "node:assert/strict";

import {
	createWorkerResult,
	validateWorkerResult,
	reconcileWorkerResult,
} from "../extension/worker-result.ts";
import { recordEndpoint, getEndpointById } from "../extension/state.ts";
import { globalWorkerPool } from "../extension/worker-pool.ts";
import { globalWatchdogCeiling } from "../extension/watchdog.ts";

console.log("==================================================================");
console.log("🛡️  PiX-Swarm: WorkerResult 回传与状态机对账断言套件 (v3.0.0-rc.1)");
console.log("==================================================================\n");

// 1. 初始化台账、槽位与看门狗环境
console.log("[断言 1/5] 前置环境准备：登记测试端点、申请槽位与启动看门狗...");
const ep = recordEndpoint({
	url: "https://shop.corp.local/api/cart/checkout",
	method: "POST",
	params: ["cart_id", "coupon"],
	discoveredFrom: "test_suite",
});
assert.ok(ep.status === "discovered", "初始状态应为 discovered");

const slot = globalWorkerPool.acquireSlot({
	workerId: "w-rc1-01",
	endpointId: ep.id,
	taskEnvelopeId: "env-rc1-001",
	targetHost: "shop.corp.local",
});
assert.ok(slot !== null, "应成功获取运行槽位");

globalWatchdogCeiling.register({
	workerId: "w-rc1-01",
	taskEnvelopeId: "env-rc1-001",
	endpointId: ep.id,
});
assert.ok(globalWatchdogCeiling.getEntry("w-rc1-01")?.status === "active", "看门狗应处于 active");
console.log("  → 通过 ✓");

// 2. WorkerResult 创建与只读校验
console.log("[断言 2/5] WorkerResult 强类型对象创建与契约校验...");
const result = createWorkerResult({
	workerId: "w-rc1-01",
	taskEnvelopeId: "env-rc1-001",
	endpointId: ep.id,
	status: "confirmed",
	action: "利用优惠券负数越权实现金额篡改",
	vulnerabilityTitle: "Logical Flaw in Checkout Coupon Bypass",
	evidenceRequest: "POST /api/cart/checkout HTTP/1.1\r\nHost: shop.corp.local\r\n\r\n{\"coupon\":\"-1000\"}",
	evidenceResponse: "HTTP/1.1 200 OK\r\n\r\n{\"total\":-500,\"status\":\"success\"}",
	extractedAssets: [
		"https://shop.corp.local/api/admin/orders",
		"https://shop.corp.local/api/internal/metrics",
	],
	turnCount: 4,
	elapsedMs: 2500,
});

assert.ok(result.id.startsWith("res-"), "结果 ID 应符合规范前缀");
assert.ok(result.status === "confirmed", "状态应为 confirmed");
assert.ok(result.extractedAssets?.length === 2, "提取资产应包含 2 条");

const validCheck = validateWorkerResult(result);
assert.ok(validCheck.valid === true, "合法 WorkerResult 校验应通过");
console.log("  → 通过 ✓");

// 3. 核心对账执行与状态机流转
console.log("[断言 3/5] reconcileWorkerResult 状态机对账与超图回写...");
const report = reconcileWorkerResult(result);
assert.ok(report.reconciled === true, "对账应标记为成功");
assert.ok(report.newStatus === "confirmed", "新状态应为 confirmed");
assert.ok(report.newAssetsAdded === 2, "应成功级联水合 2 条新端点");

const updatedEp = getEndpointById(ep.id);
assert.ok(updatedEp?.status === "confirmed", "底层端点台账状态机必须更新为 confirmed");
assert.ok(updatedEp?.vulnerabilities?.includes("Logical Flaw in Checkout Coupon Bypass"), "台账应准确记录漏洞标题");
assert.throws(() => reconcileWorkerResult(result), /结果 ID 已处理|端点已闭环/, "同一结果不得重放");
console.log("  → 通过 ✓");

// 4. 槽位与看门狗联动物理回收
console.log("[断言 4/5] 状态机对账联动 WorkerPool 槽位释放与看门狗注销解除...");
assert.ok(report.slotReleased === true, "对账回执应确认槽位已释放");
assert.ok(report.watchdogCleared === true, "对账回执应确认看门狗已解除");

const slotCheck = globalWorkerPool.getSlotByWorkerId("w-rc1-01");
assert.ok(slotCheck === null, "调度池中该 Worker 槽位应已重置为空闲");

const watchdogCheck = globalWatchdogCeiling.getEntry("w-rc1-01");
assert.ok(watchdogCheck?.status === "cleared", "看门狗监视器状态应更新为 cleared");
console.log("  → 通过 ✓");

// 5. 级联收录新资产的台账可测性验证
console.log("[断言 5/5] 级联水合资产完全匹配去重与待测队列验证...");
const adminEp = getEndpointById("https://shop.corp.local/api/admin/orders");
assert.ok(adminEp !== undefined, "新提取的端点资产必须已被自动录入端点台账");
assert.ok(adminEp?.status === "discovered", "新级联入账的端点初始状态应为 discovered");
console.log("  → 通过 ✓");

console.log("==================================================================");
console.log("🎉  WorkerResult 回传与状态机对账全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");
