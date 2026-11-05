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
/** 旧版（pentest-state）的 customType，仅用于旧会话读回迁移 */
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
	/** 原始可复现 HTTP 请求包（Raw HTTP Request） */
	evidenceRequest?: string;
	/** 关键响应差分切片（Raw HTTP Response Snippet） */
	evidenceResponse?: string;
	/** 数据泄露/受影响总量计数（如 COUNT(*) 统计值） */
	affectedCount?: number;
	/** 脱敏最小数据样本证明（3~5 行真实样本） */
	sampleProof?: string;
	createdAt: string;
}

export interface Edge {
	from: string;
	to: string;
	relation: Relation;
}

// ---------------------------------------------------------------------------
// 四维超图模型 (4D Hypergraph: Host / PivotSession / Credential / Fact)
// 覆盖：外网攻击面测绘 -> 边界打点破门 -> 跳板建立 -> 内网横向与域攻坚
// ---------------------------------------------------------------------------

export type NetworkScope = "external" | "dmz" | "internal";

export interface HostService {
	port: number;
	protocol: string;
	banner?: string;
	vulns?: string[];
}

export interface HostNode {
	id: string;
	ips: string[];
	hostname?: string;
	os?: string;
	domain?: string;
	/** 网络区域：external=外网暴露资产 / dmz=边界双网卡跳板 / internal=内网核心资产 */
	networkScope?: NetworkScope;
	isDC?: boolean;
	/** 是否已攻破拿到初始立足点/执行权限 (PWNED) */
	isCompromised?: boolean;
	/** 边界突破/攻陷途径：如 "Shiro反序列化", "文件上传WebShell", "Tongda OA RCE", "SQL注入获取密码" */
	compromiseVector?: string;
	services: HostService[];
	discoveredAt: string;
}

export interface PivotSessionNode {
	id: string;
	sourceHostId: string;
	tunnelType: "socks5" | "ssh_tun" | "cmd_pipe" | "webshell" | "frp";
	localListenPort: number;
	egressSubnets: string[];
	status: "active" | "dead";
	createdAt: string;
}

export interface CredentialNode {
	id: string;
	account: string;
	domain?: string;
	type: "plaintext" | "ntlm_hash" | "kerberos_ticket" | "ssh_key" | "api_key";
	value: string;
	originHostId: string;
	privilegeScope: "local_admin" | "domain_admin" | "domain_user" | "guest";
	validTargets: string[];
	createdAt: string;
}

// ---------------------------------------------------------------------------
// 端点接口资产台账模型 (Endpoint Ledger: Web/API 资产闭环与状态机)
// 七态流转：discovered -> probing -> bypassing -> escalating -> confirmed / rejected / blocked
// ---------------------------------------------------------------------------

export type EndpointStatus =
	| "discovered"  // 已提取入账待测
	| "probing"     // 探针特征探测中
	| "bypassing"   // 遭遇阻断多维变异中
	| "escalating"  // 突破边界纵深利用中
	| "confirmed"   // 捕获最小实证坐实漏洞
	| "rejected"    // L4充分证伪排除
	| "blocked";    // 不可抗力/硬性失联留痕

export interface TestRecord {
	timestamp: string;
	action: string;
	status: EndpointStatus;
	requestSnippet?: string;
	responseSnippet?: string;
	diffCharacteristic?: string;
	escalationLevel?: number;
}

