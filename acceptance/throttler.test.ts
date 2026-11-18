/**
 * throttler.test.ts — AdaptiveThrottle 遇阻自适应单并发降级机制验收套件 (ADR 0004)
 */

import assert from "node:assert/strict";
import { AdaptiveThrottler } from "../extension/throttler.ts";
import { globalWorkerPool } from "../extension/worker-pool.ts";

console.log("==================================================================");
console.log("🛡️  PiX-Pacing: AdaptiveThrottle 自适应流控降级断言套件 (v3.1.1)");
console.log("==================================================================\n");

// 1. 初始化基线状态
console.log("[断言 1/5] AdaptiveThrottler 初始化基线窗口与正常态...");
const throttler = new AdaptiveThrottler({
	baselineConcurrency: 2,
	cooldownMs: 3000,
	recoveryThreshold: 10,
});
const r1 = throttler.getReport();
assert.ok(r1.state === "normal", "初始状态应为 normal");
assert.ok(r1.currentWindow === 2, "初始并发窗口应为基线 2");
assert.ok(r1.inCooldown === false, "初始不应处于冷却期");
assert.ok(r1.consecutiveSuccess === 0, "初始成功计数应为 0");
console.log("  → 通过 ✓");

// 2. 遭遇 429 瞬间降级单并发与 WorkerPool 联动
console.log("[断言 2/5] 遭遇 HTTP 429 频控瞬间收缩至 1 并联动 WorkerPool...");
globalWorkerPool.setMaxConcurrency(2);
const t0 = 1000000;
const r429 = throttler.recordFeedback({ statusCode: 429, now: t0 });

assert.ok(r429.state === "throttled_429", "状态应更新为 throttled_429");
assert.ok(r429.currentWindow === 1, "并发窗口必须瞬间降级至 1");
assert.ok(r429.inCooldown === true, "应处于冷却期");
assert.ok(throttler.isInCooldown(t0 + 1000) === true, "在冷却期内 (t0+1000) 应返回 true");
assert.ok(globalWorkerPool.getMaxConcurrency() === 1, "WorkerPool 最大并发应同步强制降至 1");
for (let i = 0; i < 10; i++) throttler.recordFeedback({ statusCode: 200, now: t0 + 100 + i });
assert.equal(throttler.getCurrentWindow(), 1, "冷却期内不能恢复窗口");
assert.equal(throttler.getReport(t0 + 1000).consecutiveSuccess, 0, "冷却反馈不计入恢复序列");
console.log("  → 通过 ✓");

// 3. 冷却期自然结束判断
console.log("[断言 3/5] 冷却期超时自然解除...");
assert.ok(throttler.isInCooldown(t0 + 3001) === false, "超过 3000ms 后冷却期应自然结束");
assert.ok(throttler.getCurrentWindow() === 1, "冷却期结束后并发窗口仍应保持单并发 (1)，等待恢复阈值");
console.log("  → 通过 ✓");

// 4. 遭遇 WAF 403 阻断与超时特征熔断
console.log("[断言 4/5] 遭遇 WAF 403 / Timeout 阻断再次降级与清零成功计数...");
// 模拟有 3 次正常响应
throttler.recordFeedback({ statusCode: 200, now: t0 + 4000 });
throttler.recordFeedback({ statusCode: 200, now: t0 + 4100 });
throttler.recordFeedback({ statusCode: 200, now: t0 + 4200 });
assert.ok(throttler.getReport().consecutiveSuccess === 3, "连续成功应累加为 3");

throttler.recordFeedback({ statusCode: 500, now: t0 + 4300 });
assert.equal(throttler.getReport(t0 + 4300).consecutiveSuccess, 0, "失败响应重置连续恢复计数");
// 遭遇 WAF 403 阻断
const rWaf = throttler.recordFeedback({ statusCode: 403, isWafBlock: true, now: t0 + 5000 });
assert.ok(rWaf.state === "throttled_waf", "状态应为 throttled_waf");
assert.ok(rWaf.consecutiveSuccess === 0, "遭遇阻断后成功计数必须立刻清零 (0)");
assert.ok(rWaf.currentWindow === 1, "并发窗口保持为 1");
console.log("  → 通过 ✓");

// 5. 连续累计 10 次正常响应后平滑自动恢复至基线 (2)
console.log("[断言 5/5] 连续累计 10 次正常响应后平滑恢复至基线并发...");
const tRecover = t0 + 10000;
for (let i = 1; i <= 9; i++) {
	const rep = throttler.recordFeedback({ statusCode: 200, now: tRecover + i * 100 });
	assert.ok(rep.currentWindow === 1, `第 ${i} 次成功时仍应保持单并发 1`);
}

// 第 10 次正常响应：触发恢复
const rRestored = throttler.recordFeedback({ statusCode: 200, now: tRecover + 1000 });
assert.ok(rRestored.state === "normal", "达到 10 次后状态应恢复为 normal");
assert.ok(rRestored.currentWindow === 2, "并发窗口应成功恢复回基线 2");
assert.ok(globalWorkerPool.getMaxConcurrency() === 2, "WorkerPool 最大并发应同步恢复为 2");
console.log("  → 通过 ✓");

const timeout = throttler.recordFeedback({ statusCode: 0, isTimeout: true, now: tRecover + 2000 });
assert.equal(timeout.state, "throttled_timeout");
assert.equal(globalWorkerPool.getMaxConcurrency(), 1);
throttler.reset();
assert.equal(throttler.isInCooldown(tRecover + 2000), false);
assert.equal(globalWorkerPool.getMaxConcurrency(), 2);
assert.throws(() => new AdaptiveThrottler({ baselineConcurrency: NaN }));
assert.throws(() => new AdaptiveThrottler({ cooldownMs: Infinity }));
assert.throws(() => new AdaptiveThrottler({ recoveryThreshold: 3.5 }));
assert.equal(new AdaptiveThrottler({ baselineConcurrency: 100 }).getCurrentWindow(), globalWorkerPool.getMetrics().totalSlots);

console.log("==================================================================");
console.log("🎉  AdaptiveThrottle 自适应流控全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");
