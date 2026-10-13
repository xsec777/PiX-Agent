/**
 * state.ts — PiX 状态模型与持久化
 *
 * 存储介质：Pi 原生 appendEntry（append-only，跨 compaction 存活）。
 * 读回：session_start 时从 sessionManager.getEntries() 倒序找最新一条
 *       customType === STATE_TYPE 的条目（官方 bookmark.ts 范式）。
 *
 * 兼容迁移：v1（pentest-state，mode=strict|aggressive）条目在读回时自动
 * 映射为 v2（pix-state，mode=pent|redt），旧会话 resume 不丢图谱。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const STATE_TYPE = "pix-state";
/** 历史画板编辑条目（v3 画板时代由 ：30146 服务写入；UI 已下线，本类型仅存读回兼容） */
const BOARD_EDIT_TYPE = "pix-board-edit";
/** 旧版（M1 pentest 扩展）的 customType，仅用于读回迁移 */
const LEGACY_STATE_TYPE = "pentest-state";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type Mode = "pent" | "redt";

export type NodeType = "capability" | "finding" | "failure" | "hypothesis";

export type Relation = "depends_on" | "similar_to" | "substitutes" | "falsifies" | "leads_to";

export type NodeStatus = "open" | "confirmed" | "rejected";

export interface Node {
	/** 形如 C1/F1/H1/N1（capability/failure/hypothesis/finding 的自增编号） */
	id: string;
	type: NodeType;
	label: string;
	tags?: string[];
	detail?: string;
	/** 画板状态（hypothesis 主用：open→confirmed/rejected；confirmed 与状态机 [H] 段联动） */
	status?: NodeStatus;
	/** 置信度（high/medium/low；record_fact 与 pentrack 镜像可带） */
	confidence?: string;
	createdAt: string;
}

export interface Edge {
	from: string;
	to: string;
	relation: Relation;
}

// ---------------------------------------------------------------------------
// 画板用户叠加层（v3）：画布编辑同步回 Agent
// 语义图（nodes/edges）归 agent；用户在画布上的视觉层改动（便签/画笔/节点偏移/
// 用户连线）落 boardOverlay，状态切换直接写 node.status。报告不含视觉层。
// ---------------------------------------------------------------------------

interface BoardNote {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	text: string;
}

interface BoardStroke {
	id: string;
	points: number[][];
	color?: string;
}

interface BoardOverlay {
	notes: BoardNote[];
	strokes: BoardStroke[];
	/** 节点拖拽偏移（自动布局基准位 + 偏移 = 用户摆放位置） */
	offsets: Record<string, { dx: number; dy: number }>;
	/** 用户手绘连线（from/to 为节点 id；语义关系归 agent，用户连线仅展示+提示） */
	userEdges: { from: string; to: string }[];
}

function emptyOverlay(): BoardOverlay {
	return { notes: [], strokes: [], offsets: {}, userEdges: [] };
}


type BoardEditOp =
	| { op: "note.add"; id: string; x: number; y: number; w: number; h: number; text: string }
	| { op: "note.edit"; id: string; text: string }
	| { op: "note.move"; id: string; x: number; y: number }
	| { op: "note.del"; id: string }
	| { op: "stroke.add"; id: string; points: number[][]; color?: string }
	| { op: "stroke.del"; id: string }
	| { op: "node.move"; target: string; dx: number; dy: number }
	| { op: "node.status"; target: string; status: NodeStatus }
	| { op: "edge.user"; from: string; to: string }
	| { op: "edge.user.del"; from: string; to: string }
	| { op: "overlay.sync"; overlay: BoardOverlay };

/** 授权范围登记（/auth 写入） */
interface AuthScope {
	/** 目标列表：域名 / IP / CIDR / URL，自由文本数组 */
	targets: string[];
	/** 授权来源说明（如 "SRC 授权范围" / "自建靶场" / 任务书名） */
	source: string;
	recordedAt: string;
}

/** 红队任务书（/task 写入，REDT 模式的围栏事实源） */
interface TaskBrief {
	title: string;
	/** 任务书原文（范围/授权时间/目标/禁区），MD 全文 */
	content: string;
	recordedAt: string;
}

