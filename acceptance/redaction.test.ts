/**
 * redaction.test.ts — RequestRedactionGate 请求头 Token 确定性洗脱物理闸门断言套件 (ADR 0006)
 */

import assert from "node:assert/strict";
import { globalWorkerPool } from "../extension/worker-pool.ts";
import { globalWatchdogCeiling } from "../extension/watchdog.ts";
import { redactEvidenceRequest, runRequestRedactionGate } from "../extension/redaction.ts";
import { reconcileWorkerResult, createWorkerResult } from "../extension/worker-result.ts";
import { recordEndpoint, getEndpointById } from "../extension/state.ts";

console.log("==================================================================");
console.log("🛡️  PiX-Hygiene: RequestRedactionGate 凭据洗脱物理闸门断言 (v3.3.0)");
console.log("==================================================================\n");

// 1. Authorization: Bearer 确定性洗脱
console.log("[断言 1/5] Authorization: Bearer 活 Token 物理洗脱...");
const rawReq1 =
	"POST /api/v1/user/profile HTTP/1.1\r\n" +
	"Host: auth.corp.local\r\n" +
	"Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sometoken\r\n" +
	"Content-Type: application/json\r\n\r\n" +
	'{"name":"admin"}';

const clean1 = redactEvidenceRequest(rawReq1);
assert.ok(!clean1.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), "活 Token 必须被彻底剥离");
assert.ok(clean1.includes("Authorization: Bearer [REDACTED_TOKEN]"), "必须替换为标准化脱敏占位符");
assert.ok(clean1.includes("Host: auth.corp.local"), "非敏感 Header 必须完整保留");
console.log("  → 通过 ✓");

// 2. Cookie 活会话物理洗脱
console.log("[断言 2/5] Cookie 敏感活会话确定性洗脱...");
const rawReq2 =
	"GET /admin/dashboard HTTP/1.1\r\n" +
	"Host: portal.corp.local\r\n" +
	"Cookie: PHPSESSID=c2f542918b8e4; remember_me=true; sso_token=live_session_token_xyz\r\n" +
	"User-Agent: Mozilla/5.0\r\n\r\n";

const clean2 = redactEvidenceRequest(rawReq2);
assert.ok(!clean2.includes("c2f542918b8e4"), "活 Cookie 必须被物理抹除");
assert.ok(!clean2.includes("live_session_token_xyz"), "SSO 活 Token 必须被抹除");
assert.ok(clean2.includes("Cookie: [REDACTED_COOKIE]"), "必须替换为标准 Cookie 占位符");
console.log("  → 通过 ✓");

// 3. 自定义认证头与 Basic Auth 洗脱
console.log("[断言 3/5] X-Api-Key 与 Basic Auth 物理洗脱...");
const rawReq3 =
	"GET /api/metrics HTTP/1.1\r\n" +
	"Host: monitor.corp.local\r\n" +
	"X-Api-Key: super-secret-internal-key-9988\r\n" +
	"Authorization: Basic YWRtaW46cGFzc3dvcmQxMjM=\r\n\r\n";

const clean3 = redactEvidenceRequest(rawReq3);
assert.ok(!clean3.includes("super-secret-internal-key-9988"), "API Key 必须被洗脱");
assert.ok(!clean3.includes("YWRtaW46cGFzc3dvcmQxMjM="), "Basic 凭据必须被洗脱");
assert.ok(clean3.includes("X-Api-Key: [REDACTED_TOKEN]"), "X-Api-Key 应标准化替换");
assert.ok(clean3.includes("Authorization: Basic [REDACTED_CREDENTIAL]"), "Basic 凭据应标准化替换");
console.log("  → 通过 ✓");

// 4. 请求体 JSON 与 Query 参数敏感口令洗脱
console.log("[断言 4/5] 请求体敏感口令与 Query 参数洗脱 (复现结构保真)...");
const rawReq4 =
	"POST /login?token=sensitive_query_token_123 HTTP/1.1\r\n" +
	"Host: login.corp.local\r\n" +
	"Content-Type: application/json\r\n\r\n" +
	'{"username":"tester","password":"myRealPassword#2026","client_secret":"appSecret999"}';

