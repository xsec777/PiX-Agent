/**
 * watchdog.test.ts — WatchdogCeiling 阈值状态记录器硬顶机制验收套件 (ADR 0005)
 */

import assert from "node:assert/strict";
import { WatchdogCeiling } from "../extension/watchdog.ts";


console.log("==================================================================");
console.log("🛡️  PiX-Swarm: WatchdogCeiling 阈值状态记录器断言套件 (v3.0.0-beta.2)");
console.log("==================================================================\n");

// 1. 初始化登记与基线状态
console.log("[断言 1/5] 看门狗监视器登记与默认硬顶配额初始化...");
const watchdog = new WatchdogCeiling();
const entry1 = watchdog.register({
	workerId: "w-normal-01",
	taskEnvelopeId: "env-001",
	endpointId: "ep-001",
	maxTurns: 6,
	timeoutMs: 180000,
});
assert.ok(entry1.status === "active", "初始状态应为 active");
assert.ok(entry1.turnCount === 0, "初始轮次应为 0");
assert.ok(entry1.maxTurns === 6, "默认最大轮次应为 6 轮");
assert.ok(entry1.timeoutMs === 180000, "默认最大超时应为 180s");
assert.throws(() => watchdog.register({ workerId: "w-normal-01", taskEnvelopeId: "other", endpointId: "other" }), /已有活动监视器/);
console.log("  → 通过 ✓");

// 2. 正常轮次推进 (1~6 轮不熔断)
console.log("[断言 2/5] 正常轮次推进 (1~6 轮) 保持 active 态...");
for (let i = 1; i <= 6; i++) {
	const res = watchdog.recordTurn("w-normal-01", entry1.startTime);
	assert.ok(res.tripped === false, `第 ${i} 轮不应触发熔断`);
	assert.ok(res.turnCount === i, `轮次计数应为 ${i}`);
	assert.ok(res.status === "active", "状态应保持 active");
}
console.log("  → 通过 ✓");

// 3. 轮次阈值超限 (第 7 轮 > 6 轮强制熔断)
console.log("[断言 3/5] 轮次突破硬顶 (第 7 轮 > 6) 记录轮次超限状态...");
const resTurn7 = watchdog.recordTurn("w-normal-01", entry1.startTime);
assert.ok(resTurn7.tripped === true, "超过 6 轮必须强制触发熔断 (tripped: true)");
assert.ok(resTurn7.status === "tripped_turns", "状态应更新为 tripped_turns");
assert.ok(typeof resTurn7.reason === "string" && resTurn7.reason.includes("轮次阈值超限"), "必须给出明确的物理熔断原因");
console.log("  → 通过 ✓");

// 4. 墙钟时间阈值超限 (耗时 > 180,000ms 强制熔断)
console.log("[断言 4/5] 墙钟时间突破硬顶 (>180,000ms) 记录超时状态...");
const startTime = 1000000;
watchdog.register({
	workerId: "w-timeout-02",
	taskEnvelopeId: "env-002",
	endpointId: "ep-002",
	maxTurns: 6,
	timeoutMs: 180000,
	startTime: startTime,
});

// 在 100 秒时检查：未超时
const check100s = watchdog.check("w-timeout-02", startTime + 100000);
assert.ok(check100s.tripped === false, "100s 处于允许范围内不应熔断");

// 在 180.001 秒时检查：已超时
const check181s = watchdog.check("w-timeout-02", startTime + 180001);
assert.ok(check181s.tripped === true, "超过 180,000ms 必须瞬间熔断");
assert.ok(check181s.status === "tripped_timeout", "状态应标记为 tripped_timeout");
assert.ok(typeof check181s.reason === "string" && check181s.reason.includes("时间阈值超限"), "必须给出超时熔断原因");

const trippedList = watchdog.getTrippedEntries();
assert.ok(trippedList.length === 2, "熔断列表应准确记录 2 个熔断条目");
console.log("  → 通过 ✓");

// 5. 正常结案解除看门狗注销 (clear)
console.log("[断言 5/5] 正常 worker_submit 退出时注销并解除看门狗...");
watchdog.register({
	workerId: "w-clean-03",
	taskEnvelopeId: "env-003",
	endpointId: "ep-003",
});
watchdog.recordTurn("w-clean-03"); // 1 轮
const cleared = watchdog.clear("w-clean-03");
assert.ok(cleared === true, "注销应返回 true");
const entry3 = watchdog.getEntry("w-clean-03");
assert.ok(entry3?.status === "cleared", "状态应更新为 cleared");
console.log("  → 通过 ✓");

console.log("==================================================================");
console.log("🎉  WatchdogCeiling 阈值状态记录器全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");
