import { wrapCommandWithPivot } from "./pivot-router.ts";
import { searchTactics, readTacticalSOP } from "./tactical-loader.ts";
/**
 * PiX — 假设驱动、自带渗透工具箱的 Pi Agent 发行版（扩展层）
 *
 * 职责边界：
 *   只管"怎么想"——模式规则注入、事实图谱/画板状态、失败强制回读、
 *   元认知反思、节奏自适应、本机危险命令拦截。
 *   不管"用什么工具打"——抓包/浏览器/扫描器由用户经 MCP/CLI/skill 自行接入。
 *
 * 模块划分：
 *   state.ts  状态模型 + appendEntry 持久化/读回（含 v1 迁移）
 *   rules.ts  两模式（pent/redt）作战条令 + 条件注入段
 *   pacing.ts 节奏自适应计算
 *   guard.ts  本机危险命令黑名单
 *   gate.ts   读卡门禁（未 howto 拦 bash/ps）+ bash 默认超时注入
 *   sensor.ts 止损观察器（连续拦截/报错 → 回读）+ 记账提醒
 *   mirror.ts 落库调用 → 画板镜像（提案即镜像，不依赖 MCP 连通）
 *   toolbox.ts / toolbox-data.ts 工具箱网关（list/howto/search + 39 卡注册表）
 *   index.ts  本文件：事件钩子 + 命令 + 工具注册
 *
 * API 签名依据：@earendil-works/pi-coding-agent@1.1.0 dist/core/extensions/types.d.ts
 * （sections 注入协议：只写 systemPromptOptions.sections.pix，禁止 return { systemPrompt }）
 */

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	FAILURE_THRESHOLD,
	getState,
	nextId,
	persist,
	pushResult,
	bumpFailure,
	restoreFromEntries,
	setMode,
	updateNodeStatus,
	readStateSnapshot,
	getAllHosts,
	getAllSessions,
	getAllCredentials,
	recordHost,
	recordPivotSession,
	recordCredential,
	recordEndpoint,
	updateEndpointStatus,
	historySummary,
	setHistoryLines,
	resetSectionLines,
	elapsedMinutes,
	type Node,
	type Edge,
	type Relation,
	type NodeType,
	type NodeStatus,
	type EndpointStatus,
	type Mode,
} from "./state.ts";
import { currentDelayMs, failureRate, sleep } from "./pacing.ts";
import { buildSection } from "./rules.ts";
import { detectDangerous } from "./guard.ts";
import { checkCardGate, ensureTimeout } from "./gate.ts";
import { countExternalAction, noteLedger, noteResult, resetSensors } from "./sensor.ts";
import { mirrorPentrackCall, resetMirror } from "./mirror.ts";
import { registerToolboxTool } from "./toolbox.ts";
import { loadRegistry } from "./toolbox.ts";