const res4 = runRequestRedactionGate(rawReq4);
assert.ok(!res4.redacted.includes("sensitive_query_token_123"), "URL Query Token 必须被洗脱");
assert.ok(!res4.redacted.includes("myRealPassword#2026"), "JSON 明文密码必须被洗脱");
assert.ok(!res4.redacted.includes("appSecret999"), "client_secret 必须被洗脱");
assert.ok(res4.redacted.includes('"password":"[REDACTED_SECRET]"'), "必须保持 JSON 键名与双引号语法完整");
assert.ok(res4.redacted.includes('"username":"tester"'), "非敏感业务参数必须完整保留以供审计复现");
assert.ok(res4.redactedTokensCount >= 3, "统计计数应捕获至少 3 处敏感项");
console.log("  → 通过 ✓");

// 5. 联动超图对账管道端到端验证
console.log("[断言 5/5] 状态机超图对账物理管道自动脱敏验证...");
const ep = recordEndpoint({
	url: "https://auth.corp.local/api/check",
	method: "POST",
});

globalWorkerPool.acquireSlot({ workerId: "w-clean-test", endpointId: ep.id, taskEnvelopeId: "env-test", targetHost: "auth.corp.local" });
globalWatchdogCeiling.register({ workerId: "w-clean-test", endpointId: ep.id, taskEnvelopeId: "env-test" });
const dirtyResult = createWorkerResult({
	workerId: "w-clean-test",
	taskEnvelopeId: "env-test",
	endpointId: ep.id,
	status: "confirmed",
	action: "测试带凭据请求存证",
	vulnerabilityTitle: "Sensitive Endpoint Exposure",
	evidenceRequest:
		"POST /api/check HTTP/1.1\r\n" +
		"Host: auth.corp.local\r\n" +
		"Cookie: admin_sid=live_sess_888999\r\n" +
		"Authorization: Bearer my_live_jwt_token\r\n\r\n",
	evidenceResponse: "HTTP/1.1 200 OK\r\n\r\n{\"data\":\"sensitive\"}",
});

reconcileWorkerResult(dirtyResult);

const savedEp = getEndpointById(ep.id);
assert.ok(savedEp?.evidenceRequest !== undefined, "台账必须留存证据请求包");
assert.ok(!savedEp?.evidenceRequest?.includes("live_sess_888999"), "台账存储的请求包绝不得包含活 Cookie");
assert.ok(!savedEp?.evidenceRequest?.includes("my_live_jwt_token"), "台账存储的请求包绝不得包含活 JWT");
assert.ok(savedEp?.evidenceRequest?.includes("[REDACTED_COOKIE]"), "必须已洗脱为 [REDACTED_COOKIE]");
assert.ok(savedEp?.evidenceRequest?.includes("[REDACTED_TOKEN]"), "必须已洗脱为 [REDACTED_TOKEN]");
console.log("  → 通过 ✓");

console.log("==================================================================");
console.log("🎉  RequestRedactionGate 凭据洗脱物理闸门全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");

// Escaped JSON remains syntactically valid; repeated redaction is idempotent.
const escaped = JSON.stringify({ password: 'synthetic"quoted\value', name: "fixture" });
const escapedClean = redactEvidenceRequest(escaped);
assert.equal(JSON.parse(escapedClean).password, "[REDACTED_SECRET]");
assert.equal(JSON.parse(escapedClean).name, "fixture");
assert.equal(redactEvidenceRequest(clean1), clean1);
assert.equal(runRequestRedactionGate(clean1).modified, false);
assert.equal(runRequestRedactionGate(clean1).redactedTokensCount, 0);
const folded = "GET / HTTP/1.1\r\nCookie: synthetic-first\r\n synthetic-continuation\r\nCookie: synthetic-second\r\nHost: example.test\r\n\r\n";
const foldedClean = redactEvidenceRequest(folded);
assert.ok(!foldedClean.includes("synthetic-"));
assert.ok(foldedClean.includes("Host: example.test"));
assert.throws(() => reconcileWorkerResult(dirtyResult), /结果 ID 已处理|端点已闭环/);