interface PixState {
	mode: Mode;
	/** 节奏自适应开关（/mode adaptive on|off） */
	adaptive: boolean;
	/** 基准间隔：pent=2000ms / redt=1000ms */
	baseIntervalMs: number;
	/** 滑动窗口（true=成功），只保留最近 ADAPTIVE_WINDOW 次 */
	recentResults: boolean[];
	nodes: Node[];
	edges: Edge[];
	/** 失败计数（按方向），达到 FAILURE_THRESHOLD 触发强制回读 */
	failureCounts: Record<string, number>;
	/** 会话开始时间（get_state elapsedMin / 收口冲刺依据） */
	sessionStartedAt: number;
	/** 授权范围（可选，/auth 登记） */
	auth?: AuthScope;
	/** 红队任务书（可选，/task 登记） */
	task?: TaskBrief;
	/** 画板用户叠加层（可选；v3 画布编辑同步） */
	boardOverlay?: BoardOverlay;
	/** pix-board-edit 消费水位线（条目 ts；幂等，跨 compaction 由 persist 保住） */
	boardEditWatermark?: number;
}

// ---------------------------------------------------------------------------
// 常量（对外导出，供 rules/index 共用；阈值按最终方案定死）
// ---------------------------------------------------------------------------

/** 强制回读触发阈值：同一方向失败 ≥6 次（定死，不做配置项） */
export const FAILURE_THRESHOLD = 6;

export const ADAPTIVE_WINDOW = 10;

const BASE_INTERVAL_MS: Record<Mode, number> = { pent: 2000, redt: 1000 };

// ---------------------------------------------------------------------------
// 实例与读写
// ---------------------------------------------------------------------------

let state: PixState = freshState();

function freshState(): PixState {
	return {
		mode: "pent",
		adaptive: true,
		baseIntervalMs: BASE_INTERVAL_MS.pent,
		recentResults: [],
		nodes: [],
		edges: [],
		failureCounts: {},
		sessionStartedAt: Date.now(),
	};
}

export function getState(): PixState {
	return state;
}

/** 切换模式：同步基准间隔并返回（persist 由调用方决定） */
export function setMode(mode: Mode): void {
	state.mode = mode;
	state.baseIntervalMs = BASE_INTERVAL_MS[mode];
}

/** 结果进窗口（只留最近 ADAPTIVE_WINDOW 次） */
export function pushResult(ok: boolean): void {
	state.recentResults.push(ok);
	if (state.recentResults.length > ADAPTIVE_WINDOW) state.recentResults.shift();
}

/** 写入会话（append-only；Pi 保证落盘）+
 *  双写 cwd/pix-state.json（原子写）——跨会话知识继承（超时重跑/次日续做不再从零） */
export function persist(pi: ExtensionAPI): void {
	pi.appendEntry(STATE_TYPE, state);
	try {
		writeStateSnapshot();
	} catch {
		// cwd 存档失败静默（会话内持久化仍可用）
	}
}

// ---------------------------------------------------------------------------
// cwd 级画板存档（跨会话持久化）
// 文件：<cwd>/pix-state.json；原子写（.tmp + rename 防并发撕裂）。
// 读回时机：session_start 且本会话 entries 无 pix-state（全新会话）→ 注入【历史画板】摘要。
// ---------------------------------------------------------------------------

interface CwdSnapshot {
	savedAt: string;
	state: PixState;
}

function writeStateSnapshot(): void {
	const file = join(process.cwd(), "pix-state.json");
	const tmp = join(process.cwd(), "pix-state.tmp");
	writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), state }), "utf8");
	renameSync(tmp, file);
}

export function readStateSnapshot(): CwdSnapshot | null {
	try {
		const d = JSON.parse(readFileSync(join(process.cwd(), "pix-state.json"), "utf8"));
		const restored = asState(d.state);
		if (!restored) return null;
		return { savedAt: typeof d.savedAt === "string" ? d.savedAt : "", state: restored };
	} catch {
		return null;
	}
}

/** 历史画板摘要（注入 section【历史画板·上次会话进展】；~200 token） */
export function historySummary(snap: CwdSnapshot): string {
	const s = snap.state;
	const byType = { capability: 0, finding: 0, failure: 0, hypothesis: 0 };
	for (const n of s.nodes) byType[n.type] += 1;
	const hyps = s.nodes.filter((n) => n.type === "hypothesis" && (!n.status || n.status === "open")).slice(0, 3);
	const caps = s.nodes.filter((n) => n.type === "capability").slice(0, 3);
	const parts = [
		`保存于 ${snap.savedAt} · 节点 ${s.nodes.length}（能力 ${byType.capability} / 发现 ${byType.finding} / 假设 ${byType.hypothesis} / 失败 ${byType.failure}）· 边 ${s.edges.length} 条`,
	];
	if (caps.length) parts.push("已确认能力：" + caps.map((n) => `${n.id} ${n.label}`).join("；"));
	if (hyps.length) parts.push("未闭合假设：" + hyps.map((n) => `${n.id} ${n.label}`).join("；"));
	return parts.join("\n");
}

