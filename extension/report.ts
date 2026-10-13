/**
 * report.ts — /report 渗透报告生成
 *
 * 管线（快照 → 渲染 → 导出三段）：
 *   1. 快照：生成瞬间冻结 state（appendEntry 只读视图）
 *   2. 渲染：对齐用户 vuln-report-format 的精简版——目标/授权/执行摘要/
 *      逐项漏洞（前置/复现/证据/影响/状态机参与线）/攻击链配图（Mermaid，
 *      数据来自画板 leads_to 边与漏洞相关子图）/失败史附录
 *   3. 导出：pix-report-<时间戳>.md 落盘（pi-web 直接渲染）
 */

import { getState, type Node, type Edge } from "./state.ts";
import { mirroredNodeIds } from "./mirror.ts";

interface ReportSnapshot {
	generatedAt: string;
	mode: string;
	auth?: { targets: string[]; source: string };
	task?: { title: string };
	nodes: Node[];
	edges: Edge[];
	failureCounts: Record<string, number>;
}

const clean = (t: string) => t.replace(/[|`]/g, "/").replace(/\s*\n+\s*/g, " ").trim();

/** 漏洞相关子图：finding 节点 + 沿边可达的相邻节点（1~2 跳） */
function subgraphFor(finding: Node, snap: ReportSnapshot): { nodes: Node[]; edges: Edge[] } {
	const related = new Set<string>([finding.id]);
	// 第一跳：直接相连
	for (const e of snap.edges) {
		if (e.from === finding.id) related.add(e.to);
		if (e.to === finding.id) related.add(e.from);
	}
	// 第二跳：相邻 hypothesis/capability 的其他连线（还原推理路径）
	for (const e of snap.edges) {
		if (related.has(e.from) && snap.nodes.some((n) => n.id === e.to && (n.type === "hypothesis" || n.type === "capability"))) related.add(e.to);
		if (related.has(e.to) && snap.nodes.some((n) => n.id === e.from && (n.type === "hypothesis" || n.type === "capability"))) related.add(e.from);
	}
	const nodes = snap.nodes.filter((n) => related.has(n.id));
	const edges = snap.edges.filter((e) => related.has(e.from) && related.has(e.to));
	return { nodes, edges };
}

function renderSubgraph(finding: Node, snap: ReportSnapshot): string {
	const { nodes, edges } = subgraphFor(finding, snap);
	if (nodes.length <= 1 && edges.length === 0) return "";
	const alias = new Map<string, string>();
	nodes.forEach((n, i) => alias.set(n.id, `s${i}`));
	const lines = ["flowchart LR"];
	for (const n of nodes) {
		const mark = n.status === "confirmed" ? "✓" : n.status === "rejected" ? "✗" : "";
		lines.push(`    ${alias.get(n.id)}["${n.id}${mark} ${clean(n.label).slice(0, 40)}"]`);
	}
	for (const e of edges) {
		const arrow = e.relation === "leads_to" ? "==>" : e.relation === "substitutes" ? "-.->" : "-->";
		lines.push(`    ${alias.get(e.from)} ${arrow}|${e.relation}| ${alias.get(e.to)}`);
	}
	return lines.join("\n");
}

/** 状态机参与线：finding 的推理来源叙述（hypothesis → 变异/位置变换 → 命中）。
 *  只叙该 finding 子图连通的 failure 节点，不全局复读失败史（全局见附录 A）。 */
function machineLine(finding: Node, snap: ReportSnapshot): string {
	const related = new Set<string>([finding.id]);
	for (const e of snap.edges) {
		if (e.from === finding.id) related.add(e.to);
		if (e.to === finding.id) related.add(e.from);
	}
	const incoming = snap.edges.filter((e) => e.to === finding.id);
	const sources = incoming
		.map((e) => {
			const src = snap.nodes.find((n) => n.id === e.from);
			return src ? `${src.type} ${src.id}「${clean(src.label)}」经 ${e.relation} 边` : null;
		})
		.filter(Boolean);
	if (sources.length === 0) return "直接发现（无前置假设边）——补 record_fact 连边可让攻击链叙述完整。";
	const stuck = snap.nodes.filter(
		(n) => n.type === "failure" && related.has(n.id) && (snap.failureCounts[n.label] ?? 0) >= 1,
	);
	const stuckNote =
		stuck.length > 0
			? `；本链路关联失败方向 ${stuck.map((n) => `「${clean(n.label)}」`).join("、")}，经变异/位置变换后命中`
			: "";
	return `推理路径：${sources.join("；")}${stuckNote}。`;
}

export function renderReport(): string {
	const state = getState();
	const snap: ReportSnapshot = {
		generatedAt: new Date().toLocaleString(),
		mode: state.mode,
		auth: state.auth ? { targets: state.auth.targets, source: state.auth.source } : undefined,
		task: state.task ? { title: state.task.title } : undefined,
		nodes: state.nodes,
		edges: state.edges,
		failureCounts: state.failureCounts,
	};
	const findings = snap.nodes.filter((n) => n.type === "finding");
	const confirmedFindings = findings.filter((n) => n.status === "confirmed");
	const confirmedCaps = snap.nodes.filter((n) => n.type === "capability").length;
	const hypotheses = snap.nodes.filter((n) => n.type === "hypothesis");
	const confirmedHyps = hypotheses.filter((n) => n.status === "confirmed");
	// 落库核对（WP-B3）：confirmed finding 中未经 pentrack 落库（镜像观测）的差集
	const mirrored = mirroredNodeIds();
	const notInLedger = confirmedFindings.filter((n) => !mirrored.has(n.id));
	// 证据闸门：confirmed finding 必须有 detail/evidence——缺失列清单并标注部分完整性，不静默当完整报告
	const missingEvidence = confirmedFindings.filter((n) => !n.detail || !n.detail.trim());

	const L: string[] = [];
	L.push(`# PiX 渗透测试报告`);
	L.push("");
	L.push(`- 生成时间：${snap.generatedAt}（快照冻结，生成后画板变更不回写本报告）`);
	L.push(`- 作业模式：${snap.mode}${snap.task ? ` · 任务书：${snap.task.title}` : ""}`);
	L.push(`- 授权范围：${snap.auth ? `${snap.auth.targets.join("、")}（${snap.auth.source}）` : "未登记（/auth）"}`);
	L.push(
		`- 证据完整性：${
			missingEvidence.length === 0
				? "完整 ✓"
				: `**部分缺失**——${missingEvidence.length} 项坐实发现缺证据（${missingEvidence.map((n) => n.id).join("、")}，见附录C），该项结论按待验证口径对待`
		}`,
	);
	L.push("");
	L.push("## 一、执行摘要");
	L.push("");
	L.push(
		`本会话确认能力 ${confirmedCaps} 项，发现 ${findings.length} 项（坐实 ${confirmedFindings.length} 项待复测 ${findings.length - confirmedFindings.length} 项），` +
			`假设 ${hypotheses.length} 条（证实 ${confirmedHyps.length} / 证伪 ${hypotheses.filter((h) => h.status === "rejected").length} / 进行中 ${hypotheses.filter((h) => !h.status || h.status === "open").length}），` +
			`失败方向 ${Object.keys(snap.failureCounts).length} 个。`,
	);
	L.push("");
	L.push("## 二、全局攻击面（思维导图）");
	L.push("");
	L.push("```mermaid");
	L.push("mindmap 数据见 /pix export（报告内嵌全局图在节点 >40 时省略，避免渲染卡顿）");
	if (snap.nodes.length <= 40) {
		L.pop();
		L.push("mindmap");
		L.push("  root((画板))");
		const byType: Record<string, Node[]> = {};
		for (const n of snap.nodes) (byType[n.type] ??= []).push(n);
		const zh: Record<string, string> = { capability: "能力", finding: "发现", hypothesis: "假设", failure: "失败" };
		for (const [t, list] of Object.entries(byType)) {
			L.push(`  ${zh[t]}`);
			for (const n of list.slice(0, 10)) {
				const mark = n.status === "confirmed" ? "✓" : n.status === "rejected" ? "✗" : "";
				L.push(`    ${n.id} ${mark}${clean(n.label).slice(0, 30)}`);
			}
			if (list.length > 10) L.push(`    …共 ${list.length} 项`);
		}
	}
	L.push("```");
	L.push("");

	if (findings.length === 0) {
		L.push("## 三、漏洞清单");
		L.push("");
		L.push("本会话无 finding 记录。用 record_fact(type=finding) 登记，update_node(id, status=confirmed) 坐实后进入报告。");
	} else {
		findings.forEach((f, i) => {
			L.push(`## 三.${i + 1} ${clean(f.label)}`);
			L.push("");
			L.push(`- 状态：${f.status ?? "open"}${f.status === "confirmed" ? "（坐实）" : "（待验证坐实）"}`);
			if (f.tags?.length) L.push(`- 标签：${f.tags.join("、")}`);
			L.push(`- 证据/复现：${f.detail ? clean(f.detail) : "（待补 detail）"}`);
			L.push(`- 状态机参与：${machineLine(f, snap)}`);
			const sub = renderSubgraph(f, snap);
			if (sub) {
				L.push("");
				L.push("攻击链配图：");
				L.push("");
				L.push("```mermaid");
				L.push(sub);
				L.push("```");
			}
			L.push("");
		});
	}

	const stuckDirs = Object.entries(snap.failureCounts);
	if (stuckDirs.length > 0) {
		L.push("## 附录A · 失败史（克制的证据：哪些方向试过没成）");
		L.push("");
		L.push("| 方向 | 失败次数 |");
		L.push("|---|---|");
		L.push(...stuckDirs.map(([d, c]) => `| ${clean(d)} | ${c} |`));
		L.push("");
	}
	// 落库核对清单（WP-B3）：只提示不代写——落库语义（项目选择/一目标一库）归技能包
	if (confirmedFindings.length > 0) {
		L.push("## 附录B · 落库核对");
		L.push("");
		if (notInLedger.length === 0) {
			L.push(`全部 ${confirmedFindings.length} 项坐实发现均已观测到 pentrack 落库调用 ✓`);
		} else {
			L.push(`以下 ${notInLedger.length} 项坐实发现**未观测到 pentrack 落库**（fact_add/vuln_add），按技能包双写铁律补落：`);
			L.push("");
			for (const n of notInLedger) L.push(`- ${n.id}「${clean(n.label)}」`);
		}
		L.push("");
	}
	// 证据缺失清单：confirmed finding 缺证据的，报告不静默当完整
	if (confirmedFindings.length > 0) {
		L.push("## 附录C · 证据缺失清单");
		L.push("");
		if (missingEvidence.length === 0) {
			L.push(`全部 ${confirmedFindings.length} 项坐实发现均有证据 detail ✓`);
		} else {
			L.push(
				`以下 ${missingEvidence.length} 项坐实发现**缺证据/复现 detail**——结论按待验证口径对待，补证据（请求响应/命令输出/截图）前不得对外提交：`,
			);
			L.push("");
			for (const n of missingEvidence) L.push(`- ${n.id}「${clean(n.label)}」——无 detail（record_fact 补 or update_node 降回 open）`);
		}
		L.push("");
	}
	L.push("## 附录D · 数据来源");
	L.push("");
	L.push("本报告由 PiX /report 从画板快照生成；原始过程见会话 JSONL（全量留痕）。");
	return L.join("\n");
}

/** 落盘并返回绝对路径 */
export async function writeReport(): Promise<string> {
	const { writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const file = join(process.cwd(), `pix-report-${ts}.md`);
	writeFileSync(file, renderReport(), "utf8");
	return file;
}
