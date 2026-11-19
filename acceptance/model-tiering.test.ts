/**
 * model-tiering.test.ts — SmartTier 与 FastTier 双档模型动态路由器机制验收套件 (ADR 0003)
 */

import assert from "node:assert/strict";
import { ModelRouter } from "../extension/model-tiering.ts";

console.log("==================================================================");
console.log("🛡️  PiX-Model: SmartTier / FastTier 双档模型路由断言套件 (v3.2.0)");
console.log("==================================================================\n");

// 1. 双档模型初始化与配置对账
console.log("[断言 1/5] 双档模型初始化与默认参数对账...");
const router = new ModelRouter({
	smartModel: { modelName: "claude-3-5-sonnet-20241022", temperature: 0.2 },
	fastModel: { modelName: "deepseek-v3-speed", temperature: 0.1 },
});
assert.ok(router.isDualTierActive() === true, "配置两个不同模型时应激活双档工作模式");

const smartConfig = router.getModelForTier("SmartTier");
assert.ok(smartConfig.tier === "SmartTier", "SmartTier 标识应正确");
assert.ok(smartConfig.modelName === "claude-3-5-sonnet-20241022", "旗舰模型名称应正确");
assert.ok(smartConfig.temperature === 0.2, "旗舰模型采样温度应为 0.2");

const fastConfig = router.getModelForTier("FastTier");
assert.ok(fastConfig.tier === "FastTier", "FastTier 标识应正确");
assert.ok(fastConfig.modelName === "deepseek-v3-speed", "高速轻量模型名称应正确");
assert.ok(fastConfig.temperature === 0.1, "轻量模型采样温度应为 0.1");
console.log("  → 通过 ✓");

// 2. 角色路由自动对齐 (Planner -> SmartTier, Worker -> FastTier)
console.log("[断言 2/5] 角色路由自动对齐：Planner 旗舰脑与 Worker 高速脑...");
const plannerModel = router.resolveModelForRole("planner");
assert.ok(plannerModel.tier === "SmartTier", "Planner 主控大脑必须无条件分配 SmartTier 旗舰模型");
assert.ok(plannerModel.modelName === "claude-3-5-sonnet-20241022", "Planner 模型名应匹配旗舰模型");

const workerModel = router.resolveModelForRole("worker");
assert.ok(workerModel.tier === "FastTier", "常规 Worker 初始默认必须分配 FastTier 高速廉价模型");
assert.ok(workerModel.modelName === "deepseek-v3-speed", "Worker 模型名应匹配轻量模型");
console.log("  → 通过 ✓");

// 3. 受挫/强阻抗强制路由旗舰脑 (forceSmartTier)
console.log("[断言 3/5] 遭遇攻坚硬骨头时的 forceSmartTier 强制路由...");
const hardWorkerModel = router.resolveModelForRole("worker", { forceSmartTier: true });
assert.ok(hardWorkerModel.tier === "SmartTier", "强制升档时 Worker 必须分配到 SmartTier 旗舰模型");
assert.ok(hardWorkerModel.modelName === "claude-3-5-sonnet-20241022", "模型名称必须匹配旗舰模型");
console.log("  → 通过 ✓");

// 4. 动态更新模型参数与单模型平滑退化
console.log("[断言 4/5] 动态参数热更与单模型平滑退化兼容...");
// 动态更新 SmartTier 温度
router.configureTier("SmartTier", { temperature: 0.3 });
assert.ok(router.getModelForTier("SmartTier").temperature === 0.3, "温度应成功热更为 0.3");

// 模拟用户仅配置单个模型的情况
const singleModelRouter = new ModelRouter({
	smartModel: { modelName: "same-model" },
	fastModel: { modelName: "same-model", provider: "anthropic" },
});
assert.ok(singleModelRouter.isDualTierActive() === false, "单模型场景应平滑退化，不激活双档差异");
assert.ok(singleModelRouter.resolveModelForRole("planner").modelName === "same-model", "Planner 路由到统一模型");
assert.ok(singleModelRouter.resolveModelForRole("worker").modelName === "same-model", "Worker 路由到统一模型");
console.log("  → 通过 ✓");

// 5. 调度指标与 Token 经济学模型对账
console.log("[断言 5/5] 调度指标与 Token 经济学节约率统计...");
router.reset();
// 模拟 8 次 Worker 常规探测 (FastTier) + 2 次 Planner/攻坚推演 (SmartTier)
for (let i = 0; i < 8; i++) router.resolveModelForRole("worker");
for (let i = 0; i < 2; i++) router.resolveModelForRole("planner");

const metrics = router.getMetrics();
assert.ok(metrics.fastTierDispatches === 8, "FastTier 派发次数应为 8");
assert.ok(metrics.smartTierDispatches === 2, "SmartTier 派发次数应为 2");
assert.ok(metrics.totalDispatches === 10, "总派发次数应为 10");
assert.ok(metrics.estimatedTokenSavingsRatio >= 0.5, "80% 高速模型替代预期 Token 节约率应 >= 50%");
console.log("  → 通过 ✓");

console.log("==================================================================");
console.log("🎉  SmartTier / FastTier 双档模型动态路由全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");

// 单档配置复用；provider 参与模型身份判断。
for (const config of [
	{ smartModel: { modelName: "single", provider: "local" } },
	{ fastModel: { modelName: "single", provider: "local" } },
]) {
	const single = new ModelRouter(config);
	assert.equal(single.isDualTierActive(), false);
	assert.equal(single.resolveModelForRole("planner").modelName, "single");
	assert.equal(single.resolveModelForRole("worker").provider, "local");
	assert.equal(single.getMetrics().estimatedTokenSavingsRatio, 0);
}
const providers = new ModelRouter({
	smartModel: { modelName: "shared", provider: "a" },
	fastModel: { modelName: "shared", provider: "b" },
});
assert.equal(providers.isDualTierActive(), true);
const detached = router.getModelForTier("SmartTier");
(detached as { modelName: string }).modelName = "changed-copy";
assert.notEqual(router.getModelForTier("SmartTier").modelName, "changed-copy");