/** 会话已进行分钟数（get_state elapsedMin / 收口冲刺依据） */
export function elapsedMinutes(): number {
	return Math.round((Date.now() - getState().sessionStartedAt) / 60000);
}

/**
 * 收口冲刺是否激活（规则注入与节奏提速共用同一条件，防口径漂移）。
 * 判定 = 已进行分钟数 >= 时限 - 5；时限默认 30min（与 bench-run --timeout-min 默认一致），
 * PIX_TIME_BUDGET_MIN 可覆盖。仅评测类长会话由调用方（rules/pacing）决定是否启用本判定。
 */
export function isTimeRushActive(budgetMin = Number(process.env.PIX_TIME_BUDGET_MIN ?? "30")): boolean {
	return elapsedMinutes() >= budgetMin - 5;
}

type SessionEntry = { type?: string; customType?: string; data?: unknown };

/**
 * session_start 读回：倒序找最新一条状态条目。
 * 同时识别旧版 pentest-state（strict→pent / aggressive→redt 迁移）。
 * @param entries ctx.sessionManager.getEntries() 的结果（由入口传入）
 */
export function restoreFromEntries(pi: ExtensionAPI, entries: unknown[]): { restored: boolean; migrated: boolean } {
	let migrated = false;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as SessionEntry;
		if (entry.type !== "custom") continue;
		if (entry.customType === STATE_TYPE) {
			const restored = asState(entry.data);
			if (restored) {
				state = restored;
				return { restored: true, migrated: false };
			}
		}
		if (entry.customType === LEGACY_STATE_TYPE) {
			const legacy = entry.data as Partial<PixState> | undefined;
			// v1 数据的 mode 实际取值是 "strict"/"aggressive"，类型上按 string 读
			const legacyMode = (legacy as { mode?: string } | undefined)?.mode;
			const restored = asState(legacy);
			if (restored) {
				// v1 → v2 模式映射
				if (legacyMode === "strict" || legacyMode === "aggressive") {
					restored.mode = legacyMode === "strict" ? "pent" : "redt";
					restored.baseIntervalMs = BASE_INTERVAL_MS[restored.mode];
				}
				state = restored;
				migrated = true;
				// 立即以新格式补写一条，后续读回走新类型
				persist(pi);
				return { restored: true, migrated };
			}
		}
	}
	return { restored: false, migrated: false };
}

/** 宽松反序列化：只挑认识的字段，类型不对就回退默认（防旧数据/手改坏档） */
function asState(data: unknown): PixState | undefined {
	if (!data || typeof data !== "object") return undefined;
	const d = data as Partial<PixState>;
	const mode: Mode = d.mode === "redt" ? "redt" : "pent";
	const restored: PixState = {
		mode,
		adaptive: d.adaptive !== false,
		baseIntervalMs:
			typeof d.baseIntervalMs === "number" && d.baseIntervalMs > 0 ? d.baseIntervalMs : BASE_INTERVAL_MS[mode],
		recentResults: Array.isArray(d.recentResults) ? d.recentResults.filter((r) => typeof r === "boolean") : [],
		nodes: Array.isArray(d.nodes) ? d.nodes : [],
		edges: Array.isArray(d.edges) ? d.edges : [],
		failureCounts: d.failureCounts && typeof d.failureCounts === "object" ? d.failureCounts : {},
		sessionStartedAt: Date.now(), // 恢复后由 session_start 钩子重设计时
	};
	if (d.auth && Array.isArray(d.auth.targets)) restored.auth = d.auth;
	if (d.task && typeof d.task.content === "string") restored.task = d.task;
	if (d.boardOverlay && Array.isArray(d.boardOverlay.notes)) restored.boardOverlay = d.boardOverlay;
	if (typeof d.boardEditWatermark === "number" && d.boardEditWatermark > 0) restored.boardEditWatermark = d.boardEditWatermark;
	return restored;
}