export interface EndpointNode {
	id: string;
	url: string;
	method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
	params?: string[];
	authRequired?: boolean;
	status: EndpointStatus;
	vulnerabilities?: string[];
	discoveredFrom?: string;
	testedTimes: number;
	lastTestedAt?: string;
	evidenceRequest?: string;      // 原始复现 HTTP 请求包 (Raw HTTP Request)
	evidenceResponse?: string;     // 关键差分响应片段 (Response Snippet)
	diffSignature?: string;        // 差分特征标识 (如 Status/Length/Keyword Diff)
	failureStreak: number;         // 连续失败计数器
	escalationLevel: number;       // 当前变异深度 (0-4)
	testHistory: TestRecord[];     // 测试履历全生命周期追踪
}

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
		hosts: HostNode[];
		sessions: PivotSessionNode[];
		credentials: CredentialNode[];
		endpoints: EndpointNode[];
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
			hosts: [],
			sessions: [],
			credentials: [],
			endpoints: [],
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
	try {
		const cwd = process.cwd();
		const file = join(cwd, "pix-state.json");
		const tmp = join(cwd, `pix-state.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`);
		writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), state }, null, 2), "utf8");
		renameSync(tmp, file);
	} catch {
		// cwd 存档容错
	}
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
		hosts: Array.isArray(d.hosts) ? d.hosts : [],
		sessions: Array.isArray(d.sessions) ? d.sessions : [],
		credentials: Array.isArray(d.credentials) ? d.credentials : [],
		endpoints: Array.isArray(d.endpoints)
			? d.endpoints.map((e) => ({
					...e,
					failureStreak: typeof e.failureStreak === "number" ? e.failureStreak : 0,
					escalationLevel: typeof e.escalationLevel === "number" ? e.escalationLevel : 0,
					testHistory: Array.isArray(e.testHistory) ? e.testHistory : [],
				}))
			: [],
	};
		if (d.auth && Array.isArray(d.auth.targets)) restored.auth = d.auth;
		if (d.task && typeof d.task.content === "string") restored.task = d.task;
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
		if (state.hosts && state.hosts.length > 0) {
			const ext = state.hosts.filter((h) => h.networkScope === "external").length;
			const dmz = state.hosts.filter((h) => h.networkScope === "dmz").length;
			const intra = state.hosts.filter((h) => h.networkScope === "internal").length;
			const pwned = state.hosts.filter((h) => h.isCompromised).length;
			parts.push(`【4D超图】攻防资产 ${state.hosts.length} 台 (外网 ${ext} / DMZ ${dmz} / 内网 ${intra} · 攻破 ${pwned})`);
		}
	if (state.sessions && state.sessions.length > 0) {
		const active = state.sessions.filter((s) => s.status === "active").length;
		parts.push(`【4D超图】活动跳板/隧道 ${active} 条`);
	}
	if (state.credentials && state.credentials.length > 0) {
		parts.push(`【4D超图】凭据金库 ${state.credentials.length} 项`);
	}
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
/** 历史画板摘要行（session_start 读回 cwd 存档后注入 section；rules.ts buildSection 读） */
let historyLines: string[] = [];

export function setHistoryLines(lines: string[]): void {
	historyLines = lines;
}

export function historyLinesOf(): string[] {
	return historyLines;
}

/** 会话切换时重置 section 注入行（防历史画板摘要泄漏到下一会话） */
export function resetSectionLines(): void {
	historyLines = [];
}

// ---------------------------------------------------------------------------
// 4D 超图业务操作函数
// ---------------------------------------------------------------------------

export function getAllHosts(): HostNode[] {
	return state.hosts;
}

export function getAllSessions(): PivotSessionNode[] {
	return state.sessions;
}

export function getAllCredentials(): CredentialNode[] {
	return state.credentials;
}

