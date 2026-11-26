import assert from "node:assert/strict";
import { SubAgentModelPreference, globalSubAgentModelPreference } from "../extension/subagent-config.ts";
import { ModelRouter, globalModelRouter } from "../extension/model-tiering.ts";
import { historyLinesOf, resetSectionLines } from "../extension/state.ts";

const preference = new SubAgentModelPreference();
const initial = preference.get();
assert.equal(initial.inheritMain, true);
assert.equal(initial.subAgentModel, null);
assert.equal(Object.isFrozen(initial), true);

const selected = preference.set({ provider: "fixture-provider", modelId: "fixture-fast-model" }, 1800000000000);
assert.equal(selected.inheritMain, false);
assert.deepEqual(selected.subAgentModel, { provider: "fixture-provider", modelId: "fixture-fast-model" });
assert.equal(selected.updatedAt, 1800000000000);
assert.equal(Object.isFrozen(selected.subAgentModel), true);
assert.throws(() => preference.set({ provider: "", modelId: "fixture" }), TypeError);
assert.throws(() => preference.set({ provider: "fixture", modelId: "   " }), TypeError);
assert.throws(() => preference.set(null, -1), RangeError);

// The local router accepts an explicit configuration; it never reads a user model config file.
const router = new ModelRouter({ fastModel: { provider: "fixture-provider", modelName: "fixture-fast-model" } });
assert.equal(router.getModelForTier("FastTier").modelName, "fixture-fast-model");
assert.equal(router.resolveModelForRole("worker").tier, "FastTier");
assert.equal(router.resolveModelForRole("planner").tier, "SmartTier");
preference.set(null, 1800000000001);
assert.equal(preference.get().inheritMain, true);
assert.equal(preference.get().subAgentModel, null);

globalSubAgentModelPreference.reset();
globalModelRouter.reset();
assert.equal(globalSubAgentModelPreference.get().inheritMain, true);
assert.equal(globalModelRouter.getMetrics().totalDispatches, 0);

// New local section state remains empty until the caller explicitly loads history.
resetSectionLines();
assert.equal(historyLinesOf().length, 0);
console.log("SubAgent local preference, router fallback and clean session checks passed.");