// ---------------------------------------------------------------------------
// 图谱工具函数
// ---------------------------------------------------------------------------

const NODE_PREFIX: Record<NodeType, string> = {
	capability: "C",
	failure: "F",
	hypothesis: "H",
	finding: "N",
};

/** 下一个自增 id（C1→C2…，跳号不回收） */
export function nextId(type: NodeType): string {
	const prefix = NODE_PREFIX[type];
	let max = 0;
	for (const n of state.nodes) {
		if (n.id.startsWith(prefix)) {
			const num = Number.parseInt(n.id.slice(prefix.length), 10);
			if (Number.isInteger(num) && num > max) max = num;
		}
	}
	return `${prefix}${max + 1}`;
}

/** 失败计数 +1 并返回新值（方向数超 24 时修剪最低频项，防长会话膨胀） */
export function bumpFailure(direction: string): number {
	const count = (state.failureCounts[direction] ?? 0) + 1;
	state.failureCounts[direction] = count;
	const keys = Object.keys(state.failureCounts);
	if (keys.length > 24) {
		let minKey = keys[0];
		for (const k of keys) {
			if (state.failureCounts[k] < state.failureCounts[minKey]) minKey = k;
		}
		if (minKey !== direction) delete state.failureCounts[minKey];
	}
	return count;
}

/** 达到回读阈值的方向（稳定顺序：按插入序） */
export function stuckDirections(): Array<{ direction: string; count: number }> {
	return Object.entries(state.failureCounts)
		.filter(([, count]) => count >= FAILURE_THRESHOLD)
		.map(([direction, count]) => ({ direction, count }));
}

/**
 * 画板节点状态流转（update_node 工具入口）。
 * hypothesis → confirmed：与状态机联动计一次成功（进节奏窗口）；
 * rejected：证伪也是有效信息增益，不进失败窗口。
 * 返回更新后的节点；id 不存在返回 undefined。
 */
export function updateNodeStatus(
	id: string,
	status: NodeStatus,
	note?: string,
): Node | undefined {
	const node = state.nodes.find((n) => n.id === id);
	if (!node) return undefined;
	node.status = status;
	if (note) node.detail = `${node.detail ? node.detail + "\n" : ""}[${status}] ${note}`;
	if (node.type === "hypothesis" && status === "confirmed") pushResult(true);
	// 发现坐实是最强成功信号，同样计入节奏窗口
	if (node.type === "finding" && status === "confirmed") pushResult(true);
	return node;
}

/** 画板摘要（注入 section 用）：计数 + 高置信假设标题 + 待证关系 */export function boardSummary(): string {
	const byType = { capability: 0, finding: 0, failure: 0, hypothesis: 0 };
	for (const n of state.nodes) byType[n.type] += 1;
	const parts = [
		`能力 ${byType.capability} · 发现 ${byType.finding} · 假设 ${byType.hypothesis} · 失败 ${byType.failure} · 关系 ${state.edges.length} 条`,
	];
	const openHypotheses = state.nodes
		.filter((n) => n.type === "hypothesis" && (!n.status || n.status === "open"))
		.slice(0, 3);
	if (openHypotheses.length > 0) {
		parts.push("活跃假设：" + openHypotheses.map((n) => `${n.id} ${n.label}`).join("；"));
	}
	const leads = state.edges.filter((e) => e.relation === "leads_to").length;
	if (leads > 0) parts.push(`攻击链线索（leads_to）${leads} 条`);
	return parts.join("\n");
}

// ---------------------------------------------------------------------------
// 画板编辑消费（v3）：磁盘会话文件里的 pix-board-edit → 内存 state + section 提示
// ---------------------------------------------------------------------------

/** 最近一批未提示给 agent 的画板编辑摘要行（rules.ts buildSection 读） */
let lastEditLines: string[] = [];

export function boardEditLines(): string[] {
	return lastEditLines;
}

/** 历史画板摘要行（session_start 读回 cwd 存档后注入 section；rules.ts buildSection 读） */
let historyLines: string[] = [];

export function setHistoryLines(lines: string[]): void {
	historyLines = lines;
}

export function historyLinesOf(): string[] {
	return historyLines;
}

/** 会话切换时重置 section 注入行——防历史画板摘要/画板编辑提示泄漏到下一会话（index.ts session_start 调用） */
export function resetSectionLines(): void {
	historyLines = [];
	lastEditLines = [];
}