/** Mermaid 导出：graph 视图（关系图；leads_to 加粗为攻击链主线） */
function toMermaid(): string {
	const state = getState();
	if (state.nodes.length === 0) {
		return 'graph LR\n    EMPTY["画板为空：用 record_fact / record_capability / record_failure 记录节点"]';
	}
	const lines: string[] = ["graph LR"];
	const alias = new Map<string, string>();
	const used = new Set<string>();
	state.nodes.forEach((n, i) => {
		let safe = n.id.replace(/[^A-Za-z0-9_]/g, "_");
		if (safe === "" || /^[0-9]/.test(safe)) safe = `n${i + 1}`;
		while (used.has(safe)) safe += "_";
		used.add(safe);
		alias.set(n.id, safe);
	});
	const clean = (text: string) => text.replace(/"/g, "'").replace(/\s*\n+\s*/g, " ").trim();
	for (const n of state.nodes) {
		lines.push(`    ${alias.get(n.id)}["${n.type}: ${clean(n.label)}"]`);
	}
	const valid = new Set(state.nodes.map((n) => n.id));
	for (const e of state.edges) {
		if (!valid.has(e.from) || !valid.has(e.to)) continue;
		if (e.relation === "substitutes" || e.relation === "similar_to") {
			lines.push(`    ${alias.get(e.from)} -.${e.relation}.-> ${alias.get(e.to)}`);
		} else if (e.relation === "leads_to") {
			lines.push(`    ${alias.get(e.from)} ==>|${e.relation}| ${alias.get(e.to)}`);
		} else {
			lines.push(`    ${alias.get(e.from)} -->|${e.relation}| ${alias.get(e.to)}`);
		}
	}
	return lines.join("\n");
}

/** Mermaid 导出：mindmap 视图（按实体类型分组的思维导图，人读） */
function toMindmap(): string {
	const state = getState();
	const groups: Record<string, Array<{ id: string; label: string; status?: string }>> = {
		能力: [],
		发现: [],
		假设: [],
		失败: [],
	};
	const typeLabel: Record<NodeType, string> = {
		capability: "能力",
		finding: "发现",
		hypothesis: "假设",
		failure: "失败",
	};
	for (const n of state.nodes) {
		groups[typeLabel[n.type]]?.push({ id: n.id, label: n.label, status: n.status });
	}
	const clean = (t: string) => t.replace(/[()%\n]/g, " ").trim();
	const lines: string[] = ["mindmap", "  root((PiX 画板))"];
	for (const [g, items] of Object.entries(groups)) {
		if (items.length === 0) continue;
		lines.push(`  ${g}`);
		for (const it of items) {
			const mark = it.status === "confirmed" ? "✓" : it.status === "rejected" ? "✗" : "";
			lines.push(`    ${it.id} ${mark}${clean(it.label)}`);
		}
	}
	if (state.nodes.length === 0) lines.push("    （空：用 record_fact 记录）");
	return lines.join("\n");
}

/** 状态簿记工具集合：不占节奏、不进护栏 */
const STATE_TOOL_NAMES = new Set([
	"record_fact",
	"record_capability",
	"record_failure",
	"get_state",
	"get_task",
	"export_map",
	"update_node",
	"toolbox",
	"record_host",
	"record_pivot",
	"record_cred",
	"record_endpoint",
	"update_endpoint",
	"consult_tactics",
	"pivot_exec",
	"export_facts",
]);

/** 本地文件类工具：不碰目标，不占节奏（动静结合的"静"不睡） */
const LOCAL_FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

export default function (pi: ExtensionAPI) {
	// -----------------------------------------------------------------------
	// session_start：读回状态（v2 优先，v1 pentest-state 自动迁移）
	// 新会话欢迎引导（仅全新空状态时一次性提示，不打扰）
	// -----------------------------------------------------------------------
	pi.on("session_start", (event, ctx) => {
		// 会话级 section 注入行重置：防上一会话的历史画板摘要/画板编辑提示泄漏到本会话
			resetSectionLines();
			resetSensors();
			resetMirror();
			const entries = ctx.sessionManager.getEntries() as unknown[];
			const { restored, migrated } = restoreFromEntries(pi, entries);
			// 历史画板读回：全新会话 + cwd 存在 pix-state.json → 注入【历史画板】摘要（不并入 state 本体）
		// 注意：必须在 persist（覆盖 cwd 存档）之前读取——persist 会把当前状态写入，可能冲掉上一会话快照
		let historyNote = "";
		if (!restored && !migrated) {
			try {
				const snap = readStateSnapshot();
				if (snap && snap.state.nodes.length > 0) {
					setHistoryLines([historySummary(snap)]);
					historyNote = ` · 检测到历史画板（${snap.savedAt.slice(0, 16).replace("T", " ")} 保存，${snap.state.nodes.length} 节点）——已注入摘要，可沿其继续`;
				}
			} catch {}
		}
		// 计时重置：elapsedMin / 收口冲刺按本会话起算（此 persist 会更新 cwd 存档为本会话新起点）
		const st0 = getState();
		st0.sessionStartedAt = Date.now();
		persist(pi);
		const state = getState();
		ctx.ui.notify(
			`PiX 已加载（${event.reason}${migrated ? "，v1 状态已迁移" : restored ? "" : "，新会话"}）` +
				` · 模式=${state.mode} · 节奏=${state.adaptive ? "自适应" : "固定"} ${state.baseIntervalMs / 1000}s` +
				` · 节点=${state.nodes.length} · 边=${state.edges.length}` +
				`${state.auth ? ` · 授权=${state.auth.targets.length} 项` : ""}` +
				`${state.task ? ` · 任务书=${state.task.title}` : ""}${historyNote}`,
			"info",
		);
		if (!restored && state.nodes.length === 0 && !state.auth && !state.task && !historyNote) {
					ctx.ui.notify(
						"上手三步：①设置→模型 填 API Key（未配）②/ 查看命令（/auth 登记授权、/task 任务书、/pix 总览）③直接对话开工。\n工具箱：toolbox({action:'list'}) 查 38 款内置 CLI 工具；/pix export 导出画板超图。",
						"info",
					);
		}
	});

	// -----------------------------------------------------------------------
	// agent_end：画板有新增（节点或边）时自动落一份轻量快照（复盘用，零打扰）
	// -----------------------------------------------------------------------
	let nodeCountAtStart = 0;
	let edgeCountAtStart = 0;
	pi.on("session_start", () => {
		nodeCountAtStart = getState().nodes.length;
		edgeCountAtStart = getState().edges.length;
	});
	pi.on("agent_end", async () => {
		const state = getState();
		if (state.nodes.length === nodeCountAtStart && state.edges.length === edgeCountAtStart) return;
		nodeCountAtStart = state.nodes.length;
		edgeCountAtStart = state.edges.length;
		try {
			const { writeFileSync, mkdirSync } = await import("node:fs");
			const { join } = await import("node:path");
			const dir = join(process.cwd(), "pix-snapshots");
			mkdirSync(dir, { recursive: true });
			const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			writeFileSync(
				join(dir, `board-${ts}.md`),
				`# 画板快照 ${new Date().toLocaleString()}\n\n模式 ${state.mode} · 节点 ${state.nodes.length} · 边 ${state.edges.length}\n\n\`\`\`mermaid\n${toMindmap()}\n\`\`\`\n`,
				"utf8",
			);
		} catch {
			// 快照失败静默（不影响主流程）
		}
	});

		// -----------------------------------------------------------------------
		// before_agent_start：sections 注入（键固定 "pix"，保提示前缀稳定）
		// -----------------------------------------------------------------------
		pi.on("before_agent_start", (event) => {
			event.systemPromptOptions.sections.pix = buildSection();
		});

	// -----------------------------------------------------------------------
	// tool_execution_start：节奏控制（对外部动作工具 sleep，簿记/本地文件工具豁免）
	// -----------------------------------------------------------------------
	pi.on("tool_execution_start", async (event, ctx) => {
		if (STATE_TOOL_NAMES.has(event.toolName)) return;
		if (LOCAL_FILE_TOOLS.has(event.toolName)) return;
		countExternalAction(); // 记账提醒计数（sensor.ts）
		const delay = currentDelayMs();
		if (delay > 0) {
			await sleep(delay, ctx?.signal);
		}
	});

	// -----------------------------------------------------------------------
	// tool_call：有序检查链（ARTEX 合并语义：首个 block 生效即停，改参最后获胜）
	//   ①guard 本机危险命令拦截 → ②读卡门禁 → ③bash/powershell 默认超时注入
	//   全部拦截话术带「平台管控·非目标防御」前缀，防 agent 把拦截当目标 WAF 去绕
	// -----------------------------------------------------------------------
	pi.on("tool_call", async (event, ctx) => {
		const isShell = event.toolName === "bash" || event.toolName === "powershell";
		if (!isShell) return;
		const cmd = String((event.input as { command?: unknown } | undefined)?.command ?? "");
		if (!cmd) return;

		// ① 本机危险命令（环境防护）
		const hit = detectDangerous(event.toolName, cmd);
		if (hit) {
			const reason = `【PiX 平台管控·非目标防御】检测到本机危险命令「${hit}」，已拦截：${cmd}`;
			if (!ctx.hasUI) return { block: true, reason };
			const ok = await ctx.ui.confirm("危险命令", `检测到本机危险命令「${hit}」：\n${cmd}\n是否执行？`);
			if (!ok) return { block: true, reason: `${reason}（用户拒绝）` };
			// 用户确认放行 → 继续走门禁/超时
		}

		// ② 读卡门禁：命中注册表工具但本会话未 howto → block（重试零成本，宁误拦不漏拦）
		const gateHit = checkCardGate(event.toolName, cmd);
		if (gateHit && !hit) {
			return {
				block: true,
				reason:
					`【PiX 平台管控·非目标防御】命令涉及工具「${gateHit.name}」，但本会话未读工具卡。` +
					`先执行 toolbox({action:'howto', tool:'${gateHit.name}'}) 读卡（唯一姿势/硬约束/随包路径），再按卡拼命令。` +
					`原命令：${cmd}`,
			};
		}

		// ③ 默认超时注入（模型显式传值不覆盖；pi bash 无默认超时=永不熔断）
		ensureTimeout(event.toolName, event.input as Record<string, unknown>);

		// ④ pentrack 落库 → 画板镜像（提案即镜像：落库即记账，不依赖 MCP 连通）
		mirrorPentrackCall(pi, event.toolName, event.input as Record<string, unknown>);
	});

	// -----------------------------------------------------------------------
	// tool_result：传感器（止损观察/超时未知）+ 入账清零
	// -----------------------------------------------------------------------
		pi.on("tool_result", async (event) => {
			if (event.toolName.startsWith("record_") || event.toolName === "update_node") {
				noteLedger(); // 事实写入类簿记工具=入账清零
				return;
			}
			if (STATE_TOOL_NAMES.has(event.toolName)) {
				// get_state / get_task / export_map / toolbox 为纯查询工具，不冲抵记账计数
				return;
			}
			if (event.toolName.startsWith("mcp__pentrack__")) {
				noteLedger(); // 镜像已在 tool_call 落节点=入账
				return;
			}
			const text =
				event.content
					.map((c) => (c.type === "text" ? c.text : ""))
					.join("\n") + (event.isError ? " (error)" : "");
			const { timeout } = noteResult(event.isError, text);
			// R7：被熔断命令标注「结果未知≠失败」（YJ outcome_unknown 语义）
			if (timeout) {
				(event.content as Array<{ type: string; text?: string }>).push({
					type: "text",
					text: "【PiX】命令超时被熔断：结果未知≠失败——先核实副作用（是否已打到目标/是否留下进程/文件），未核实前禁止原样重发同一命令。",
				});
			}

			// 超图底层自动感知与水合引擎（Auto-Hydration Sniffer，不依赖模型自觉）
			if (event.toolName === "bash" || event.toolName === "powershell") {
				const cmd = String((event.input as { command?: unknown } | undefined)?.command ?? "");
				const { sniffAndHydrate } = await import("./sniffer.ts");
				const summary = sniffAndHydrate(cmd, text);
				if (
					summary.hosts > 0 ||
					summary.credentials > 0 ||
					summary.endpoints > 0 ||
					summary.compromisedHosts > 0
				) {
					noteLedger(); // 自动入账成功，冲抵记账计数器
					persist(pi); // 立即持久化超图
					const notes: string[] = [];
					if (summary.hosts > 0) notes.push(`主机 ${summary.hosts} 台 (开放服务 ${summary.services} 个)`);
					if (summary.credentials > 0) notes.push(`凭据 ${summary.credentials} 项`);
					if (summary.endpoints > 0) notes.push(`接口端点 ${summary.endpoints} 个`);
					if (summary.compromisedHosts > 0) notes.push(`⚡ PWNED 主机 ${summary.compromisedHosts} 台`);
					(event.content as Array<{ type: string; text?: string }>).push({
						type: "text",
						text: `【PiX 超图机制自动水合】底层已自动提取并入账超图：${notes.join("、")}。`,
					});
				}
			}
		});

	// -----------------------------------------------------------------------
	// 命令
	// -----------------------------------------------------------------------

	pi.registerCommand("mode", {
		description: "切换渗透模式（用法: /mode pent | /mode redt | /mode adaptive on|off）",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (value === "pent" || value === "redt") {
				setMode(value as Mode);
				persist(pi);
				ctx.ui.notify(
					value === "pent"
						? "已切换到 PENT（SRC/授权渗透）模式：基准间隔 2s、授权围栏、写路径按拖库口径"
						: "已切换到 REDT（红队演练）模式：基准间隔 1s、任务书围栏、武器化按技能包规范",
					"info",
				);
			} else if (value === "adaptive on" || value === "adaptive off") {
				const state = getState();
				state.adaptive = value === "adaptive on";
				persist(pi);
				ctx.ui.notify(
					state.adaptive
						? "节奏自适应已开启：实际间隔 = 基准 × 动态系数（0.5~2×，随失败率浮动）"
						: "节奏自适应已关闭：固定基准间隔",
					"info",
				);
			} else {
				ctx.ui.notify("用法: /mode pent 或 /mode redt；/mode adaptive on|off 切换节奏自适应", "warning");
			}
		},
	});

	pi.registerCommand("auth", {
		description: "登记授权范围（用法: /auth <目标1,目标2,...> --source <授权来源>）",
		handler: async (args, ctx) => {
			const state = getState();
			const m = args.match(/^(.*?)--source\s+(.+)$/s);
			const targetsRaw = (m ? m[1] : args).trim();
			const source = (m ? m[2] : "用户声明").trim();
			const targets = targetsRaw
				.split(/[,，;；\s]+/)
				.map((t) => t.trim())
				.filter(Boolean);
			if (targets.length === 0) {
				ctx.ui.notify("用法: /auth <目标1,目标2,...> --source <授权来源>（目标支持域名/IP/CIDR/URL）", "warning");
				return;
			}
			state.auth = { targets, source, recordedAt: new Date().toISOString() };
			persist(pi);
			ctx.ui.notify(`已登记授权范围：${targets.join("、")}（来源：${source}）。pent 规则将注入该范围。`, "info");
		},
	});

	pi.registerCommand("task", {
		description: "登记红队任务书（用法: /task <任务书MD文件路径>）",
		handler: async (args, ctx) => {
			const path = args.trim().replace(/^["']|["']$/g, "");
			if (!path) {
				ctx.ui.notify("用法: /task <任务书MD文件路径>（内容含范围/授权时间/目标/禁区）", "warning");
				return;
			}
			try {
				const { readFileSync } = await import("node:fs");
				const content = readFileSync(path, "utf8");
				const title =
					content
						.split("\n")
						.find((l) => l.startsWith("# "))
						?.replace(/^#\s*/, "")
						?.trim() || path.split(/[\\/]/).pop() || "任务书";
				const state = getState();
				state.task = { title, content, recordedAt: new Date().toISOString() };
				persist(pi);
				ctx.ui.notify(`已登记红队任务书「${title}」（${content.length} 字符）。redt 围栏将以任务书为准。`, "info");
			} catch (err) {
				ctx.ui.notify(`任务书读取失败：${path}\n${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});

	pi.registerCommand("pix", {
		description: "PiX 状态总览；/pix export 导出画板（思维导图+关系图双 Mermaid 落盘）",
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase();
			if (sub === "export") {
				const { writeFileSync } = await import("node:fs");
				const { join } = await import("node:path");
				const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
				const file = join(process.cwd(), `pix-board-${ts}.md`);
				const state = getState();
				const md = [
					`# PiX 画板导出 · ${new Date().toLocaleString()}`,
					"",
					`模式 ${state.mode} · 节点 ${state.nodes.length} · 边 ${state.edges.length} · 授权 ${state.auth ? state.auth.targets.join("、") : "未登记"}`,
					"",
					"## 思维导图（按类型分组）",
					"",
					"```mermaid",
					toMindmap(),
					"```",
					"",
					...(state.edges.length > 0
						? [
								"## 关系图（leads_to 加粗为攻击链）",
								"",
								"```mermaid",
								toMermaid(),
								"```",
								"",
						  ]
						: []), // 0 边不出孤点关系图（问题清单 #9）
					"## 节点明细",
					"",
					"| id | 类型 | 状态 | 标签 | 描述 |",
					"|---|---|---|---|---|",
					...state.nodes.map(
						(n) => `| ${n.id} | ${n.type} | ${n.status ?? "-"} | ${(n.tags ?? []).join(",")} | ${n.label.replace(/\|/g, "/")} |`,
					),
					"",
					...(state.edges.length > 0
						? ["## 关系明细", "", ...state.edges.map((e) => `- ${e.from} -${e.relation}-> ${e.to}`)]
						: []),
				].join("\n");
				writeFileSync(file, md, "utf8");
				ctx.ui.notify(`画板已导出：${file}（${state.nodes.length} 节点 / ${state.edges.length} 边，双 Mermaid 图 + 明细表）`, "info");
				return;
			}
			const state = getState();
			const lines = [
				`模式：${state.mode}（基准 ${state.baseIntervalMs}ms，${state.adaptive ? "自适应" : "固定"}）`,
				`图谱：节点 ${state.nodes.length}，边 ${state.edges.length}`,
				`回读阈值：${FAILURE_THRESHOLD} 次/方向`,
				`授权：${state.auth ? `${state.auth.targets.join("、")}（${state.auth.source}）` : "未登记（/auth）"}`,
				`任务书：${state.task ? state.task.title : "未登记（/task）"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("toolbox", {
		description: "工具箱操作；/toolbox export 导出全量工具卡手册（单文件 MD，可喂给技能/知识系统）",
		handler: async (args, ctx) => {
			if (args.trim().toLowerCase() !== "export") {
				ctx.ui.notify("用法: /toolbox export（会话内查询用 toolbox 工具的 list/howto/search）", "info");
				return;
			}
			const { writeFileSync } = await import("node:fs");
			const { join } = await import("node:path");
			const registry = loadRegistry();
			const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const file = join(process.cwd(), `pix-toolbox-manual-${ts}.md`);
			// 渲染全部工具卡（复用 toolbox.ts 的卡片渲染——此处独立实现轻量版，避免引内部函数）
			const { renderAllCards } = await import("./toolbox.ts");
			writeFileSync(file, renderAllCards(), "utf8");
				ctx.ui.notify(`工具卡手册已导出：${file}（${registry.length} 个工具）`, "info");
			},
		});

		pi.registerCommand("facts", {
			description: "导出客观事实底表（用法: /facts 导出纯数据 Markdown 底表；/facts json 导出高保真结构化 JSON）",
			handler: async (args, ctx) => {
				const isJson = args.trim().toLowerCase() === "json";
				const { exportGroundTruthJson, exportGroundTruthMarkdown } = await import("./exporter.ts");
				if (isJson) {
					const res = exportGroundTruthJson();
					ctx.ui.notify(
						`结构化事实底表已导出：${res.file}（已锁定 ${res.data.statistics.confirmedFindingsCount} 项漏洞、${res.data.statistics.hostsCount} 台主机、${res.data.statistics.endpointsCount} 个端点）`,
						"info",
					);
				} else {
					const res = exportGroundTruthMarkdown();
					ctx.ui.notify(`客观事实底表已导出：${res.file}（零主观废话，纯数据与原始请求响应包）`, "info");
				}
			},
		});

		// -----------------------------------------------------------------------
		// 工具
		// -----------------------------------------------------------------------

	// --- 工具 1：record_fact（图谱核心） ---
	pi.registerTool({
		name: "record_fact",
		label: "记录事实节点",
		description:
			"向事实图谱（画板）记录一个节点（capability=已确认能力 / finding=现场发现 / failure=失败 / hypothesis=假设）。" +
			"若提供 relatedTo（已有节点 id）和 relation（边类型），同时建立一条关系边。每条记录持久化到会话，失败回读时沿边做位置变换。",
		parameters: Type.Object({
			type: Type.Union(
				[
					Type.Literal("capability"),
					Type.Literal("finding"),
					Type.Literal("failure"),
					Type.Literal("hypothesis"),
				],
				{ description: "节点类型" },
			),
			label: Type.String({ description: "一句话描述" }),
			tags: Type.Optional(Type.Array(Type.String(), { description: '标签，如 ["mysql","报错型","回显"]' })),
			detail: Type.Optional(
				Type.String({
					description:
						"补充：证据/失败原因/证伪条件。否定或失败结论必须附证据；手段未穷尽时记 hypothesis 而非 failure（证伪走 update_node rejected，不算失败）",
				}),
			),
				confidence: Type.Optional(
					Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")], {
						description: "置信度（可选）：high=多源证实 / medium=单源实证 / low=单源弱信号",
					}),
				),
				evidenceRequest: Type.Optional(Type.String({ description: "可复现的完整原始 HTTP 请求包（实例证明）" })),
				evidenceResponse: Type.Optional(Type.String({ description: "对应的关键 HTTP 响应包或关键差分切片" })),
				affectedCount: Type.Optional(Type.Integer({ description: "受影响数据总量计数（如 COUNT(*)）" })),
				sampleProof: Type.Optional(Type.String({ description: "脱敏后的最小真实数据样本（3~5行）" })),
				relatedTo: Type.Optional(Type.String({ description: "已有节点 id，如 H1（relation 需成对提供）" })),
			relation: Type.Optional(
				Type.Union(
					[
						Type.Literal("depends_on"),
						Type.Literal("similar_to"),
						Type.Literal("substitutes"),
						Type.Literal("falsifies"),
						Type.Literal("leads_to"),
					],
					{ description: "边类型（与 relatedTo 成对使用）" },
				),
			),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
			const state = getState();
			const node: Node = {
				id: nextId(params.type as NodeType),
				type: params.type as NodeType,
				label: params.label,
				createdAt: new Date().toISOString(),
			};
				if (params.tags && params.tags.length > 0) node.tags = params.tags;
				if (params.detail) node.detail = params.detail;
				if (params.confidence) node.confidence = params.confidence;
				if (params.evidenceRequest) node.evidenceRequest = params.evidenceRequest;
				if (params.evidenceResponse) node.evidenceResponse = params.evidenceResponse;
				if (params.affectedCount !== undefined) node.affectedCount = params.affectedCount;
				if (params.sampleProof) node.sampleProof = params.sampleProof;
				state.nodes.push(node);

			let edgeNote = "";
			if (params.relatedTo) {
				const target = state.nodes.find((n) => n.id === params.relatedTo && n.id !== node.id);
				if (target && params.relation) {
					const edge: Edge = { from: node.id, to: target.id, relation: params.relation as Relation };
					const dup = state.edges.some(
						(e) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation,
					);
					if (!dup) state.edges.push(edge);
					edgeNote = `，已连边 ${node.id} -${params.relation}-> ${target.id}`;
				} else {
					edgeNote = target
						? "（relation 未提供，未连边）"
						: `（relatedTo=${params.relatedTo} 不存在，未连边）`;
				}
			} else if (params.relation) {
				edgeNote = "（relatedTo 未提供，未连边）";
			}
			persist(pi);
			return {
				content: [{ type: "text", text: `已记录 ${node.type} 节点 ${node.id}：「${node.label}」${edgeNote}` }],
				details: { nodeId: node.id },
			};
		},
	});

	// --- 工具 2：record_capability（便捷封装） ---
	pi.registerTool({
		name: "record_capability",
		label: "记录已确认能力",
		description: "记录一条已确认的攻击能力（等价 record_fact(type=capability)），进节奏成功窗口。",
		parameters: Type.Object({
			capability_id: Type.String({ description: "能力 id，如 C1 或 sqli-time-based（重复时自动改号）" }),
			description: Type.String({ description: "能力一句话描述" }),
			evidence: Type.String({ description: "确认证据" }),
			tags: Type.Optional(Type.Array(Type.String(), { description: '标签，如 ["mysql","布尔盲注"]' })),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
			const state = getState();
			let id = params.capability_id;
			if (state.nodes.some((n) => n.id === id)) id = nextId("capability");
			const node: Node = {
				id,
				type: "capability",
				label: params.description,
				detail: params.evidence,
				createdAt: new Date().toISOString(),
			};
			if (params.tags && params.tags.length > 0) node.tags = params.tags;
			state.nodes.push(node);
			pushResult(true);
			persist(pi);
			return {
				content: [{ type: "text", text: `已记录能力 ${id}：「${params.description}」（证据: ${params.evidence}）` }],
				details: { nodeId: id },
			};
		},
	});

	// --- 工具 3：record_failure（失败计数 + ≥6 触发回读警告） ---
	pi.registerTool({
		name: "record_failure",
		label: "记录失败方向",
		description: `记录某攻击方向的一次失败。同方向失败累计 ≥${FAILURE_THRESHOLD} 次触发强制回读（读图谱、沿边找可迁移能力做位置变换）。`,
		parameters: Type.Object({
			direction: Type.String({ description: '攻击方向，如 "id 参数报错型注入"' }),
			reason: Type.String({ description: "失败原因" }),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
			const state = getState();
			const count = bumpFailure(params.direction);
			pushResult(false);
			const node: Node = {
				id: nextId("failure"),
				type: "failure",
				label: params.direction,
				detail: `第 ${count} 次失败：${params.reason}`,
				createdAt: new Date().toISOString(),
			};
			state.nodes.push(node);
			persist(pi);
			let text = `已记录失败（方向「${params.direction}」第 ${count} 次，节点 ${node.id}）：${params.reason}`;
			if (count >= FAILURE_THRESHOLD) {
				text += `\n⚠️ 该方向已失败 ${count} 次（阈值 ${FAILURE_THRESHOLD}），触发强制回读：调用 get_state 读图谱，从失败节点沿边遍历，重点检查 similar_to / substitutes 相邻能力，做位置变换迁移后设计新实验。`;
			} else {
				text += `\n继续变异该方向（<${FAILURE_THRESHOLD} 次不触发回读）。`;
			}
			return {
				content: [{ type: "text", text }],
				details: { direction: params.direction, count, nodeId: node.id },
			};
		},
	});

	// --- 工具 4：get_state ---
	pi.registerTool({
		name: "get_state",
		label: "读取事实图谱",
		description: "读取当前 PiX 状态：模式、节奏窗口、事实图谱（nodes + edges）、各方向失败计数、授权与任务书摘要。",
		parameters: Type.Object({}),
		async execute(_toolCallId) {
			const state = getState();
			const { rate, full } = failureRate();
			const text = JSON.stringify(
				{
					mode: state.mode,
					adaptive: state.adaptive,
					baseIntervalMs: state.baseIntervalMs,
					currentIntervalMs: currentDelayMs(),
					elapsedMin: elapsedMinutes(), // 会话已进行分钟数（收口冲刺依据）
					pacingWindow: {
						recentResults: state.recentResults,
						failureRate: Number(rate.toFixed(2)),
						windowFull: full,
					},
					nodes: state.nodes,
					edges: state.edges,
					hypergraph: {
						hosts: getAllHosts(),
						sessions: getAllSessions(),
						credentials: getAllCredentials(),
					},
					failureCounts: state.failureCounts,
					auth: state.auth ? { targets: state.auth.targets, source: state.auth.source } : null,
					task: state.task ? { title: state.task.title, recordedAt: state.task.recordedAt } : null,
				},
				null,
				2,
			);
			return { content: [{ type: "text", text }], details: {} };
		},
	});

	// --- 工具 5：get_task（任务书全文，redt 围栏读取） ---
	pi.registerTool({
		name: "get_task",
		label: "读取红队任务书",
		description: "读取已登记的红队任务书全文（/task 登记）。redt 模式下围栏细节（范围/时间窗/禁区）以此为准。",
		parameters: Type.Object({}),
		async execute(_toolCallId): Promise<AgentToolResult<{ title?: string }>> {
			const state = getState();
			if (!state.task) {
				return {
					content: [{ type: "text", text: "未登记任务书。用 /task <任务书MD文件路径> 登记。" }],
					details: {},
				};
			}
			return {
				content: [
					{ type: "text", text: `【${state.task.title}】（登记于 ${state.task.recordedAt}）\n\n${state.task.content}` },
				],
				details: { title: state.task.title },
			};
		},
	});

	// --- 工具 6：export_map（Mermaid 思维导图导出） ---
	pi.registerTool({
		name: "export_map",
		label: "导出 Mermaid 图谱",
		description: "把事实图谱导出为 Mermaid graph 语法（leads_to 边加粗为攻击链主线）。存为 .md 可直接渲染。",
		parameters: Type.Object({}),
		async execute(_toolCallId) {
			const text = toMermaid();
			return {
				content: [{ type: "text", text: "```mermaid\n" + text + "\n```\n\n源码：\n```\n" + text + "\n```" }],
					details: {},
			};
		},
	});

	// --- 工具 7：update_node（画板状态流转，[H] confirmed 联动状态机） ---
	pi.registerTool({
		name: "update_node",
		label: "更新画板节点状态",
		description:
			"流转画板节点状态：hypothesis → confirmed（假设证实，联动节奏成功窗口）/ rejected（证伪，信息增益不记失败）。" +
			"finding → confirmed（漏洞坐实，报告数据源）。可附 note 说明结论依据。",
		parameters: Type.Object({
			id: Type.String({ description: "节点 id，如 H1" }),
			status: Type.Union(
				[Type.Literal("open"), Type.Literal("confirmed"), Type.Literal("rejected")],
				{ description: "目标状态" },
			),
			note: Type.Optional(Type.String({ description: "结论依据/证据引用" })),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<{ id?: string; status?: string }>> {
			const node = updateNodeStatus(params.id, params.status as NodeStatus, params.note);
			if (!node) {
				return {
					content: [{ type: "text", text: `节点 ${params.id} 不存在。用 get_state 查看现有节点。` }],
					details: {},
				};
			}
			persist(pi);
			const effect =
				node.type === "hypothesis" && params.status === "confirmed"
					? "（假设证实，已计入节奏成功窗口）"
						: node.type === "finding" && params.status === "confirmed"
							? "（发现坐实，已入账事实超图）"
							: "";
			return {
				content: [
					{ type: "text", text: `节点 ${node.id}（${node.type}）状态已更新为 ${params.status}${effect}` },
				],
				details: { id: node.id, status: params.status },
			};
		},
	});


	// --- 工具 9：record_host（四维超图 · 主机与服务资产） ---
	pi.registerTool({
		name: "record_host",
		label: "记录攻防主机资产",
		description: "向四维超图登记主机资产信息（外网暴露资产/双网卡DMZ/内网资产；IP、系统、所属域、是否域控、是否已攻破提权、突破途径、开放端口服务列表）。自动映射到画板拓扑。",
		parameters: Type.Object({
			ips: Type.Array(Type.String(), { description: "主机 IP 列表（含多网卡）" }),
			hostname: Type.Optional(Type.String({ description: "主机名（NetBIOS/FQDN）" })),
			os: Type.Optional(Type.String({ description: "操作系统及版本，如 Windows Server 2019 / Linux" })),
			domain: Type.Optional(Type.String({ description: "所属 Windows 域，如 corp.local" })),
			networkScope: Type.Optional(
				Type.Union([Type.Literal("external"), Type.Literal("dmz"), Type.Literal("internal")], {
					description: "网络区域：external=外网边界 / dmz=双网卡隔离区 / internal=内网核心",
				}),
			),
			isDC: Type.Optional(Type.Boolean({ description: "是否为域控制器 (Domain Controller)" })),
			isCompromised: Type.Optional(Type.Boolean({ description: "是否已获取执行权限/立足点 (PWNED)" })),
			compromiseVector: Type.Optional(
				Type.String({ description: "边界突破途径/利用漏洞：如 'Shiro反序列化', '文件上传WebShell', '未授权RCE'" }),
			),
			services: Type.Optional(
				Type.Array(
					Type.Object({
						port: Type.Integer({ description: "端口号" }),
						protocol: Type.String({ description: "协议/服务名，如 smb, http, rdp, kerberos, ldap" }),
						banner: Type.Optional(Type.String({ description: "指纹/Banner 摘要" })),
					}),
					{ description: "开放服务列表" },
				),
			),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
			const host = recordHost(params as any);
			persist(pi);
			const scopeDesc = host.networkScope === "external" ? "外网边界" : host.networkScope === "dmz" ? "DMZ跳板" : "内网核心";
			return {
				content: [
					{
						type: "text",
						text: `已入账主机：${host.id} [${host.ips.join("/")}]（区域=${scopeDesc}）${host.isDC ? " (DC)" : ""}${host.isCompromised ? " (⚡PWNED)" : ""}，开放服务 ${host.services.length} 个`,
					},
				],
				details: { hostId: host.id },
			};
		},
	});

	// --- 工具 10：record_pivot（四维超图 · 隧道与跳板路由） ---
	pi.registerTool({
		name: "record_pivot",
		label: "登记内网跳板与隧道",
		description: "登记打通的内网隧道/跳板（如 Chisel/FRP/Socks5/SSH 动态代理）。登记后，向对应内网网段发送的命令将自动获知并透明走代理通道。",
		parameters: Type.Object({
			sourceHostId: Type.String({ description: "驻留的受控主机 ID（如 host_10_10_1_20）" }),
			tunnelType: Type.Union(
				[
					Type.Literal("socks5"),
					Type.Literal("ssh_tun"),
					Type.Literal("frp"),
					Type.Literal("cmd_pipe"),
					Type.Literal("webshell"),
				],
				{ description: "隧道类型" },
			),
			localListenPort: Type.Integer({ description: "本机监听的代理端口，如 10808" }),
			egressSubnets: Type.Array(Type.String(), { description: "可路由达到的内网网段，如 [\'10.10.1.0/24\', \'172.16.0.0/16\']" }),
			status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("dead")], { description: "跳板状态" })),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
			const sess = recordPivotSession(params as any);
			persist(pi);
			return {
				content: [
					{
						type: "text",
						text: `已建立内网跳板：${sess.id}（类型=${sess.tunnelType}，本地端口=${sess.localListenPort}，可达网段=${sess.egressSubnets.join(", ")}）`,
					},
				],
				details: { sessionId: sess.id },
			};
		},
	});

	// --- 工具 11：record_cred（四维超图 · 凭据金库与权限） ---
	pi.registerTool({
		name: "record_cred",
		label: "登记已收割凭据",
		description: "向凭据金库登记提取到的密码、NTLM Hash、Kerberos 票据或 SSH 私钥。用于横向移动矩阵与凭据喷洒。",
		parameters: Type.Object({
			account: Type.String({ description: "账号/用户名" }),
			domain: Type.Optional(Type.String({ description: "域名或本地主机名" })),
			type: Type.Union(
				[
					Type.Literal("plaintext"),
					Type.Literal("ntlm_hash"),
					Type.Literal("kerberos_ticket"),
					Type.Literal("ssh_key"),
					Type.Literal("api_key"),
				],
				{ description: "凭据类型" },
			),
			value: Type.String({ description: "密码明文、Hash 或票据内容" }),
			originHostId: Type.String({ description: "从哪台主机收割到的凭据 ID" }),
			privilegeScope: Type.Optional(
				Type.Union(
					[
						Type.Literal("local_admin"),
						Type.Literal("domain_admin"),
						Type.Literal("domain_user"),
						Type.Literal("guest"),
					],
					{ description: "权限等级" },
				),
			),
			validTargets: Type.Optional(Type.Array(Type.String(), { description: "已验证可登录的主机 ID 列表" })),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
			const cred = recordCredential(params as any);
			persist(pi);
			return {
				content: [
					{
						type: "text",
						text: `凭据已入库：${cred.id} [${cred.type}] ${cred.domain ? cred.domain + "\\" : ""}${cred.account} (${cred.privilegeScope})`,
					},
				],
				details: { credId: cred.id },
			};
		},
	});

		// --- 工具 12：consult_tactics（动态装载实战战术库与规约） ---
		pi.registerTool({
			name: "consult_tactics",
			label: "查阅红队战术与规约",
			description: "按需即时查阅内网横向、AD域控、隧道穿透、测绘管线等实战 SOP 规约与绕过字典。绝不膨胀全局上下文。",
		parameters: Type.Object({
			query: Type.String({
				description: "战术关键词，如: 'kerberos', 'pth', 'adcs', 'lateral', 'tunnel', 'waf', 'subdomain', 'privesc', 'ledger'",
			}),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
			const matches = searchTactics(params.query, 3);
			if (matches.length === 0) {
				return {
					content: [{ type: "text", text: `未找到与 '${params.query}' 相关的战术专题。可尝试关键词: kerberos, lateral, tunnel, adcs, ntlm, privesc, recon.` }],
					details: { count: 0 },
				};
			}
			const sections = matches.map((m) => {
				const sop = readTacticalSOP(m, 2000);
				return `### 【${m.theater.toUpperCase()}】${m.title}\n*来源：${m.filePath}*\n\n${sop}`;
			});
			return {
				content: [{ type: "text", text: `已动态加载 ${matches.length} 个相关战术专题：\n\n${sections.join("\n\n---\n\n")}` }],
				details: { count: matches.length },
			};
		},
	});

	// --- 工具 13：pivot_exec（跳板代理感知包装器） ---
	pi.registerTool({
		name: "pivot_exec",
		label: "生成跳板代理路由命令",
		description: "自动检查目标 IP 是否位于内网，若是且已建跳板，自动将其包装为 proxychains 代理链执行命令。",
		parameters: Type.Object({
			command: Type.String({ description: "待执行的原命令，例如: 'nxc smb 10.10.1.20 -u admin -p pass'" }),
			targetIp: Type.Optional(Type.String({ description: "目标 IP 地址（若不提供则自动从 command 中解析）" })),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
				const res = wrapCommandWithPivot(params.command, params.targetIp);
				if (res.viaPivot) {
					const methodDesc = res.strategy === "native" ? "原生注入 --proxy 代理参数" : "proxychains 代理链包裹";
					return {
						content: [
							{
								type: "text",
								text: `已路由至跳板 ${res.viaPivot.id}（本地端口 ${res.viaPivot.localListenPort}，模式=${methodDesc}）。请在 bash 中执行以下命令：\n\`\`\`bash\n${res.command}\n\`\`\``,
							},
						],
						details: { routed: true, viaPivot: res.viaPivot.id, command: res.command, strategy: res.strategy },
					};
				}
			return {
				content: [
					{
						type: "text",
						text: `未发现适用的内网跳板路由（目标非内网或尚未建立对应网段隧道）。原生执行命令：\n\`\`\`bash\n${res.command}\n\`\`\``,
					},
				],
				details: { routed: false, command: res.command },
			};
		},
	});

		// --- 工具 8：toolbox（工具注册表网关，M2） ---
		registerToolboxTool(pi);

		// --- 工具 14：record_endpoint（Web/API 接口资产台账登记） ---
		pi.registerTool({
			name: "record_endpoint",
			label: "登记接口资产台账",
			description:
				"向接口台账登记发现的 Web/API 端点（URL、方法、参数、来源）。自动录入状态机，确保接口 100% 逐条闭环测试，杜绝抽样遗漏。",
			parameters: Type.Object({
				url: Type.String({ description: "完整接口 URL 或相对路径，例如 'https://target.com/api/v1/user'" }),
				method: Type.Optional(
					Type.Union(
						[
							Type.Literal("GET"),
							Type.Literal("POST"),
							Type.Literal("PUT"),
							Type.Literal("DELETE"),
							Type.Literal("PATCH"),
							Type.Literal("HEAD"),
							Type.Literal("OPTIONS"),
						],
						{ description: "HTTP 请求方法，默认 GET" },
					),
				),
				params: Type.Optional(Type.Array(Type.String(), { description: "提取到的参数名列表，如 ['id', 'token']" })),
				authRequired: Type.Optional(Type.Boolean({ description: "是否需要登录鉴权" })),
				discoveredFrom: Type.Optional(Type.String({ description: "提取来源工具或途径（如 'rotor-goddess', 'katana', 'JS逆向'）" })),
			}),
			async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
				const ep = recordEndpoint(params as any);
				persist(pi);
				return {
					content: [
						{
							type: "text",
							text: `接口已入账台账：${ep.id} [${ep.method}] ${ep.url}（状态=${ep.status}，参数=${(ep.params || []).join(", ") || "无"}）`,
						},
					],
					details: { endpointId: ep.id },
				};
			},
		});

		// --- 工具 15：update_endpoint（接口状态机流转） ---
		pi.registerTool({
			name: "update_endpoint",
			label: "流转接口测试状态",
			description:
				"推进接口台账的测试状态机：probing(探针测试中) -> bypassing(遭遇阻碍变异绕过中) -> confirmed(证实有漏洞)/rejected(已穷尽排除)。",
			parameters: Type.Object({
				idOrUrl: Type.String({ description: "接口 ID（如 ep_1）或完整 URL" }),
				status: Type.Union(
					[
						Type.Literal("probing"),
						Type.Literal("bypassing"),
						Type.Literal("confirmed"),
						Type.Literal("rejected"),
					],
					{ description: "流转目标状态" },
				),
				vulnerability: Type.Optional(Type.String({ description: "若证实存在漏洞，记录关联漏洞名称/类型" })),
			}),
			async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
				const ep = updateEndpointStatus(params.idOrUrl, params.status as EndpointStatus, params.vulnerability);
				if (!ep) {
					return {
						content: [{ type: "text", text: `未找到接口「${params.idOrUrl}」，请先通过 record_endpoint 登记。` }],
						details: {},
					};
				}
				persist(pi);
				return {
					content: [
						{
							type: "text",
							text: `接口 ${ep.id} 状态已流转为 [${ep.status}]（已测 ${ep.testedTimes} 次）${params.vulnerability ? ` 漏洞: ${params.vulnerability}` : ""}`,
						},
					],
					details: { endpointId: ep.id, status: ep.status },
				};
			},
		});

		// --- 工具 16：export_facts（一键导出结构化事实底表） ---
		pi.registerTool({
			name: "export_facts",
			label: "导出客观事实底表",
			description:
				"一键冻结并导出超图全量客观事实底表（支持 format='json' 导出机器可读高保真数据，或 format='md' 导出表格化事实）。供填入任何报告模板。",
			parameters: Type.Object({
				format: Type.Optional(Type.Union([Type.Literal("json"), Type.Literal("md")], { description: "导出格式，默认 json" })),
			}),
			async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
				const isMd = params.format === "md";
				const { exportGroundTruthJson, exportGroundTruthMarkdown } = await import("./exporter.ts");
				if (isMd) {
					const res = exportGroundTruthMarkdown();
					return {
						content: [{ type: "text", text: `客观事实底表已导出至：\n${res.file}\n\n预览片段：\n${res.text.slice(0, 500)}...` }],
						details: { file: res.file },
					};
				}
				const res = exportGroundTruthJson();
				return {
					content: [
						{
							type: "text",
							text: `结构化事实快照（JSON）已导出至：\n${res.file}\n（包含 ${res.data.statistics.confirmedFindingsCount} 项漏洞、${res.data.statistics.hostsCount} 台主机、${res.data.statistics.endpointsCount} 个端点），可供任意自定义模板水合填充。`,
						},
					],
					details: { file: res.file, statistics: res.data.statistics },
				};
			},
		});

	}
