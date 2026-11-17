/**
 * termination.test.ts — worker_submit 强制终结工具与四态收口契约机制断言套件 (ADR 0005)
 */

import assert from "node:assert/strict";

import {
	validateTerminationContract,
	handleWorkerSubmit,
	type WorkerSubmitPayload,
} from "../extension/termination.ts";

console.log("==================================================================");
console.log("🛡️  PiX-Swarm: worker_submit 四态终结契约断言套件 (v3.0.0-beta.1)");
console.log("==================================================================\n");

// 1. confirmed 结局契约与缺证硬拦截
console.log("[断言 1/5] confirmed 快速退出结局与证据链完整性校验...");
const incompleteConfirmed: WorkerSubmitPayload = {
	workerId: "w-01",
	taskEnvelopeId: "env-01",
	endpointId: "ep-sql-01",
	outcome: "confirmed",
	summary: "发现 SQL 注入",
	// 缺失 vulnerabilityTitle, evidenceRequest, evidenceResponse
};
const resConfBad = validateTerminationContract(incompleteConfirmed);
assert.ok(resConfBad.valid === false, "缺失原始请求与响应差分时应被硬拦截");
assert.ok(resConfBad.errors.some((e) => e.includes("evidenceRequest")), "应明确提示缺失原始请求包");

const fullConfirmed: WorkerSubmitPayload = {
	workerId: "w-01",
	taskEnvelopeId: "env-01",
	endpointId: "ep-sql-01",
	outcome: "confirmed",
	summary: "通过时间盲注确认 SQL 注入成立",
	vulnerabilityTitle: "Time-based Blind SQL Injection in id parameter",
	evidenceRequest: "GET /api/user?id=1'+AND+(SELECT+1+FROM+(SELECT(SLEEP(5)))a)+--+ HTTP/1.1\r\nHost: db.corp.local\r\n\r\n",
	evidenceResponse: "HTTP/1.1 200 OK\r\nTime-Elapsed: 5042ms\r\n\r\n{\"status\":\"ok\"}",
};
const resConfGood = validateTerminationContract(fullConfirmed);
assert.ok(resConfGood.valid === true, "证据齐全的 confirmed 结局应校验通过");
const rcpt1 = handleWorkerSubmit(fullConfirmed);
assert.ok(rcpt1.nextAction === "early_exit", "confirmed 应触发 early_exit 快速结案节省 Token");
console.log("  → 通过 ✓");

// 2. escalating 纵深突破契约
console.log("[断言 2/5] escalating 纵深突破结局与立足点资产凭据对账...");
const badEscalating: WorkerSubmitPayload = {
	workerId: "w-02",
	taskEnvelopeId: "env-02",
	endpointId: "ep-upload-01",
	outcome: "escalating",
	summary: "文件上传成功",
};
const resEscBad = validateTerminationContract(badEscalating);
assert.ok(resEscBad.valid === false, "缺少立足点证据或提取资产应被拦截");

const goodEscalating: WorkerSubmitPayload = {
	workerId: "w-02",
	taskEnvelopeId: "env-02",
	endpointId: "ep-upload-01",
	outcome: "escalating",
	summary: "WebShell 上传成功并获取命令执行权限",
	footholdEvidence: "uid=33(www-data) gid=33(www-data) groups=33(www-data)",
	extractedAssets: ["192.168.10.12:22", "db-internal.corp:3306"],
};
const resEscGood = validateTerminationContract(goodEscalating);
assert.ok(resEscGood.valid === true, "合规 escalating 应校验通过");
const rcpt2 = handleWorkerSubmit(goodEscalating);
assert.ok(rcpt2.nextAction === "plan_lateral", "escalating 应指示主控规划横向");
console.log("  → 通过 ✓");