function applyBoardEdit(edit: BoardEditOp, summary: string[]): void {
	if (!state.boardOverlay) state.boardOverlay = emptyOverlay();
	const ov = state.boardOverlay;
	switch (edit.op) {
		case "note.add":
			if (!ov.notes.some((n) => n.id === edit.id)) {
				ov.notes.push({ id: edit.id, x: edit.x, y: edit.y, w: edit.w, h: edit.h, text: edit.text });
				if (edit.text.trim()) summary.push(`便签：「${edit.text.slice(0, 120)}」`);
			}
			return;
		case "note.edit": {
			const n = ov.notes.find((x) => x.id === edit.id);
			if (n && n.text !== edit.text) {
				n.text = edit.text;
				summary.push(`便签改为：「${edit.text.slice(0, 120)}」`);
			}
			return;
		}
		case "note.move": {
			const n = ov.notes.find((x) => x.id === edit.id);
			if (n) {
				n.x = edit.x;
				n.y = edit.y;
			}
			return;
		}
		case "note.del":
			ov.notes = ov.notes.filter((x) => x.id !== edit.id);
			return;
		case "stroke.add":
			if (!ov.strokes.some((s) => s.id === edit.id) && Array.isArray(edit.points)) {
				ov.strokes.push({ id: edit.id, points: edit.points, color: edit.color });
			}
			return;
		case "stroke.del":
			ov.strokes = ov.strokes.filter((x) => x.id !== edit.id);
			return;
		case "node.move":
			ov.offsets[edit.target] = { dx: edit.dx, dy: edit.dy };
			return;
		case "node.status": {
			const node = state.nodes.find((n) => n.id === edit.target);
			if (node && node.status !== edit.status) {
				node.status = edit.status;
				node.detail = `${node.detail ? node.detail + "\n" : ""}[user] 画板标记为 ${edit.status}`;
				summary.push(`${node.id}（${node.label.slice(0, 40)}）→ ${edit.status === "confirmed" ? "✓ 确认" : edit.status === "rejected" ? "✗ 否证" : edit.status}（用户在画板标记）`);
			}
			return;
		}
		case "edge.user":
			if (edit.from !== edit.to && !ov.userEdges.some((e) => e.from === edit.from && e.to === edit.to)) {
				ov.userEdges.push({ from: edit.from, to: edit.to });
				summary.push(`用户连线：${edit.from} → ${edit.to}`);
			}
			return;
		case "edge.user.del":
			ov.userEdges = ov.userEdges.filter((e) => !(e.from === edit.from && e.to === edit.to));
			return;
		case "overlay.sync":
			// undo/批量同步：整体替换（便签文字仍要提示）
			for (const n of edit.overlay.notes ?? []) {
				if (n.text?.trim()) summary.push(`便签：「${String(n.text).slice(0, 120)}」`);
			}
			state.boardOverlay = edit.overlay;
			return;
	}
}

/**
 * 消费磁盘会话文件里 ts > 水位线的 pix-board-edit 条目（幂等：水位线持久化在 state）。
 * @returns 应用到内存的编辑条数；summary 行写入 boardEditLines() 供 section 注入。
 */
export function mergeBoardEdits(pi: ExtensionAPI, sessionFile: string): number {
	let raw: string;
	try {
		raw = readFileSync(sessionFile, "utf8");
	} catch {
		return 0;
	}
	const watermark = state.boardEditWatermark ?? 0;
	const summary: string[] = [];
	let maxTs = watermark;
	let applied = 0;
	for (const line of raw.split("\n")) {
		if (!line.includes(BOARD_EDIT_TYPE)) continue;
		let entry: { type?: string; customType?: string; data?: { ts?: number; edits?: BoardEditOp[] } };
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry?.type !== "custom" || entry.customType !== BOARD_EDIT_TYPE || !Array.isArray(entry.data?.edits)) continue;
		const ts = typeof entry.data!.ts === "number" ? entry.data!.ts : 0;
		if (ts <= watermark) continue;
		maxTs = Math.max(maxTs, ts);
		for (const edit of entry.data!.edits) applyBoardEdit(edit, summary);
		applied += entry.data!.edits.length;
	}
	if (maxTs > watermark) {
		state.boardEditWatermark = maxTs;
		persist(pi);
	}
	if (summary.length > 0) lastEditLines = summary.slice(0, 10);
	return applied;
}
