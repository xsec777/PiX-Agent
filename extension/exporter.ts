/**
 * exporter.ts — 结构化事实快照与数据底表导出器 (Ground Truth Snapshot Exporter)
 *
 * 核心哲学：
 * 1. 彻底解耦“事实沉淀”与“报告展现”：
 *    - 代码层 100% 聚焦于客观事实的确定性提取（0 幻觉、0 自由发挥、0 格式绑架）；
 *    - 报告展现交给用户自己的专属模板（大模型基于本底表进行精准填空即可）。
 * 2. 导出输出：
 *    - pix-facts-<时间戳>.json：高保真机器可读结构化底表；
 *    - pix-facts-<时间戳>.md：纯事实、零废话的核查底表（资产/跳板/凭据/漏洞请求响应）。
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	getState,
	getAllHosts,
	getAllSessions,
	getAllCredentials,
	getAllEndpoints,
	type HostNode,
	type PivotSessionNode,
	type CredentialNode,
	type EndpointNode,
} from "./state.ts";

export interface GroundTruthData {
	exportedAt: string;
	mode: string;
	auth?: { targets: string[]; source: string; recordedAt: string };
	task?: { title: string; recordedAt: string };
	statistics: {
		totalNodes: number;
		totalEdges: number;
		hostsCount: number;
		sessionsCount: number;
		credentialsCount: number;
		endpointsCount: number;
		confirmedFindingsCount: number;
		failureDirectionsCount: number;
	};
	hosts: HostNode[];
	sessions: PivotSessionNode[];
	credentials: CredentialNode[];
	endpoints: EndpointNode[];
	findings: Array<{
		id: string;
		title: string;
		confidence?: string;
		tags?: string[];
		detail?: string;
		evidenceRequest?: string;
		evidenceResponse?: string;
		affectedCount?: number;
		sampleProof?: string;
		discoveredAt: string;
	}>;
	failureCounts: Record<string, number>;
	mermaidTopology?: string;
}

const clean = (t: string) => t.replace(/[|`]/g, "/").replace(/\s*\n+\s*/g, " ").trim();

/**
 * 提取全量不可篡改的事实快照对象 (Ground Truth Object)
 */
export function buildGroundTruth(): GroundTruthData {
	const state = getState();
	const findings = state.nodes.filter((n) => n.type === "finding" && n.status === "confirmed");

	return {
		exportedAt: new Date().toISOString(),
		mode: state.mode,
		auth: state.auth,
		task: state.task ? { title: state.task.title, recordedAt: state.task.recordedAt } : undefined,
		statistics: {
			totalNodes: state.nodes.length,
			totalEdges: state.edges.length,
			hostsCount: state.hosts.length,
			sessionsCount: state.sessions.length,
			credentialsCount: state.credentials.length,
			endpointsCount: (state.endpoints || []).length,
			confirmedFindingsCount: findings.length,
			failureDirectionsCount: Object.keys(state.failureCounts).length,
		},
		hosts: getAllHosts(),
		sessions: getAllSessions(),
		credentials: getAllCredentials(),
		endpoints: getAllEndpoints(),
		findings: findings.map((f) => ({
			id: f.id,
			title: f.label,
			confidence: f.confidence,
			tags: f.tags,
			detail: f.detail,
			evidenceRequest: f.evidenceRequest,
			evidenceResponse: f.evidenceResponse,
			affectedCount: f.affectedCount,
			sampleProof: f.sampleProof,
			discoveredAt: f.createdAt,
		})),
		failureCounts: state.failureCounts,
	};
}

/**
 * 导出不可篡改的 JSON 格式事实底表 (pix-facts-<ts>.json)
 */
export function exportGroundTruthJson(): { file: string; data: GroundTruthData } {
	const data = buildGroundTruth();
	const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const file = join(process.cwd(), `pix-facts-${ts}.json`);
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
	return { file, data };
}

/**
 * 导出纯事实维度的 Markdown 底表 (pix-facts-<ts>.md)
 */
