#!/usr/bin/env node
/**
 * PiX 验收驱动：用真实 pi CLI（--mode rpc）+ stub 模型提供方离线驱动验收。
 *
 * 覆盖（31 项）：
 *   §14 八步（pix 口径）：加载 / pent 注入 / redt 注入+围栏 / 失败 6 次 / 强制回读 /
 *                         get_state / record_fact 连边 / export_map
 *   新增A /auth 授权段；新增B /task 任务书段
 *   §11 六步（参数 v2）：redt 基准 1s / 连败 2s / 反思注入 / 连胜 0.5s / 反思消失 / pent 基准 2s
 *   附加A 危险命令护栏；附加B 会话重载读回
 *   toolbox 四步：list / howto / search / 工具纪律段注入
 *   update_node 两步：confirmed 联动 / /pix export 双图落盘
 *   /report 一步：报告落盘
 *   画板快照
 *   C1-C3 扩展：读卡门禁拦/放 / 传感器止损提醒 / 记账提醒（客观信号机制）
 *
 * 用法：node run-acceptance.mjs
 * 前置：扩展已部署到 ~/.pi/agent/extensions/pix（自动发现）；
 *       本目录 package.json 已 npm install（@earendil-works/pi-ai，供 stub-provider.ts 运行时用）。
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH = join(HERE, "scratch");
const CAPTURE_DIR = SCRATCH;

const results = [];
function report(step, ok, evidence) {
	results.push({ step, ok, evidence });
	console.log(`\n${ok ? "✅" : "❌"} [${step}] ${ok ? "PASS" : "FAIL"}\n${evidence}`);
}

// ---------- RPC 客户端 ----------
class RpcPi {
	constructor() {
		this.pending = new Map();
		this.events = [];
		this.buffer = "";
		this.exitError = null;
		mkdirSync(SCRATCH, { recursive: true });
		this.child = spawn("pi", ["--mode", "rpc", "-e", join(HERE, "stub-provider.ts")], {
			cwd: SCRATCH,
			shell: process.platform === "win32",
			env: { ...process.env, STUB_CAPTURE_DIR: CAPTURE_DIR },
		});
		this.child.stdout.setEncoding("utf8");
		this.child.stdout.on("data", (chunk) => this.#onData(chunk));
		this.child.stderr.on("data", (c) => process.stderr.write(`[pi stderr] ${c}`));
		this.child.on("exit", (code) => {
			this.exitError = `pi exited with code ${code}`;
			for (const [, rej] of this.pending) rej(new Error(this.exitError));
			this.pending.clear();
		});
	}

	#onData(chunk) {
		this.buffer += chunk;
		let idx;
		while ((idx = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, idx).trim();
			this.buffer = this.buffer.slice(idx + 1);
			if (!line) continue;
			let record;
			try {
				record = JSON.parse(line);
			} catch {
				continue;
			}
			if (record.type === "response" && record.id && this.pending.has(record.id)) {
				const { res, rej } = this.pending.get(record.id);
				this.pending.delete(record.id);
				if (record.success) res(record.data);
				else rej(new Error(`RPC ${record.command} failed: ${record.error}`));
			} else {
				this.events.push(record);
				// 附加A：自动拒绝所有 confirm 弹窗（模拟用户在 TUI 里点"否"）
				if (record.type === "extension_ui_request" && record.method === "confirm") {
					this.child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: record.id, confirmed: false }) + "\n");
				}
			}
		}
	}

	send(payload) {
		const id = payload.id ?? `req-${randomUUID().slice(0, 8)}`;
		const msg = JSON.stringify({ ...payload, id });
		return new Promise((res, rej) => {
			this.pending.set(id, { res, rej });
			this.child.stdin.write(msg + "\n");
		});
	}

	notifyTexts() {
		return this.events
			.filter((e) => e.type === "extension_ui_request" && e.method === "notify")
			.map((e) => ({ message: e.message, notifyType: e.notifyType }));
	}

	toolEnds(name) {
		return this.events.filter((e) => e.type === "tool_execution_end" && e.toolName === name);
	}

	async waitIdle(timeoutMs = 30000) {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			if (this.events.some((e) => e.type === "agent_settled" || e.type === "agent_end")) {
				await new Promise((r) => setTimeout(r, 300));
				return;
			}
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error("waitIdle timeout");
	}

	async promptAndWait(message) {
		const watermark = this.events.length;
		const data = await this.send({ type: "prompt", message });
		if (data.disposition === "handled") return data; // 扩展命令，无 agent loop
		const start = Date.now();
		for (;;) {
			const fresh = this.events.slice(watermark);
			if (fresh.some((e) => e.type === "agent_settled")) {
				await new Promise((r) => setTimeout(r, 300));
				return data;
			}
			if (Date.now() - start > 60000) throw new Error(`prompt timeout: ${message}`);
			await new Promise((r) => setTimeout(r, 100));
		}
	}

	dispose() {
		try {
			this.child.stdin.end();
		} catch {}
		this.child.kill();
	}
}

const lastCapture = () => {
	const file = join(CAPTURE_DIR, "stub-captures.jsonl");
	if (!existsSync(file)) return null;
	const lines = readFileSync(file, "utf8").trim().split("\n");
	return JSON.parse(lines[lines.length - 1]);
};

const toolText = (ev) =>
	((ev.result?.content ?? []).map((c) => c.text ?? "").join("\n"));

// ---------- 开始验收 ----------
async function main() {
	if (existsSync(join(SCRATCH, "stub-captures.jsonl"))) rmSync(join(SCRATCH, "stub-captures.jsonl"));
	const pi = new RpcPi();

	try {
		// 步骤1：扩展加载
		let startupNotify = null;
		for (let i = 0; i < 100; i++) {
			const hit = pi.notifyTexts().find((n) => String(n.message).includes("PiX 已加载"));
			if (hit) {
				startupNotify = hit;
				break;
			}
			await new Promise((r) => setTimeout(r, 200));
		}
		report(
			"步骤1 扩展加载（session_start notify 可见）",
			Boolean(startupNotify),
			`RPC extension_ui_request(notify): ${JSON.stringify(startupNotify)}`,
		);

		// 选 stub 模型
		const model = await pi.send({ type: "set_model", provider: "stub", modelId: "stub-model" });
		console.log("set_model →", model?.id ?? JSON.stringify(model)?.slice(0, 120));

		// 步骤2：/mode pent → 注入 PENT 规则
		const r1 = await pi.send({ type: "prompt", message: "/mode pent" });
		const pentNotify = pi.notifyTexts().find((n) => String(n.message).includes("PENT"));
		await pi.promptAndWait("go");
		const cap1 = lastCapture();
		const sec1 = cap1?.sections?.pix ?? "";
		const step2ok =
			Boolean(pentNotify) &&
			sec1.includes("PENT 模式") &&
			sec1.includes("仅限授权目标") &&
			sec1.includes("拖库口径") &&
			sec1.includes("【画板 · 当前图谱】");
		report(
			"步骤2 /mode pent → 注入 PENT 条令 + 画板摘要",
			step2ok,
			`切换通知: ${JSON.stringify(pentNotify)}\npix section 关键句: PENT模式=${sec1.includes("PENT 模式")} 授权目标=${sec1.includes("仅限授权目标")} 画板=${sec1.includes("【画板")}`,
		);

		// 步骤3：/mode redt → 注入 REDT 规则 + 未登记任务书围栏
		await pi.send({ type: "prompt", message: "/mode redt" });
		const redtNotify = pi.notifyTexts().find((n) => String(n.message).includes("REDT"));
		await pi.promptAndWait("go redt");
		const cap2 = lastCapture();
		const sec2 = cap2?.sections?.pix ?? "";
		const step3ok =
			Boolean(redtNotify) &&
			sec2.includes("REDT 模式") &&
			sec2.includes("任务书") &&
			sec2.includes("未登记红队任务书") &&
			sec2.includes("禁破坏业务可用性");
		report(
			"步骤3 /mode redt → 注入 REDT 条令 + 无任务书围栏提示",
			step3ok,
			`切换通知: ${JSON.stringify(redtNotify)}\npix section 关键句: REDT模式=${sec2.includes("REDT 模式")} 围栏提示=${sec2.includes("未登记红队任务书")}`,
		);

		// 回到 pent（后续断言与模式无关）
		await pi.send({ type: "prompt", message: "/mode pent" });

		// 步骤4：连续 6 次 record_failure 同一方向（阈值 6）
		await pi.promptAndWait("test failure");
		const fails = pi.toolEnds("record_failure");
		const sixth = fails[5] ? toolText(fails[5]) : "";
		const step4ok = fails.length >= 6 && sixth.includes("已失败 6 次") && sixth.includes("强制回读");
		report(
			"步骤4 连续 6 次 record_failure 同一方向（阈值 6）",
			step4ok,
			`record_failure 执行次数: ${fails.length}\n第 6 次返回: ${sixth.slice(0, 400)}`,
		);

		// 步骤5：强制回读指令注入
		await pi.promptAndWait("continue");
		const cap3 = lastCapture();
		const sec3 = cap3?.sections?.pix ?? "";
		const step5ok =
			sec3.includes("已失败 6 次以上") &&
			sec3.includes("order-query-errorbased") &&
			sec3.includes("substitutes") &&
			sec3.includes("get_state");
		const at = sec3.indexOf("【强制回读】");
		report(
			"步骤5 强制回读指令被注入 system prompt（≥6 次）",
			step5ok,
			at >= 0
				? `pix section 回读部分: ${sec3.slice(at, at + 500)}`
				: `未找到【强制回读】标记。pix section 前 500 字: ${sec3.slice(0, 500)}`,
		);

		// 步骤6：get_state 返回正确 JSON
		await pi.promptAndWait("show state");
		const gs1 = pi.toolEnds("get_state")[0];
		let stateJson = null;
		try {
			stateJson = JSON.parse(toolText(gs1));
		} catch {}
		const step6ok =
			Boolean(stateJson) &&
			Array.isArray(stateJson?.nodes) &&
			Array.isArray(stateJson?.edges) &&
			stateJson.nodes.length >= 6 &&
			stateJson.failureCounts?.["order-query-errorbased"] === 6 &&
			typeof stateJson?.elapsedMin === "number" && // v1.1 改良5：会话计时字段
			stateJson.mode === "pent";
		report(
			"步骤6 get_state 返回正确 JSON（含 nodes + edges + elapsedMin）",
			step6ok,
			`mode=${stateJson?.mode} nodes=${stateJson?.nodes?.length} edges=${stateJson?.edges?.length} elapsedMin=${stateJson?.elapsedMin} failureCounts=${JSON.stringify(stateJson?.failureCounts)}`,
		);

		// 步骤7：record_fact 建节点 + 连边
		await pi.promptAndWait("record graph");
		const facts = pi.toolEnds("record_fact");
		const edgeText = facts.map((f) => toolText(f)).find((t) => t.includes("已连边")) ?? "";
		await pi.promptAndWait("verify state");
		const gs2 = pi.toolEnds("get_state")[1];
		let state2 = null;
		try {
			state2 = JSON.parse(toolText(gs2));
		} catch {}
		const n1 = state2?.nodes?.find((n) => n.id === "N1");
		const h1 = state2?.nodes?.find((n) => n.id === "H1");
		const edge = state2?.edges?.find((e) => e.from === "H1" && e.to === "N1" && e.relation === "leads_to");
		const step7ok = Boolean(n1 && h1 && edge) && edgeText.includes("H1") && edgeText.includes("N1");
		report(
			"步骤7 record_fact 建节点+连边后 get_state 可见",
			step7ok,
			`record_fact 返回: ${edgeText}\nget_state: N1=${JSON.stringify(n1)} H1=${JSON.stringify(h1)} edge=${JSON.stringify(edge)}`,
		);

		// 步骤8：export_map 返回合法 Mermaid（leads_to 用 ==> 加粗）
		await pi.promptAndWait("export");
		const em = pi.toolEnds("export_map")[0];
		const mermaid = toolText(em);
		const mermaidSrc = mermaid.slice(mermaid.indexOf("```mermaid") + 10, mermaid.indexOf("\n```")).trim();
		const lines = mermaidSrc.split("\n");
		const step8ok =
			mermaidSrc.startsWith("graph LR") &&
			lines.some((l) => /^\s*\w+\["(capability|finding|failure|hypothesis): /.test(l)) &&
			lines.some((l) => l.includes("==>|leads_to|"));
		report(
			"步骤8 export_map 返回合法 Mermaid（攻击链加粗）",
			step8ok,
			`Mermaid 源码:\n${mermaidSrc}`,
		);

		// 新增A：/auth 登记后授权段注入
		await pi.send({ type: "prompt", message: "/auth hbc2.haobachang.com,10.0.0.0/24 --source 自建靶场" });
		const authNotify = pi.notifyTexts().find((n) => String(n.message).includes("已登记授权范围"));
		await pi.promptAndWait("auth check");
		const capA = lastCapture();
		const secA = capA?.sections?.pix ?? "";
		const stepAuthOk =
			Boolean(authNotify) &&
			secA.includes("【当前授权范围】") &&
			secA.includes("hbc2.haobachang.com") &&
			secA.includes("自建靶场");
		report(
			"新增A /auth 登记后 section 注入授权范围段",
			stepAuthOk,
			`通知: ${JSON.stringify(authNotify)}\n授权段: ${secA.includes("【当前授权范围】") ? secA.slice(secA.indexOf("【当前授权范围】"), secA.indexOf("【当前授权范围】") + 150) : "未找到"}`,
		);

		// 新增B：/task 登记后任务书段注入
		const taskPath = join(SCRATCH, "task-brief.md");
		writeFileSync(
			taskPath,
			"# 2026 红蓝对抗演练任务书\n\n## 授权范围\nhbc2.haobachang.com 内网段 10.0.0.0/24\n\n## 授权时间窗\n2026-10-10 至 2026-10-17\n\n## 目标\n获取域控权限并取证\n\n## 禁区\n财务系统 10.0.9.0/24 禁触碰\n",
			"utf8",
		);
		await pi.send({ type: "prompt", message: `/task ${taskPath}` });
		const taskNotify = pi.notifyTexts().find((n) => String(n.message).includes("已登记红队任务书"));
		await pi.promptAndWait("task check");
		const capB = lastCapture();
		const secB = capB?.sections?.pix ?? "";
		const stepTaskOk =
			Boolean(taskNotify) &&
			secB.includes("【红队任务书 · 2026 红蓝对抗演练任务书") &&
			secB.includes("10.0.0.0/24");
		report(
			"新增B /task 登记后 section 注入任务书围栏段",
			stepTaskOk,
			`通知: ${JSON.stringify(taskNotify)}\n任务书段: ${secB.includes("【红队任务书") ? secB.slice(secB.indexOf("【红队任务书"), secB.indexOf("【红队任务书") + 200) : "未找到"}`,
		);

		// ---------- §11 节奏自适应（redt=1s 基准 → pent=2s 基准）----------
		const timedProbe = async (message) => {
			const t0 = Date.now();
			const wm = pi.events.length;
			await pi.promptAndWait(message);
			const bashEnd = pi.events.slice(wm).find((e) => e.type === "tool_execution_end" && e.toolName === "bash");
			return { wallMs: Date.now() - t0, bashEnd };
		};
		const lastGetState = () => {
			const evs = pi.toolEnds("get_state");
			try {
				return JSON.parse(toolText(evs[evs.length - 1]));
			} catch {
				return null;
			}
		};

		// 11.1 /mode redt → 基准 1000ms
		await pi.send({ type: "prompt", message: "/mode redt" });
		await pi.promptAndWait("show config");
		const cfg1 = lastGetState();
		const step11_1 = Boolean(cfg1) && cfg1.mode === "redt" && cfg1.baseIntervalMs === 1000 && cfg1.adaptive === true;
		report(
			"§11.1 /mode redt → 基准间隔 1s（adaptive 默认开）",
			step11_1,
			`get_state: mode=${cfg1?.mode} baseIntervalMs=${cfg1?.baseIntervalMs} adaptive=${cfg1?.adaptive} currentIntervalMs=${cfg1?.currentIntervalMs}`,
		);

		// 11.2 连续 10 次 record_failure → 失败率 1.0 → 实际间隔 2s（1s × 2）
		await pi.promptAndWait("fail ten times");
		const p1 = await timedProbe("probe after all-fail");
		const step11_2 = p1.wallMs >= 1200 && p1.wallMs <= 4600 && Boolean(p1.bashEnd);
		report(
			"§11.2 窗口 10 连败 → 实际间隔 2s（1s × 2.0）",
			step11_2,
			`bash 探针实测墙钟 ${p1.wallMs}ms（期望 ~2000ms，允许 1200-4600）`,
		);

		// 11.4a 失败率 ≥0.6 且窗口满 → 反思指令注入
		await pi.promptAndWait("reflect now");
		const capFail = lastCapture();
		const secFail = capFail?.sections?.pix ?? "";
		const step11_4a = secFail.includes("近期失败率偏高") && secFail.includes("100%");
		report(
			"§11.4 失败率 100%（窗口满）→ 元认知反思指令注入",
			step11_4a,
			`pix section 反思段: ${secFail.slice(secFail.indexOf("【元认知反思】"), secFail.indexOf("【元认知反思】") + 320)}`,
		);

		// 11.3 连续成功 → 实际间隔 0.5s（1s × 0.5 下限）
		await pi.promptAndWait("win ten times");
		const p2 = await timedProbe("probe after all-success");
		const step11_3 = p2.wallMs >= 200 && p2.wallMs <= 2600 && Boolean(p2.bashEnd);
		report(
			"§11.3 窗口 10 连胜 → 实际间隔 0.5s（1s × 0.5）",
			step11_3,
			`bash 探针实测墙钟 ${p2.wallMs}ms（期望 ~500ms，允许 200-2600）`,
		);

		// 11.4b 连胜后反思指令消失
		await pi.promptAndWait("reflect again");
		const capOk = lastCapture();
		const secOk = capOk?.sections?.pix ?? "";
		const step11_4b = !secOk.includes("近期失败率偏高");
		report(
			"§11.4 连胜后反思指令不再注入",
			step11_4b,
			secOk.includes("近期失败率偏高") ? "仍含反思指令（异常）" : "pix section 无反思指令 ✓",
		);

		// 11.5 /mode pent → 基准 2s，半窗（5败5胜）→ 系数 1 → ~2s
		await pi.send({ type: "prompt", message: "/mode pent" });
		await pi.promptAndWait("show config2");
		const cfg2 = lastGetState();
		const step11_5a = Boolean(cfg2) && cfg2.mode === "pent" && cfg2.baseIntervalMs === 2000;
		await pi.promptAndWait("set half window");
		const p3 = await timedProbe("probe pent base");
		const step11_5 = step11_5a && p3.wallMs >= 800 && p3.wallMs <= 4600;
		report(
			"§11.5 /mode pent → 基准 2s，动态逻辑一致（5败5胜 → 系数 1 → ~2s）",
			step11_5,
			`get_state: mode=${cfg2?.mode} baseIntervalMs=${cfg2?.baseIntervalMs}\nbash 探针实测墙钟 ${p3.wallMs}ms（期望 ~2000ms，允许 800-4600）`,
		);

		// ---------- 附加验证 ----------
		// 附加A：tool_call 本机危险命令护栏
		const watermarkA = pi.events.length;
		await pi.promptAndWait("try dangerous");
		const bashEnds = pi.events.slice(watermarkA).filter((e) => e.type === "tool_execution_end" && e.toolName === "bash");
		const bashText = bashEnds.map(toolText).join(" | ");
		const confirmSeen = pi.events.some(
			(e) => e.type === "extension_ui_request" && e.method === "confirm" && String(e.message).includes("shutdown"),
		);
		const stepGuardOk = bashEnds.length >= 1 && confirmSeen && (bashText.includes("拒绝") || bashText.includes("拦截") || bashEnds.some((e) => e.isError));
		report(
			"附加A tool_call 护栏：本机危险命令弹确认、拒绝后被拦截",
			stepGuardOk,
			`confirm 弹窗(含 shutdown): ${confirmSeen}\nbash 执行结果(isError=${bashEnds.map((e) => e.isError).join(",")}): ${bashText.slice(0, 300)}`,
		);

		// ---------- C2：读卡门禁（未读卡 bash sqlmap → 拦截） ----------
		const watermarkGate = pi.events.length;
		await pi.promptAndWait("gate blocked probe");
		const gateBash = pi.events
			.slice(watermarkGate)
			.filter((e) => e.type === "tool_execution_end" && e.toolName === "bash");
		const gateText = gateBash.map(toolText).join(" | ");
		const stepGateBlock =
			gateBash.length >= 1 &&
			gateBash.some((e) => e.isError) &&
			gateText.includes("平台管控") &&
			gateText.includes("未读工具卡") &&
			gateText.includes("howto");
		report(
			"C2 读卡门禁：未读卡调 sqlmap 被拦截并指示 howto",
			stepGateBlock,
			`bash 结果(isError=${gateBash.map((e) => e.isError).join(",")}): ${gateText.slice(0, 260)}`,
		);

		// ---------- M2：toolbox 三入口 ----------
		// M2.1 list：全量分组清单
		await pi.promptAndWait("toolbox list");
		const tbList = pi.toolEnds("toolbox").map(toolText).join("\n");
		const m2_1 = tbList.includes("信息收集") && tbList.includes("sqlmap") && /\d+ 个/.test(tbList);
		report(
			"M2.1 toolbox list 返回分类分组清单",
			m2_1,
			`清单头部: ${tbList.slice(0, 200)}…（含工具计数 ${/\d+ 个/.test(tbList) ? "✓" : "✗"}）`,
		);

		// M2.2 howto：sqlmap 工具卡含硬约束与唯一姿势
		await pi.promptAndWait("toolbox howto sqlmap");
		const tbHowto = pi.toolEnds("toolbox").map(toolText).join("\n");
		const m2_2 =
			tbHowto.includes("工具卡 · sqlmap") &&
			tbHowto.includes("--batch") &&
			tbHowto.includes("唯一姿势") &&
			tbHowto.includes("禁全量 --dump") &&
			tbHowto.includes("NO_PROXY");
		report(
			"M2.2 toolbox howto sqlmap 返回完整工具卡",
			m2_2,
			`关键断言: --batch=${tbHowto.includes("--batch")} 唯一姿势=${tbHowto.includes("唯一姿势")} 拖库红线=${tbHowto.includes("禁全量 --dump")} 清代理=${tbHowto.includes("NO_PROXY")}`,
		);

		// C2：读卡后同族命令放行（真跑 sqlmap --version --batch）
		const watermarkPass = pi.events.length;
		await pi.promptAndWait("gate passed probe");
		const passBash = pi.events
			.slice(watermarkPass)
			.filter((e) => e.type === "tool_execution_end" && e.toolName === "bash");
		const passText = passBash.map(toolText).join(" | ");
		const stepGatePass =
			passBash.length >= 1 &&
			!passBash.some((e) => e.isError) &&
			!passText.includes("平台管控") &&
			/\d+\.\d+/.test(passText);
		report(
			"C2 读卡门禁：howto sqlmap 后同族命令放行（真跑 --version）",
			stepGatePass,
			`bash 结果(isError=${passBash.map((e) => e.isError).join(",")}): ${passText.slice(0, 200)}`,
		);

		// M2.3 search：任务关键词命中候选
		await pi.promptAndWait("toolbox search dirscan");
		const tbSearch = pi.toolEnds("toolbox").map(toolText).join("\n");
		const m2_3 = tbSearch.includes("目录爆破") ? true : tbSearch.includes("候选工具");
		report(
			"M2.3 toolbox search 按任务关键词返回候选",
			m2_3,
			`搜索结果: ${tbSearch.slice(0, 300)}`,
		);

		// M2.4 工具纪律段注入 section
		const capM2 = lastCapture();
		const secM2 = capM2?.sections?.pix ?? "";
		const m2_4 = secM2.includes("toolbox") && secM2.includes("唯一姿势");
		report(
			"M2.4 工具纪律（toolbox 网关）写入规则 section",
			m2_4,
			`section 工具纪律句: ${secM2.includes("先 toolbox") ? "✓ 存在" : "✗ 缺失"}`,
		);

		// ---------- M3：画板状态流转 + /pix export ----------
		await pi.promptAndWait("confirm hypothesis");
		const ups = pi.toolEnds("update_node");
		const upText = ups.map(toolText).join("\n");
		const m3_1 = upText.includes("状态已更新为 confirmed") && upText.includes("计入节奏成功窗口");
		report(
			"M3.1 update_node 假设 confirmed（联动节奏成功窗口）",
			m3_1,
			`update_node 返回: ${upText.slice(0, 200)}`,
		);

		await pi.send({ type: "prompt", message: "/pix export" });
		const exportNotify = pi.notifyTexts().find((n) => String(n.message).includes("画板已导出"));
		const boardFiles = existsSync(SCRATCH)
			? readdirSync(SCRATCH).filter((f) => f.startsWith("pix-board-") && f.endsWith(".md"))
			: [];
		let boardOk = false;
		if (boardFiles.length > 0) {
			const boardContent = readFileSync(join(SCRATCH, boardFiles[boardFiles.length - 1]), "utf8");
			boardOk = boardContent.includes("mindmap") && boardContent.includes("graph LR") && boardContent.includes("节点明细");
		}
		report(
			"M3.2 /pix export 画板双图落盘（mindmap + 关系图 + 明细表）",
			Boolean(exportNotify) && boardOk,
			`通知: ${JSON.stringify(exportNotify?.message?.slice(0, 80))} · 文件: ${boardFiles.join(",") || "无"} · 双图校验: ${boardOk}`,
		);

		// ---------- M4：/report ----------
		await pi.send({ type: "prompt", message: "/report" });
		const reportNotify = pi.notifyTexts().find((n) => String(n.message).includes("报告已生成"));
		const reportFiles = existsSync(SCRATCH)
			? readdirSync(SCRATCH).filter((f) => f.startsWith("pix-report-") && f.endsWith(".md"))
			: [];
		let reportOk = false;
		if (reportFiles.length > 0) {
			const rc = readFileSync(join(SCRATCH, reportFiles[reportFiles.length - 1]), "utf8");
			reportOk =
				rc.includes("PiX 渗透测试报告") &&
				rc.includes("执行摘要") &&
				rc.includes("状态机参与") &&
				rc.includes("```mermaid");
		}
		report(
			"M4.1 /report 报告落盘（执行摘要 + 逐漏洞 + 攻击链配图）",
			Boolean(reportNotify) && reportOk,
			`通知: ${JSON.stringify(reportNotify?.message?.slice(0, 80))} · 文件: ${reportFiles.join(",") || "无"} · 结构校验: ${reportOk}`,
		);

		const welcomeSeen = pi.notifyTexts().some((n) => String(n.message).includes("上手三步"));
		report(
			"M5.1 新会话欢迎引导通知（一次性）",
			welcomeSeen,
			welcomeSeen ? "上手三步通知已见（全新空状态时触发）✓" : "未出现欢迎通知（异常）",
		);

		const snapDir = join(SCRATCH, "pix-snapshots");
		const snaps = existsSync(snapDir) ? readdirSync(snapDir).filter((f) => f.endsWith(".md")) : [];
		report(
			"M5.2 agent_end 画板新增自动快照",
			snaps.length > 0,
			`快照目录 ${snapDir}: ${snaps.length} 份${snaps.length ? "（最新 " + snaps[snaps.length - 1] + "）" : ""}`,
		);

		// 附加B：switch_session 重新加载后 session_start 从 entries 读回状态
		await pi.promptAndWait("show config3");
		const cfg3 = lastGetState();
		const st = await pi.send({ type: "get_state" });
		const sessionFile = st.sessionFile;
		await pi.send({ type: "switch_session", sessionPath: sessionFile });
		await new Promise((r) => setTimeout(r, 800));
		const resumeNotify = pi.notifyTexts().filter((n) => String(n.message).includes("PiX 已加载")).pop();
		const expectNodes = cfg3?.nodes?.length ?? -1;
		const expectEdges = cfg3?.edges?.length ?? -1;
		const stepBok =
			Boolean(resumeNotify) &&
			resumeNotify.message.includes(`节点=${expectNodes}`) &&
			resumeNotify.message.includes(`边=${expectEdges}`);
		report(
			"附加B 会话重载后从 session entries 读回图谱状态",
			stepBok,
			`重载通知: ${JSON.stringify(resumeNotify)}（预期 节点=${expectNodes} · 边=${expectEdges}）`,
		);

		// ---------- C3：止损观察器 + 记账提醒（客观信号机制，bash echo 403 无副作用） ----------
		await pi.promptAndWait("sensor probe blocked streak");
		await pi.promptAndWait("sensor report state");
		const secS = lastCapture()?.sections?.pix ?? "";
		const sensorState = pi.toolEnds("get_state").map(toolText).join("\n");
		const stepC3 =
			secS.includes("【止损提醒】") &&
			secS.includes("【记账提醒】") &&
			sensorState.includes("连续拦截/报错（观察器）");
		report(
			"C3 传感器：5 连拦截/报错 → 止损提醒+客观失败入账；5 次外部动作未入账 → 记账提醒",
			stepC3,
			`section 止损=${secS.includes("【止损提醒】")} 记账=${secS.includes("【记账提醒】")}\nget_state 含观察器方向=${sensorState.includes("连续拦截/报错（观察器）")}`,
		);

		// ---------- v1.1 新增：历史画板读回（跨会话知识继承） ----------
		// 第二个全新会话（同 cwd、无 pix-state entries）→ cwd/pix-state.json 读回注入【历史画板】
		pi.dispose(); // 先释放第一个进程（RPC 单实例；其画板已持久化到 cwd/pix-state.json）
		const pi2 = new RpcPi();
		try {
			await pi2.send({ type: "set_model", provider: "stub", modelId: "stub-model" });
			await pi2.promptAndWait("history-and-rush check");
			const capH = lastCapture();
			const secH = capH?.sections?.pix ?? "";
			const v11ok =
				secH.includes("【历史画板 · 上次会话进展】") &&
				secH.includes("继承自 cwd/pix-state.json");
			report(
				"v1.1 历史画板读回（跨会话知识继承）",
				v11ok,
				`历史画板=${secH.includes("【历史画板")} 继承声明=${secH.includes("继承自 cwd/pix-state.json")}`,
			);
		} finally {
			pi2.dispose();
		}
	} finally {
		pi.dispose();
	}

	const failed = results.filter((r) => !r.ok);
	console.log(`\n========== 验收汇总: ${results.length - failed.length}/${results.length} 通过 ==========`);
	if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
	console.error("验收驱动异常:", err);
	process.exitCode = 1;
});
