/**
 * toolbox.ts — 工具注册表网关（三入口：list / howto / search）
 *
 * 发现式工具面：完整工具目录不占 system prompt，
 * Agent 经 toolbox 工具按需发现（list→howto→用 bash 执行），
 * 工具卡内嵌于注册表，人工维护 hardRules（双层说明书思想的简化）。
 *
 * 数据源：内嵌 TOOLBOX（31 实测 + 8 扩展位，路径 = 项目内 tools/ 随包分发）。
 * howto 状态：会话内记录已读卡工具（供读卡门禁 gate.ts 判定）。
 */

import { existsSync } from "node:fs";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TOOLBOX, TOOLS_ROOT, type ToolCard, type ToolCategory } from "./toolbox-data.ts";

/** 本会话已 howto 读卡的工具名集合（gate.ts 读卡门禁的放行依据） */
const howtoDone = new Set<string>();
export function hasBeenRead(cardName: string): boolean {
	return howtoDone.has(cardName.toLowerCase());
}

const CATEGORY_LABEL: Record<ToolCategory, string> = {
	recon: "信息收集（子域/存活/指纹/端口/目录/JS/爬虫）",
	intranet: "内网与横向",
	exploit: "漏洞验证与利用",
	crypto: "解密与凭证",
	reverse: "逆向与二进制分析",
	cloud: "云环境（只读口径）",
	util: "基础件",
};

/** 注册表 = 内嵌 39 卡（31 实测 + 8 扩展位；工具随项目分发，路径已在数据层 TOOLS_ROOT 化） */
export function loadRegistry(): ToolCard[] {
	return [...TOOLBOX];
}

/** 可用性探测（available + reason） */
function availability(card: ToolCard): { available: boolean; reason: string } {
	if (!card.tested && !card.path) {
		return { available: false, reason: card.installHint ? `扩展位未安装：${card.installHint}` : "未安装" };
	}
	if (card.runtime === "python" || card.runtime === "java") {
		if (card.runtimePath && !existsSync(card.runtimePath)) return { available: false, reason: `解释器不存在: ${card.runtimePath}` };
	}
	if (card.path && !existsSync(card.path)) return { available: false, reason: `可执行文件不存在: ${card.path}` };
	return { available: true, reason: "ok" };
}

/** 路径类占位符替换（参数类占位符 <域名> 等保留给模型填） */
function hydrateInvocation(card: ToolCard, text: string): string {
	const wordlistsRoot = TOOLS_ROOT + "\\wordlists";
	return text
		.replace(/<path>/g, (card.path ?? "<path缺失>").replace(/\\/g, "/"))
		.replace(/<runtime>/g, card.runtimePath ?? card.runtime)
		.replace(/<workdir>/g, (card.workdir ?? "").replace(/\\/g, "/"))
		.replace(/<wordlists>/g, wordlistsRoot.replace(/\\/g, "/"))
		.replace(/<字典路径>/g, (wordlistsRoot + "\\网站目录字典\\dicc.txt").replace(/\\/g, "/"));
}

function renderCard(card: ToolCard): string {
	const av = availability(card);
	const L: string[] = [];
	L.push(`# 工具卡 · ${card.name} [${CATEGORY_LABEL[card.category]}]`);
	L.push(`用途：${card.purpose}`);
	L.push(`可用性：${av.available ? "✅ 可用" : `❌ ${av.reason}`}`);
	L.push(`运行方式：${card.runtime}${card.runtimePath ? `（${card.runtimePath}）` : ""}`);
	if (card.path) L.push(`实际路径：${card.path}`);
	if (card.workdir) L.push(`工作目录：${card.workdir}`);
	L.push("");
	L.push(`## 唯一姿势（偏离 = 预期失败；<路径类>占位符已替换为实际值，尖括号参数由你填）`);
	L.push("```bash");
	if (card.workdir) L.push(`cd ${card.workdir.replace(/\\/g, "/")}`);
	if (card.runtime === "python") L.push(`NO_PROXY=127.0.0.1,localhost HTTP_PROXY= HTTPS_PROXY= ${card.runtimePath} ${(card.path ?? "").replace(/\\/g, "/")}`);
	else L.push(hydrateInvocation(card, card.invocation));
	L.push("```");
	if (card.runtime !== "direct" && card.invocation) {
		L.push(`姿势模板：${hydrateInvocation(card, card.invocation)}`);
	}
	L.push("");
	L.push("## 硬约束（违反=翻车或越红线）");
	card.hardRules.forEach((r, i) => L.push(`${i + 1}. ${r}`));
	if (card.params?.length) {
		L.push("");
		L.push("## 参数速查");
		L.push(...card.params.map((p) => `- ${p}`));
	}
	if (card.rate) {
		L.push("");
		L.push(`## 限速：${card.rate}`);
	}
	if (card.traps?.length) {
		L.push("");
		L.push("## 已知陷阱");
		L.push(...card.traps.map((t) => `- ${t}`));
	}
	if (card.installHint) {
		L.push("");
		L.push(`## 安装：${card.installHint}`);
	}
	return L.join("\n");
}