export function recordHost(host: {
	id?: string;
	ips: string[];
	hostname?: string;
	os?: string;
	domain?: string;
	networkScope?: NetworkScope;
	isDC?: boolean;
	isCompromised?: boolean;
	compromiseVector?: string;
	services?: HostService[];
}): HostNode {
	const ip = host.ips[0] || "unknown";
	const id = host.id || `host_${ip.replace(/[^a-zA-Z0-9]/g, "_")}`;
	const existing = state.hosts.find((h) => h.id === id);
	const node: HostNode = {
		id,
		ips: host.ips,
		hostname: host.hostname,
		os: host.os,
		domain: host.domain,
		networkScope: host.networkScope || "external",
		isDC: host.isDC ?? false,
		isCompromised: host.isCompromised ?? false,
		compromiseVector: host.compromiseVector,
		services: host.services || [],
		discoveredAt: existing ? existing.discoveredAt : new Date().toISOString(),
	};
	if (existing) {
		if (host.services && host.services.length > 0) {
			const svcMap = new Map<number, HostService>();
			for (const s of existing.services) svcMap.set(s.port, s);
			for (const s of host.services) svcMap.set(s.port, { ...svcMap.get(s.port), ...s });
			node.services = Array.from(svcMap.values()).sort((a, b) => a.port - b.port);
		} else {
			node.services = existing.services;
		}
		node.isCompromised = existing.isCompromised || node.isCompromised;
		node.isDC = existing.isDC || node.isDC;
		node.os = host.os || existing.os;
		node.hostname = host.hostname || existing.hostname;
		node.domain = host.domain || existing.domain;
		node.networkScope = host.networkScope || existing.networkScope || "external";
		node.compromiseVector = host.compromiseVector || existing.compromiseVector;
		Object.assign(existing, node);
	} else {
		state.hosts.push(node);
	}
	// 自动生成画板展示节点
	const existingGraphNode = state.nodes.find((n) => n.id === id);
	const scopeTag = node.networkScope === "external" ? "[外网边界]" : node.networkScope === "dmz" ? "[DMZ双网卡]" : "[内网核心]";
	const label = `${scopeTag} [${host.ips.join("/")}] ${host.hostname ? `(${host.hostname})` : ""} ${node.isCompromised ? "⚡PWNED" : ""}`;
	const tags = [
		"host",
		node.networkScope || "external",
		...(node.isDC ? ["DC"] : []),
		...(node.isCompromised ? ["compromised"] : []),
	];
	const detail = `区域: ${node.networkScope || "未知"} | 破门途径: ${node.compromiseVector || "未登记"} | OS: ${node.os || "unknown"} | 域: ${node.domain || "WORKGROUP"} | 服务: ${node.services.map((s) => s.port + "/" + s.protocol).join(", ") || "未探明"}`;
	if (existingGraphNode) {
		existingGraphNode.label = label;
		existingGraphNode.tags = tags;
		existingGraphNode.detail = detail;
		if (node.isCompromised) existingGraphNode.status = "confirmed";
	} else {
		state.nodes.push({
			id,
			type: "finding",
			label,
			tags,
			detail,
			status: node.isCompromised ? "confirmed" : "open",
			createdAt: new Date().toISOString(),
		});
	}
	return node;
}

export function recordPivotSession(sess: {
	id?: string;
	sourceHostId: string;
	tunnelType: "socks5" | "ssh_tun" | "cmd_pipe" | "webshell" | "frp";
	localListenPort: number;
	egressSubnets: string[];
	status?: "active" | "dead";
}): PivotSessionNode {
	const id = sess.id || `pivot_${sess.tunnelType}_${sess.localListenPort}`;
	const existing = state.sessions.find((s) => s.id === id);
	const node: PivotSessionNode = {
		id,
		sourceHostId: sess.sourceHostId,
		tunnelType: sess.tunnelType,
		localListenPort: sess.localListenPort,
		egressSubnets: sess.egressSubnets,
		status: sess.status || "active",
		createdAt: existing ? existing.createdAt : new Date().toISOString(),
	};
	if (existing) {
		Object.assign(existing, node);
	} else {
		state.sessions.push(node);
	}
	const label = `跳板 [${sess.tunnelType}] :${sess.localListenPort} -> ${sess.egressSubnets.join(",")}`;
	const existingGraphNode = state.nodes.find((n) => n.id === id);
	if (!existingGraphNode) {
		state.nodes.push({
			id,
			type: "capability",
			label,
			tags: ["pivot", sess.tunnelType, node.status],
			detail: `出口网段: ${sess.egressSubnets.join(", ")} | 绑定端口: ${sess.localListenPort}`,
			createdAt: new Date().toISOString(),
		});
		if (sess.sourceHostId && state.nodes.some((n) => n.id === sess.sourceHostId)) {
			state.edges.push({ from: sess.sourceHostId, to: id, relation: "leads_to" });
		}
	}
	return node;
}