// 3. bypassing 强阻抗升档契约与变异次数门槛
console.log("[断言 3/5] bypassing 强阻抗结局与尝试次数门槛 (attemptsCount >= 2)...");
const hastyBypassing: WorkerSubmitPayload = {
	workerId: "w-03",
	taskEnvelopeId: "env-03",
	endpointId: "ep-waf-01",
	outcome: "bypassing",
	summary: "刚测了一次被 WAF 挡了",
	wafSignature: "Cloudflare WAF 403",
	attemptsCount: 1, // 仅 1 次，属于轻言放弃
};
const resBypBad = validateTerminationContract(hastyBypassing);
assert.ok(resBypBad.valid === false, "单次受挫不允许调用 bypassing 升档");

const solidBypassing: WorkerSubmitPayload = {
	workerId: "w-03",
	taskEnvelopeId: "env-03",
	endpointId: "ep-waf-01",
	outcome: "bypassing",
	summary: "分块走私与 Hex 编码变异均被拦截，请求 SmartTier 旗舰模型接管",
	wafSignature: "ModSecurity CRS 942100",
	blockReason: "HTTP 403 Forbidden with rule ID 942100",
	attemptsCount: 3,
};
const resBypGood = validateTerminationContract(solidBypassing);
assert.ok(resBypGood.valid === true, "合规 bypassing 校验通过");
const rcpt3 = handleWorkerSubmit(solidBypassing);
assert.ok(rcpt3.nextAction === "escalate_smart_tier", "bypassing 应触发 SmartTier 旗舰模型换将");
console.log("  → 通过 ✓");

// 4. rejected 刚性防偷懒门禁 (≥3 组测试历史硬核验)
console.log("[断言 4/5] rejected 刚性防偷懒门禁拦截 (probeHistory < 3 严禁草率放弃)...");
const lazyRejected: WorkerSubmitPayload = {
	workerId: "w-04",
	taskEnvelopeId: "env-04",
	endpointId: "ep-login-01",
	outcome: "rejected",
	summary: "发了单引号没有报错，判定无漏洞",
	probeHistory: [
		{ probeType: "baseline", action: "发送 '", responseStatus: 200, diffObserved: false },
	],
	falsificationSummary: "无报错",
};
const resRejBad = validateTerminationContract(lazyRejected);
assert.ok(resRejBad.valid === false, "探针历史不足 3 条必须被硬性拦截");
assert.ok(resRejBad.errors.some((e) => e.includes("防偷懒刚性门禁拦截")), "必须明确给出防偷懒门禁拦截说明");

const rigorousRejected: WorkerSubmitPayload = {
	workerId: "w-04",
	taskEnvelopeId: "env-04",
	endpointId: "ep-login-01",
	outcome: "rejected",
	summary: "经基线单引号、宽字节编码与布尔真假差分多轮探测，未观察到任何差分",
	probeHistory: [
		{ probeType: "baseline", action: "基线单引号探测", responseStatus: 200, diffObserved: false },
		{ probeType: "encoding_mutation", action: "URL 双重编码与十六进制变异", responseStatus: 200, diffObserved: false },
		{ probeType: "syntax_variation", action: "布尔逻辑真假恒等差分探测", responseStatus: 200, diffObserved: false },
	],
	falsificationSummary: "三轮深度探针与变异均未引发响应体结构与状态差分，经 L4 充分证伪",
};
const resRejGood = validateTerminationContract(rigorousRejected);
assert.ok(resRejGood.valid === true, "充分证伪的 rejected 应校验通过");
const rcpt4 = handleWorkerSubmit(rigorousRejected);
assert.ok(rcpt4.nextAction === "close_ledger", "rejected 应闭环更新端点台账");
console.log("  → 通过 ✓");

// 5. 异常载荷防御与回执完整性
console.log("[断言 5/5] 非法载荷类型防御与回执生成...");
assert.throws(() => {
	// @ts-expect-error 故意传入非法对象
	handleWorkerSubmit(null);
}, /worker_submit 拒绝收口/, "空载荷必须抛出异常");
console.log("  → 通过 ✓");

console.log("==================================================================");
console.log("🎉  worker_submit 四态终结契约全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");