/** 关键词打分（中英 aliases + purpose 模糊匹配） */
function score(card: ToolCard, query: string): { score: number; why: string[] } {
	const q = query.toLowerCase();
	const why: string[] = [];
	let s = 0;
	if (card.name.toLowerCase().includes(q)) {
		s += 5;
		why.push(`名称命中`);
	}
	for (const a of card.aliases) {
		if (a.toLowerCase().includes(q) || q.includes(a.toLowerCase())) {
			s += 3;
			why.push(`别名「${a}」`);
		}
	}
	if (card.purpose.toLowerCase().includes(q)) {
		s += 2;
		why.push("用途命中");
	}
	return { score: s, why };
}

/** 全量工具卡手册（/toolbox export 用）：按类别分组的单文件 MD */
export function renderAllCards(): string {
	const registry = loadRegistry();
	const L: string[] = [
		`# PiX 工具卡手册`,
		"",
		`导出于 ${new Date().toLocaleString()} · ${registry.length} 个工具（随包 tools/ 内置）`,
		"",
	];
	const byCat = new Map<string, ToolCard[]>();
	for (const c of registry) {
		if (!byCat.has(c.category)) byCat.set(c.category, []);
		byCat.get(c.category)!.push(c);
	}
	for (const [cat, cards] of byCat) {
		L.push(`---`, ``, `# ${CATEGORY_LABEL[cat as ToolCategory] ?? cat}`, ``);
		for (const c of cards) L.push(renderCard(c), "");
	}
	return L.join("\n");
}

export function registerToolboxTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "toolbox",
		label: "渗透工具箱",
		description:
			"渗透工具注册表网关。action=list 列全量工具（分类分组）；action=howto 查单个工具卡（唯一姿势/硬约束/参数/陷阱）；" +
			"action=search 按任务关键词找工具（返回 top3 候选）。凡调用本地 CLI 工具，必须先 howto 读卡再拼命令。",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("howto"), Type.Literal("search")], {
				description: "list=全量清单 / howto=单个工具卡 / search=按任务找工具",
			}),
			tool: Type.Optional(Type.String({ description: "howto 时必填：工具名（如 sqlmap）" })),
			task: Type.Optional(Type.String({ description: "search 时必填：任务描述（如「目录爆破」「JS 提 AK/SK」）" })),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<{ count?: number; tool?: string }>> {
			const registry = loadRegistry();
			if (params.action === "list") {
				const byCat = new Map<ToolCategory, ToolCard[]>();
				for (const c of registry) {
					if (!byCat.has(c.category)) byCat.set(c.category, []);
					byCat.get(c.category)!.push(c);
				}
				const L: string[] = [`PiX 工具注册表（${registry.length} 个）——调用前先 howto 读卡：`];
				for (const [cat, cards] of byCat) {
					L.push("");
					L.push(`【${CATEGORY_LABEL[cat]}】`);
					for (const c of cards) {
						const av = availability(c);
						L.push(`- ${c.name}${c.tested ? "" : "（扩展位）"}：${c.purpose}${av.available ? "" : ` ⚠️不可用——${av.reason}`}`);
					}
				}
				return { content: [{ type: "text", text: L.join("\n") }], details: { count: registry.length } };
			}
			if (params.action === "howto") {
				const name = (params.tool ?? "").trim().toLowerCase();
				const card = registry.find((c) => c.name.toLowerCase() === name || c.aliases.some((a) => a.toLowerCase() === name));
				if (!card) {
					const near = registry.filter((c) => c.name.toLowerCase().includes(name)).map((c) => c.name).slice(0, 5);
					return {
						content: [
							{
								type: "text",
								text: `未找到工具「${params.tool}」。${near.length ? `相近名称：${near.join("、")}` : "用 toolbox action=list 查全量清单。"}`,
							},
						],
						details: {},
					};
				}
				// 读卡记账（gate.ts 读卡门禁的放行依据；search 不算读卡）
				howtoDone.add(card.name.toLowerCase());
				return { content: [{ type: "text", text: renderCard(card) }], details: { tool: card.name } };
			}
			// search
			const query = (params.task ?? "").trim();
			if (!query) {
				return { content: [{ type: "text", text: "search 需要 task 参数，如 toolbox({action:'search', task:'子域收集'})" }], details: {} };
			}
			const ranked = registry
				.map((c) => ({ card: c, ...score(c, query) }))
				.filter((x) => x.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, 3);
			if (ranked.length === 0) {
				return { content: [{ type: "text", text: `无匹配工具（关键词「${query}」）。用 action=list 查全量。` }], details: {} };
			}
			const L: string[] = [`任务「${query}」候选工具（top${ranked.length}）：`];
			for (const r of ranked) {
				const av = availability(r.card);
				L.push("");
				L.push(`● ${r.card.name} —— ${r.card.purpose}`);
				L.push(`  匹配理由：${r.why.join("；")}${av.available ? "" : ` ⚠️不可用——${av.reason}`}`);
				L.push(`  确认使用请执行 toolbox({action:'howto', tool:'${r.card.name}'}) 读完整工具卡`);
			}
			return { content: [{ type: "text", text: L.join("\n") }], details: {} };
		},
	});
}