export function recordCredential(cred: {
	id?: string;
	account: string;
	domain?: string;
	type: "plaintext" | "ntlm_hash" | "kerberos_ticket" | "ssh_key" | "api_key";
	value: string;
	originHostId: string;
	privilegeScope?: "local_admin" | "domain_admin" | "domain_user" | "guest";
	validTargets?: string[];
}): CredentialNode {
	const id = cred.id || `cred_${cred.type}_${cred.account}_${Date.now().toString(36).slice(-4)}`;
	const existing = state.credentials.find((c) => c.id === id);
	const node: CredentialNode = {
		id,
		account: cred.account,
		domain: cred.domain,
		type: cred.type,
		value: cred.value,
		originHostId: cred.originHostId,
		privilegeScope: cred.privilegeScope || "domain_user",
		validTargets: cred.validTargets || [],
		createdAt: existing ? existing.createdAt : new Date().toISOString(),
	};
	if (existing) {
		if (cred.validTargets && cred.validTargets.length > 0) {
			const set = new Set([...existing.validTargets, ...cred.validTargets]);
			node.validTargets = Array.from(set);
		} else {
			node.validTargets = existing.validTargets;
		}
		node.privilegeScope = cred.privilegeScope || existing.privilegeScope;
		Object.assign(existing, node);
	} else {
		state.credentials.push(node);
	}
	const label = `凭据 [${cred.type}] ${cred.domain ? cred.domain + "\\" : ""}${cred.account} (${node.privilegeScope})`;
	const existingGraphNode = state.nodes.find((n) => n.id === id);
	if (!existingGraphNode) {
		state.nodes.push({
			id,
			type: "finding",
			label,
			tags: ["credential", cred.type, node.privilegeScope],
			detail: `来源: ${cred.originHostId} | 值: ${cred.value.slice(0, 4)}***`,
			createdAt: new Date().toISOString(),
		});
		if (cred.originHostId && state.nodes.some((n) => n.id === cred.originHostId)) {
			state.edges.push({ from: cred.originHostId, to: id, relation: "leads_to" });
		}
	}
	return node;
}

export function findRouteForIp(ip: string): PivotSessionNode | null {
	for (const s of state.sessions) {
		if (s.status !== "active") continue;
		for (const subnet of s.egressSubnets) {
			if (matchSubnet(ip, subnet)) return s;
		}
	}
	return null;
}

function matchSubnet(ip: string, subnet: string): boolean {
	if (subnet === "0.0.0.0/0" || subnet === "*") return true;
	if (ip === subnet) return true;
	const parts = subnet.split("/");
	if (parts.length === 1) {
		return parts[0].endsWith(".") ? ip.startsWith(parts[0]) : ip === parts[0];
	}
	const [subIp, bitsStr] = parts;
	const bits = Number.parseInt(bitsStr, 10);
	if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
	const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
	const ipNum = ipToInt(ip);
	const subNum = ipToInt(subIp);
	return (ipNum & mask) === (subNum & mask);
}

