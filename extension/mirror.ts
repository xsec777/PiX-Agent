/**
 * mirror.ts — 落库→画板单向自动镜像（pentrack MCP 调用观察）
 *
 * 画板（record_*，会话工作记忆）与 pentrack（fact_add/graph_node_add/vuln_add，项目账本）
 * 原是两套平行记账——同一认知要记两次，遵从率仅 11.4%。本模块让「落库即记账」：
 * tool_call 钩子观察 mcp__pentrack__* 入参，按映射表自动建画板节点/边。
 *
 * 映射表：
 *   fact_add        → N(finding)（tags=category，confidence 随带）
 *   vuln_add        → N(finding)（tags=[vuln, severity]）
 *   graph_node_add  → hypothesis/finding→H/N（status 直映射）；goal→可解析出范围时登记授权
 *   graph_edge_add  → derives_from→depends_on / tests→depends_on / refutes→falsifies / leads_to→leads_to
 *   asset_batch_add → 不镜像（资产会淹画板，资产归 pentrack）
 *
 * 方向单向：画板→pentrack 代写是越界（落库语义归技能包），本模块只 observation。
 * 挂载点=tool_call（提案即镜像）：即使该调用随后失败画板也留痕（会话工作记忆，
 * 代价可接受），且不依赖 MCP 是否真实连通。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getState, nextId, persist, pushResult, type Node, type NodeStatus, type Relation } from "./state.ts";

const EDGE_MAP: Record<string, Relation> = {
	derives_from: "depends_on",
	tests: "depends_on",
	refutes: "falsifies",
	leads_to: "leads_to",
};

/** pentrack node_key/fact_key → 画板节点 id（边映射用；goal 记为特殊值） */
const keyToNode = new Map<string, string>();
const GOAL_SENTINEL = "__goal__";
/** 本会话经由 pentrack 落库产生的画板节点（/report 落库核对用） */
const ledgerNodes = new Set<string>();

export function mirroredNodeIds(): Set<string> {
	return ledgerNodes;
}

function commit(pi: ExtensionAPI, node: Node): void {
	getState().nodes.push(node);
	pushResultIfConfirmed(node);
	ledgerNodes.add(node.id);
	persist(pi);
}

/** 画板是否已有同 label 的 finding——跨会话防重（keyToNode 是会话内映射，resume 后丢失） */
function hasFindingLabel(label: string): boolean {
	return getState().nodes.some((n) => n.type === "finding" && n.label === label.slice(0, 90));
}

function pushResultIfConfirmed(node: Node): void {
	if (node.status === "confirmed") pushResult(true); // 落库即确认=成功信号（与 update_node 同语义）
}

function makeNode(
	type: Node["type"],
	label: string,
	extra: { tags?: string[]; detail?: string; status?: NodeStatus; confidence?: string } = {},
): Node {
	const node: Node = {
		id: nextId(type),
		type,
		label: label.slice(0, 90) || type,
		createdAt: new Date().toISOString(),
	};
	if (extra.tags?.length) node.tags = extra.tags;
	if (extra.detail) node.detail = extra.detail;
	if (extra.status) node.status = extra.status;
	if (extra.confidence) node.confidence = extra.confidence;
	return node;
}

/** tool_call 钩子挂载：镜像 pentrack 落库调用（非 pentrack 调用直接返回） */
export function mirrorPentrackCall(pi: ExtensionAPI, toolName: string, input: Record<string, unknown>): void {
	if (!toolName.startsWith("mcp__pentrack__")) return;
	const op = toolName.slice("mcp__pentrack__".length);
	try {
		if (op === "fact_add") {
			const key = String(input.fact_key ?? "");
			const label = String(input.summary ?? input.body ?? key);
			if (!key || keyToNode.has(key) || hasFindingLabel(label)) return;
			const node = makeNode("finding", label, {
				tags: input.category ? [String(input.category)] : undefined,
				detail: String(input.body ?? "").slice(0, 240) || undefined,
				confidence: typeof input.confidence === "string" ? input.confidence : undefined,
			});
			commit(pi, node);
			keyToNode.set(key, node.id);
		} else if (op === "vuln_add") {
			const title = String(input.title ?? "");
			// vuln_id 仅作去重辅助（map 已保证同标题只镜像一次），首次提交带预生成 id 也正常镜像
			if (!title) return;
			if (keyToNode.has("vuln:" + title) || hasFindingLabel(title)) return;
			const tags = ["vuln"];
			if (input.severity) tags.push(String(input.severity));
			const node = makeNode("finding", title, {
				tags,
				detail: String(input.evidence ?? "").slice(0, 240) || undefined,
			});
			commit(pi, node);
			keyToNode.set("vuln:" + title, node.id);
		} else if (op === "graph_node_add") {
			const key = String(input.node_key ?? "");
			const type = String(input.node_type ?? "goal");
			const status = String(input.status ?? "open");
			if (type === "goal") {
				// 授权单源化：仅当 goal 标题可解析出 IP/域名/CIDR 才登记为授权范围；
				// 无范围的 goal（如"获取域控权限"）只注入任务书提示段，不污染 auth 围栏
				const title = String(input.title ?? "").trim();
				if (title && /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,})$/.test(title)) {
					if (!getState().auth) {
						getState().auth = {
							targets: [title],
							source: `pentrack goal（${String(input.body ?? "").slice(0, 80)}）`,
							recordedAt: new Date().toISOString(),
						};
						persist(pi);
					}
				}
				if (key) keyToNode.set(key, GOAL_SENTINEL);
				return;
			}
			if (type !== "hypothesis" && type !== "finding") return; // intent/asset 不镜像
			if (!key || keyToNode.has(key) || hasFindingLabel(String(input.title ?? key))) return;
			const node = makeNode(type, String(input.title ?? key), {
				detail: String(input.body ?? "").slice(0, 240) || undefined,
				status: (["open", "confirmed", "rejected"] as const).includes(status as NodeStatus)
					? (status as NodeStatus)
					: undefined,
			});
			commit(pi, node);
			keyToNode.set(key, node.id);
		} else if (op === "graph_edge_add") {
			const from = keyToNode.get(String(input.source_key ?? ""));
			const to = keyToNode.get(String(input.target_key ?? ""));
			const rel = EDGE_MAP[String(input.edge_type ?? "")];
			if (!from || !to || !rel || from === GOAL_SENTINEL || to === GOAL_SENTINEL || from === to) return;
			const state = getState();
			const dup = state.edges.some((e) => e.from === from && e.to === to && e.relation === rel);
			if (!dup) {
				state.edges.push({ from, to, relation: rel });
				persist(pi);
			}
		}
		// 其它 op（asset_batch_add/chain_auto_build/report_generate/project_*…）不镜像
	} catch {
		// 镜像失败静默：画板是辅助视图，不阻断主流程
	}
}
