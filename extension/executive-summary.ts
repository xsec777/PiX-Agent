/** Local executive-summary draft from ledger statistics; no model or network calls. */
import type { DataPlaneReport } from "./report-engine.ts";
import { redactEvidenceRequest } from "./redaction.ts";
import { maskPII } from "./pii-masker.ts";

export interface ExecutiveSummarySection {
	readonly sectionTitle: string;
	readonly generatedAt: number;
	readonly overallRiskLevel: "UNASSESSED";
	readonly executivePosture: string;
	readonly strategicPriorities: readonly string[];
	readonly governanceRoadmap: readonly string[];
	readonly markdownContent: string;
}

export interface ExecutiveOptions {
	organizationName?: string;
	cLevelAudience?: "CISO" | "CIO" | "BOARD";
	customStrategicFocus?: readonly string[];
	generatedAt?: number;
}

const safeLabel = (text: string): string => maskPII(redactEvidenceRequest(text)).maskedText
	.replace(/[\r\n\u2028\u2029]+/g, " ")
	.replace(/[&<>\\`*_{}\[\]()!|#~]/g, (char) => `&#${char.charCodeAt(0)};`);

export function generateExecutiveSummary(
	dataReport: DataPlaneReport,
	options: ExecutiveOptions = {},
): ExecutiveSummarySection {
	const generatedAt = options.generatedAt ?? Date.now();
	if (!Number.isSafeInteger(generatedAt) || generatedAt < 0 || generatedAt > 8640000000000000) {
		throw new RangeError("generatedAt must be a valid non-negative integer timestamp");
	}
	// Only project aggregate counts; never read vulnerabilities, URLs or evidence text.
	const total = dataReport.totalEndpointsScanned;
	const confirmed = dataReport.confirmedCount;
	const rejected = dataReport.rejectedCount;
	const bypassing = dataReport.bypassingCount;
	const blocked = dataReport.blockedCount;
	const titles = dataReport.findingCount;
	if (![total, confirmed, rejected, bypassing, blocked, titles].every((count) => Number.isSafeInteger(count) && count >= 0)) {
		throw new RangeError("ledger counts must be non-negative safe integers");
	}
	if (confirmed + rejected + bypassing + blocked > total) throw new RangeError("ledger status counts exceed total endpoints");
	const unfinished = total - confirmed - rejected - blocked;
	const org = safeLabel(options.organizationName ?? "输入台账范围");
	const audience = options.cLevelAudience ?? "CISO";
	if (!["CISO", "CIO", "BOARD"].includes(audience)) throw new TypeError("unsupported executive audience");
	const posture = `${org}：输入台账共 ${total} 个端点，confirmed 标签 ${confirmed} 个（标题条目 ${titles} 项），` +
		`rejected 标签 ${rejected} 个，blocked 标签 ${blocked} 个，未处于统计闭环状态 ${unfinished} 个（其中 bypassing ${bypassing} 个）。` +
		"整体风险未评估；台账标签不等于独立确证、真实发包或全部测试维度已完成。" +
		(total === 0 ? "当前输入为空，不能据此判断目标安全。" : "没有 confirmed 条目也不代表不存在漏洞。") +
		(blocked > 0 ? "受阻端点须披露限制及所缺授权或环境，不应记作安全。" : "");
	const priorities: string[] = [
		"核对台账来源、范围、证据归属与敏感信息；由人工评估严重等级及业务影响。",
		confirmed > 0 ? "优先独立复核 confirmed 标签及其证据，再依据实际影响确定整改次序。" : "未发现确认标签不等于目标安全；核对未测维度与覆盖限制。",
		unfinished + blocked > 0 ? "登记未完成及受阻事项，在授权和低影响条件满足后安排后续验证。" : "对统计闭环事项进行证据与覆盖复核，避免把状态计数当作安全结论。",
	];
	if (options.customStrategicFocus !== undefined) {
		if (!Array.isArray(options.customStrategicFocus) || options.customStrategicFocus.some((focus) => typeof focus !== "string")) {
			throw new TypeError("customStrategicFocus must be a string array");
		}
		for (const focus of options.customStrategicFocus) {
			if (focus.trim()) priorities.push(`调用方关注项（未经验证）：${safeLabel(focus)}`);
		}
	}
	const roadmap = [
		"短期：核对证据、授权和阻塞条件，由负责人确认优先级与影响上限。",
		"中期：针对已独立核实的问题制定整改与回归验证计划。",
		"长期：持续维护资产、证据和覆盖台账，定期复核治理效果。",
	];
	const lines = [
		"## 管理层执行摘要草稿", `生成时间：${new Date(generatedAt).toISOString()}`,
		`受众：${audience}`, "整体风险：UNASSESSED（未评估）", "",
		"本节由本地固定规则模板生成，无 LLM 或网络调用，不是独立风险评估或完成证明。", "",
		"### 台账态势与限制", posture, "", "### 建议优先事项",
		...priorities.map((priority, i) => `${i + 1}. ${priority}`), "", "### 建议治理路线图",
		...roadmap.map((phase) => `- ${phase}`),
	];
	return Object.freeze({
		sectionTitle: "管理层执行摘要草稿",
		generatedAt,
		overallRiskLevel: "UNASSESSED",
		executivePosture: posture,
		strategicPriorities: Object.freeze(priorities),
		governanceRoadmap: Object.freeze(roadmap),
		markdownContent: lines.join("\n"),
	});
}