function ipToInt(ip: string): number {
	const octets = ip.split(".").map((o) => Number.parseInt(o, 10));
	if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return 0;
	return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

// ---------------------------------------------------------------------------
// 端点接口资产台账操作函数
// ---------------------------------------------------------------------------

export function recordEndpoint(params: {
	url: string;
	method?: string;
	params?: string[];
	authRequired?: boolean;
	status?: EndpointStatus;
	discoveredFrom?: string;
}): EndpointNode {
	state.endpoints ??= [];
	const method = (params.method || "GET").toUpperCase() as EndpointNode["method"];
	const cleanUrl = params.url.trim();
	const existing = state.endpoints.find((e) => e.url === cleanUrl && e.method === method);

	if (existing) {
		if (params.params && params.params.length > 0) {
			const set = new Set([...(existing.params || []), ...params.params]);
			existing.params = Array.from(set);
		}
		if (params.status) existing.status = params.status;
		if (params.authRequired !== undefined) existing.authRequired = params.authRequired;
		return existing;
	}

		const id = `ep_${state.endpoints.length + 1}`;
		const node: EndpointNode = {
			id,
			url: cleanUrl,
			method,
			params: params.params,
			authRequired: params.authRequired,
			status: params.status || "discovered",
			discoveredFrom: params.discoveredFrom,
			testedTimes: 0,
			failureStreak: 0,
			escalationLevel: 0,
			testHistory: [],
		};
		state.endpoints.push(node);
		return node;
	}

	export interface UpdateEndpointOptions {
		vuln?: string;
		evidenceRequest?: string;
		evidenceResponse?: string;
		diffSignature?: string;
		action?: string;
		escalationLevel?: number;
		detail?: string;
	}

	export function updateEndpointStatus(
		idOrUrl: string,
		status: EndpointStatus,
		options?: string | UpdateEndpointOptions,
	): EndpointNode | null {
		state.endpoints ??= [];
		const ep = state.endpoints.find((e) => e.id === idOrUrl || e.url === idOrUrl);
		if (!ep) return null;

		const opts: UpdateEndpointOptions = typeof options === "string" ? { vuln: options } : options || {};
		ep.status = status;
		ep.testedTimes = (ep.testedTimes || 0) + 1;
		ep.lastTestedAt = new Date().toISOString();

		if (opts.vuln) {
			ep.vulnerabilities ??= [];
			if (!ep.vulnerabilities.includes(opts.vuln)) ep.vulnerabilities.push(opts.vuln);
		}
		if (opts.evidenceRequest) ep.evidenceRequest = opts.evidenceRequest;
		if (opts.evidenceResponse) ep.evidenceResponse = opts.evidenceResponse;
		if (opts.diffSignature) ep.diffSignature = opts.diffSignature;

		if (status === "confirmed") {
			ep.failureStreak = 0;
		} else if (status === "bypassing" || status === "probing") {
			ep.failureStreak = (ep.failureStreak || 0) + 1;
			if (opts.escalationLevel !== undefined) {
				ep.escalationLevel = opts.escalationLevel;
			} else if (status === "bypassing") {
				ep.escalationLevel = Math.min(4, (ep.escalationLevel || 0) + 1);
			}
		}

		ep.testHistory ??= [];
		ep.testHistory.push({
			timestamp: ep.lastTestedAt,
			action: opts.action || `跃迁至 ${status}`,
			status,
			requestSnippet: opts.evidenceRequest ? opts.evidenceRequest.slice(0, 300) : undefined,
			responseSnippet: opts.evidenceResponse ? opts.evidenceResponse.slice(0, 300) : undefined,
			diffCharacteristic: opts.diffSignature || opts.vuln,
			escalationLevel: ep.escalationLevel,
		});

		return ep;
	}

	export function isResolvedStatus(status: EndpointStatus): boolean {
		return status === "confirmed" || status === "rejected" || status === "blocked";
	}

	export function getAllEndpoints(): EndpointNode[] {
		state.endpoints ??= [];
		return state.endpoints;
	}

	export function getUnresolvedEndpoints(limit = 8): EndpointNode[] {
		state.endpoints ??= [];
		return state.endpoints
			.filter((e) => !isResolvedStatus(e.status))
			.slice(0, limit);
	}

	const STATUS_PRIORITY: Record<EndpointStatus, number> = {
		escalating: 1,
		bypassing: 2,
		probing: 3,
		discovered: 4,
		confirmed: 5,
		rejected: 6,
		blocked: 7,
	};

	export function getPendingEndpointsQueue(limit = 8): EndpointNode[] {
		state.endpoints ??= [];
		return state.endpoints
			.filter((e) => !isResolvedStatus(e.status))
			.sort((a, b) => (STATUS_PRIORITY[a.status] || 99) - (STATUS_PRIORITY[b.status] || 99))
			.slice(0, limit);
	}

	export interface MatrixMetrics {
		totalEndpoints: number;
		closedEndpoints: number;
		closedPercentage: number;
		confirmedCount: number;
		rejectedCount: number;
		blockedCount: number;
		escalatingCount: number;
		bypassingCount: number;
		probingCount: number;
		discoveredCount: number;
	}

	export function getMatrixMetrics(): MatrixMetrics {
		state.endpoints ??= [];
		const total = state.endpoints.length;
		const confirmed = state.endpoints.filter((e) => e.status === "confirmed").length;
		const rejected = state.endpoints.filter((e) => e.status === "rejected").length;
		const blocked = state.endpoints.filter((e) => e.status === "blocked").length;
		const escalating = state.endpoints.filter((e) => e.status === "escalating").length;
		const bypassing = state.endpoints.filter((e) => e.status === "bypassing").length;
		const probing = state.endpoints.filter((e) => e.status === "probing").length;
		const discovered = state.endpoints.filter((e) => e.status === "discovered").length;
		const closed = confirmed + rejected + blocked;
		const closedPercentage = total > 0 ? Number.parseFloat(((closed / total) * 100).toFixed(1)) : 0;

		return {
			totalEndpoints: total,
			closedEndpoints: closed,
			closedPercentage,
			confirmedCount: confirmed,
			rejectedCount: rejected,
			blockedCount: blocked,
			escalatingCount: escalating,
			bypassingCount: bypassing,
			probingCount: probing,
			discoveredCount: discovered,
		};
	}
