/**
 * task-envelope.test.ts — TaskEnvelope 不可变任务信封契约与序列化验收套件 (ADR 0001/0002)
 */

import assert from "node:assert/strict";

import {
	createTaskEnvelope,
	validateTaskEnvelope,
	serializeTaskEnvelope,
	deserializeTaskEnvelope,
	type TaskEnvelope,
} from "../extension/task-envelope.ts";

console.log("==================================================================");
console.log("🛡️  PiX-Swarm: TaskEnvelope 任务信封契约断言套件 (v3.0.0-alpha.2)");
console.log("==================================================================\n");

// 1. 创建与默认值生成
console.log("[断言 1/5] TaskEnvelope 合法创建与缺省配额初始化...");
const env = createTaskEnvelope({
	endpointId: "ep-001",
	targetUrl: "https://auth.internal.corp:8443/api/v2/tokens",
	httpMethod: "GET",
	params: ["client_id", "grant_type"],
	contextFacts: ["后端为 SpringBoot 2.7", "前置云 WAF 阻断探测"],
});

assert.ok(env.id.startsWith("env-"), "信封 ID 应符合规范前缀");
assert.ok(env.targetHost === "auth.internal.corp:8443", "应精准提取 host 与端口");
assert.ok(env.probeQuota.maxTurns === 6, "默认推理轮次硬顶应为 6 轮");
assert.ok(env.probeQuota.timeoutMs === 180000, "默认超时应为 180s");
assert.ok(env.assignedTier === "FastTier", "默认应指派 FastTier 高速脑");
assert.ok(env.boundary.readOnly === true, "默认任务信封应为只读");
assert.ok(env.boundary.allowedHosts.includes("auth.internal.corp:8443"), "白名单应包含目标 host");
console.log("  → 通过 ✓");

// 2. 深度冻结 (Object.freeze) 不可变性验证
console.log("[断言 2/5] TaskEnvelope 深度冻结与不可变性物理防护...");
let mutationBlocked = false;
try {
	// @ts-expect-error 测试篡改已冻结属性
	env.targetUrl = "https://hacker.com/malicious";
} catch {
	mutationBlocked = true;
}
if (!mutationBlocked) {
	// 严格模式外若未抛错，验证其值未被篡改
	assert.ok(env.targetUrl === "https://auth.internal.corp:8443/api/v2/tokens", "不可变对象的值不得改变");
}

let deepMutationBlocked = false;
try {
	// @ts-expect-error 测试篡改内层配额属性
	env.probeQuota.maxTurns = 999;
} catch {
	deepMutationBlocked = true;
}
if (!deepMutationBlocked) {
	assert.ok(env.probeQuota.maxTurns === 6, "内嵌配额对象的字段不得被篡改");
}
console.log("  → 通过 ✓");

// 3. 契约校验器 validateTaskEnvelope
console.log("[断言 3/5] 刚性契约校验对非法与残缺字段的拦截...");
const invalidEnv1 = {
	endpointId: "",
	targetUrl: "not_a_valid_url",
	httpMethod: "INVALID_METHOD",
};
const res1 = validateTaskEnvelope(invalidEnv1);
assert.ok(res1.valid === false, "残缺字段应被判定为无效");
assert.ok(res1.errors.length >= 3, "应准确捕获多个契约违背项");

assert.throws(
	() => createTaskEnvelope({ endpointId: "ep-write", targetUrl: "https://example.test/transfer", httpMethod: "POST" }),
	/只读任务仅允许/,
);

const validCheck = validateTaskEnvelope(env);
assert.ok(validCheck.valid === true, "合法 TaskEnvelope 校验应通过");
console.log("  → 通过 ✓");

// 4. 确定性序列化与安全反序列化
console.log("[断言 4/5] 任务信封序列化与双向反序列化对账...");
const serialized = serializeTaskEnvelope(env);
assert.ok(typeof serialized === "string" && serialized.includes("auth.internal.corp:8443"), "序列化应输出合法 JSON 文本");

const restored = deserializeTaskEnvelope(serialized);
assert.ok(restored.id === env.id, "反序列化后 ID 必须一致");
assert.ok(restored.endpointId === env.endpointId, "endpointId 必须一致");
assert.ok(restored.probeQuota.maxTurns === 6, "配额数值必须完全还原");
assert.ok(restored.contextFacts.length === 2, "背景事实必须完整还原");

// 验证反序列化后的新对象也是深度冻结的
let restoredFreezeCheck = false;
try {
	// @ts-expect-error 篡改反序列化对象
	restored.params = ["tampered"];
} catch {
	restoredFreezeCheck = true;
}
if (!restoredFreezeCheck) {
	assert.ok(restored.params.length === 2, "反序列化对象也必须深度冻结");
}
console.log("  → 通过 ✓");

// 5. 跨站点越界边界防护定义
console.log("[断言 5/5] 安全红线围栏与只读探测模式契约...");
const safeEnv = createTaskEnvelope({
	endpointId: "ep-002",
	targetUrl: "https://finance.internal.corp/api/balance",
	httpMethod: "GET",
	boundary: {
		forbiddenPaths: ["/transfer", "/delete"],
		readOnly: true,
	},
});
assert.ok(safeEnv.boundary.readOnly === true, "只读探测标志应为 true");
assert.ok(safeEnv.boundary.forbiddenPaths.includes("/transfer"), "禁入路径应包含高危业务接口");
console.log("  → 通过 ✓");

console.log("==================================================================");
console.log("🎉  TaskEnvelope 任务信封全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");
