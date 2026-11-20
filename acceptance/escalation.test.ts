/**
 * escalation.test.ts — EscalationPromotion 强阻抗受挫升档建议机制验收套件 (ADR 0003)
 */

import assert from "node:assert/strict";
import { EscalationPromoter } from "../extension/escalation.ts";
import { createTaskEnvelope } from "../extension/task-envelope.ts";

console.log("==================================================================");
console.log("🛡️  PiX-Dispatch: EscalationPromotion 升档建议机制断言套件 (v3.2.1)");
console.log("==================================================================\n");

// 1. 基线平稳状态不触发升档
console.log("[断言 1/5] 基线顺畅探测 (failureStreak=0) 维持 FastTier 高速脑...");
const promoter = new EscalationPromoter(2);
const normalEp = {
	id: "ep-normal-01",
	status: "probing" as const,
	failureStreak: 0,
	escalationLevel: 0,
};
const decision1 = promoter.evaluateEscalation(normalEp);
assert.ok(decision1.shouldEscalate === false, "顺畅状态不应触发升档");
assert.ok(decision1.targetTier === "FastTier", "目标档位应维持 FastTier");
console.log("  → 通过 ✓");

// 2. 连续失败达到阈值 (failureStreak >= 2) 触发升档
console.log("[断言 2/5] 连续探针失败达到阈值 (failureStreak >= 2) 自动触发升档决策...");
const stuckEp = {
	id: "ep-stuck-02",
	status: "probing" as const,
	failureStreak: 2,
	escalationLevel: 0,
};
const decision2 = promoter.evaluateEscalation(stuckEp);
assert.ok(decision2.shouldEscalate === true, "达到连续失败阈值必须触发升档");
assert.ok(decision2.targetTier === "SmartTier", "目标档位应升级为 SmartTier 旗舰脑");
assert.ok(typeof decision2.reason === "string" && decision2.reason.includes("连续失败次数"), "必须给出连续失败说明");
console.log("  → 通过 ✓");

// 3. 状态跃迁至 bypassing (WAF 强阻抗) 瞬间触发升档
console.log("[断言 3/5] 端点进入 bypassing 强阻抗状态触发自动换将决策...");
const wafEp = {
	id: "ep-waf-03",
	status: "bypassing" as const,
	failureStreak: 1,
	escalationLevel: 1,
};
const decision3 = promoter.evaluateEscalation(wafEp);
assert.ok(decision3.shouldEscalate === true, "bypassing 状态必须触发升档换将");
assert.ok(decision3.targetTier === "SmartTier", "必须换将至 SmartTier 旗舰大脑");
assert.ok(typeof decision3.reason === "string" && decision3.reason.includes("WAF 强阻抗"), "说明应指出 WAF 拦截");
console.log("  → 通过 ✓");

// 4. promoteTaskEnvelope 重新组装信封并注入攻坚配置
console.log("[断言 4/5] promoteTaskEnvelope 任务信封升级与变异配额继承...");
const originalEnv = createTaskEnvelope({
	endpointId: "ep-waf-03",
	targetUrl: "https://finance.example.test/api/balance",
	httpMethod: "GET",
	params: ["account", "amount"],
	assignedTier: "FastTier",
	contextFacts: ["中间件为 Nginx + Cloudflare WAF"],
});
assert.ok(originalEnv.assignedTier === "FastTier", "原始信封应为 FastTier");
assert.ok(originalEnv.probeQuota.maxMutations === 5, "原始变异配额应为 5");

const promotedEnv = promoter.promoteTaskEnvelope(originalEnv, decision3.reason!);
assert.ok(promotedEnv.assignedTier === "SmartTier", "升档后信封必须锁定 SmartTier");
assert.ok(promotedEnv.probeQuota.maxMutations === originalEnv.probeQuota.maxMutations, "升档不得扩大原信封变异配额");
assert.ok(promotedEnv.contextFacts.length === 2, "背景事实必须追加升档接管事实");
assert.ok(promotedEnv.contextFacts[1].includes("SmartTier 处理"), "追加事实应包含旗舰脑接管说明");

// 验证新信封深度冻结
let frozenCheck = false;
try {
	// @ts-expect-error 篡改升档信封
	promotedEnv.assignedTier = "FastTier";
} catch {
	frozenCheck = true;
}
if (!frozenCheck) {
	assert.ok(promotedEnv.assignedTier === "SmartTier", "升档信封必须具备不可变性物理防护");
}
console.log("  → 通过 ✓");

// 5. 全局升档记录与追溯台账
console.log("[断言 5/5] 升档换将全局台账记录与追溯对账...");
const record = promoter.getRecord("ep-waf-03");
assert.ok(record !== undefined, "必须准确记录升档条目");
assert.ok(record?.originalEnvelopeId === originalEnv.id, "必须记录前序原始信封 ID");
assert.ok(record?.promotedEnvelopeId === promotedEnv.id, "必须记录升级后的新信封 ID");
assert.ok(promoter.getAllRecords().length === 1, "全局台账应记录 1 条升档事件");
console.log("  → 通过 ✓");

console.log("==================================================================");
console.log("🎉  EscalationPromotion 本地升档建议全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");

// 收紧的配额、只读和禁入边界必须原样继承。
const limited = createTaskEnvelope({
	endpointId: "ep-limited", targetUrl: "https://example.test/api/read",
	probeQuota: { maxTurns: 2, timeoutMs: 5000, maxMutations: 1 },
	boundary: { readOnly: true, allowedHosts: ["example.test"], forbiddenPaths: ["/admin"] },
});
const limitedPromotion = promoter.promoteTaskEnvelope(limited, "local fixture");
assert.deepEqual(limitedPromotion.probeQuota, limited.probeQuota);
assert.deepEqual(limitedPromotion.boundary, limited.boundary);
assert.ok(Object.isFrozen(limitedPromotion.boundary.allowedHosts));
assert.throws(() => promoter.promoteTaskEnvelope(limitedPromotion, "again"), /SmartTier/);
assert.throws(() => promoter.promoteTaskEnvelope(limited, " "), /不能为空/);
for (const status of ["confirmed", "rejected", "blocked"] as const) {
	assert.equal(promoter.evaluateEscalation({ ...stuckEp, status }).shouldEscalate, false);
}
for (const threshold of [NaN, Infinity, 0, -1, 1.5]) assert.throws(() => new EscalationPromoter(threshold));
const detachedRecord = promoter.getRecord("ep-limited")!;
(detachedRecord as { reason: string }).reason = "modified";
assert.notEqual(promoter.getRecord("ep-limited")!.reason, "modified");
promoter.reset();
assert.equal(promoter.getAllRecords().length, 0);