export function exportGroundTruthMarkdown(): { file: string; text: string } {
	const data = buildGroundTruth();
	const L: string[] = [];

	L.push(`# PiX 渗透攻防事实底表 (Ground Truth Snapshot)`);
	L.push(`*导出时间：${new Date().toLocaleString()} · 作战模式：${data.mode.toUpperCase()}*`);
	L.push("");

	// 1. 目标与围栏
	L.push(`## 1. 目标围栏与授权`);
	if (data.auth) {
		L.push(`- **授权目标**：${data.auth.targets.join("、")}`);
		L.push(`- **授权来源**：${data.auth.source}（登记于 ${data.auth.recordedAt}）`);
	} else if (data.task) {
		L.push(`- **红队任务书**：${data.task.title}（登记于 ${data.task.recordedAt}）`);
	} else {
		L.push(`- 暂未登记明确的 /auth 授权或 /task 任务书`);
	}
	L.push("");

	// 2. 主机资产与破门立足点
	if (data.hosts.length > 0) {
		L.push(`## 2. 攻防主机资产与立足点 (${data.hosts.length} 台)`);
		L.push("");
		L.push("| 主机 ID | IP 列表 | 区域 | 操作系统 | 角色 | 控制状态 | 破门途径 | 开放端口服务 |");
		L.push("|---|---|---|---|---|---|---|---|");
		for (const h of data.hosts) {
			const ports = h.services.map((s) => `${s.port}/${s.protocol}`).join(", ") || "-";
			const scope = h.networkScope === "external" ? "外网" : h.networkScope === "dmz" ? "DMZ" : "内网";
			L.push(`| \`${h.id}\` | ${h.ips.join(", ")} | ${scope} | ${h.os || "未知"} | ${h.isDC ? "**域控**" : "主机"} | ${h.isCompromised ? "⚡ **PWNED**" : "未攻破"} | ${h.compromiseVector || "-"} | ${ports} |`);
		}
		L.push("");
	}

	// 3. 跳板与穿透隧道
	if (data.sessions.length > 0) {
		L.push(`## 3. 跳板穿透与路由拓扑 (${data.sessions.length} 条)`);
		L.push("");
		L.push("| 跳板 ID | 宿主节点 | 隧道类型 | 本地端口 | 可达内网网段 | 状态 |");
		L.push("|---|---|---|---|---|---|");
		for (const s of data.sessions) {
			L.push(`| \`${s.id}\` | \`${s.sourceHostId}\` | ${s.tunnelType.toUpperCase()} | \`${s.localListenPort}\` | ${s.egressSubnets.join(", ")} | ${s.status === "active" ? "🟢 活跃" : "🔴 失效"} |`);
		}
		L.push("");
	}

	// 4. 凭据金库
	if (data.credentials.length > 0) {
		L.push(`## 4. 凭据金库与权限归属 (${data.credentials.length} 项)`);
		L.push("");
		L.push("| 凭据 ID | 账号 | 域 | 类型 | 脱敏凭据实体 | 权限等级 | 来源主机 | 已验证目标 |");
		L.push("|---|---|---|---|---|---|---|---|");
		for (const c of data.credentials) {
			const masked = c.value.length > 8 ? `${c.value.slice(0, 4)}...${c.value.slice(-4)}` : "******";
			L.push(`| \`${c.id}\` | **${c.account}** | ${c.domain || "LOCAL"} | \`${c.type}\` | \`${masked}\` | **${c.privilegeScope}** | \`${c.originHostId}\` | ${c.validTargets.join(", ") || "-"} |`);
		}
		L.push("");
	}

	// 5. 接口资产台账
	if (data.endpoints.length > 0) {
		L.push(`## 5. Web/API 接口资产台账 (${data.endpoints.length} 个)`);
		L.push("");
		L.push("| 编号 | HTTP 方法 | URL 端点 | 状态机流转 | 参数列表 | 关联脆弱点 |");
		L.push("|---|---|---|---|---|---|");
		for (const ep of data.endpoints) {
			const stateTag =
				ep.status === "confirmed" ? "✓ 已坐实" : ep.status === "rejected" ? "✗ 已排除" : ep.status === "bypassing" ? "🔄 绕过中" : "⏳ 待探针";
			L.push(`| \`${ep.id}\` | \`${ep.method}\` | \`${ep.url}\` | ${stateTag} | ${(ep.params || []).join(", ") || "-"} | ${(ep.vulnerabilities || []).join("、") || "-"} |`);
		}
		L.push("");
	}

	// 6. 坐实漏洞与原始复现证据
	L.push(`## 6. 已坐实漏洞与原始复现证据 (${data.findings.length} 项)`);
	L.push("");
	if (data.findings.length === 0) {
		L.push("暂无坐实漏洞（通过 record_fact / update_node confirmed 登记入账）。");
	} else {
		data.findings.forEach((f, idx) => {
			L.push(`### 6.${idx + 1} [${f.id}] ${clean(f.title)}`);
			L.push(`- **置信度**：${f.confidence || "high"}`);
			if (f.tags?.length) L.push(`- **技术标签**：${f.tags.join("、")}`);
			if (f.detail) L.push(`- **现场描述**：${clean(f.detail)}`);
			if (f.affectedCount !== undefined) L.push(`- **受影响总量计数**：\`COUNT(*) = ${f.affectedCount}\``);
			if (f.sampleProof) {
				L.push(`- **最小样本证明（已脱敏）**：`);
				L.push("```text\n" + f.sampleProof.trim() + "\n```");
			}
			if (f.evidenceRequest) {
				L.push("");
				L.push("#### 原始复现 HTTP 请求包：");
				L.push("```http\n" + f.evidenceRequest.trim() + "\n```");
			}
			if (f.evidenceResponse) {
				L.push("");
				L.push("#### 关键响应包 / 差分证明：");
				L.push("```http\n" + f.evidenceResponse.trim() + "\n```");
			}
			L.push("");
		});
	}

	const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const file = join(process.cwd(), `pix-facts-${ts}.md`);
	const text = L.join("\n");
	writeFileSync(file, text, "utf8");
	return { file, text };
}
