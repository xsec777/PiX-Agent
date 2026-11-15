/**
 * termination.ts — Worker 状态机驱动的四态终结契约与 worker_submit 工具 (ADR 0005 & CONTEXT.md)
 *
 * 核心职责：
 * 1. 终结收口：严禁 Worker 子会话通过非受控纯文本聊天自行结束，必须调用 worker_submit；
 * 2. 四态契约：强约束终结结局为四态之一 (confirmed / escalating / bypassing / rejected)；
 * 3. 门禁硬验：
 *    - confirmed: 必附原始请求包与差分切片；
 *    - escalating: 必附立足点证据与横向凭据；
 *    - bypassing: 必附连续变异阻断特征 (≥2次尝试)，触发升档换将；
 *    - rejected: 刚性防偷懒，必附 ≥3 次多维探针证伪历史记录，否则底层拒签。
 */

export type TerminationOutcome = "confirmed" | "escalating" | "bypassing" | "rejected";

export interface ProbeRecord {
	readonly probeType: "baseline" | "encoding_mutation" | "syntax_variation" | "smuggling_chunked" | "parameter_pollution";
	readonly action: string;
	readonly responseStatus: number;
	readonly diffObserved: boolean;
}

export interface WorkerSubmitPayload {
	readonly workerId: string;
	readonly taskEnvelopeId: string;
	readonly endpointId: string;
	readonly outcome: TerminationOutcome;
	readonly summary: string;

	// confirmed 结局强约束字段
	readonly vulnerabilityTitle?: string;
	readonly evidenceRequest?: string;
	readonly evidenceResponse?: string;

	// escalating 结局强约束字段
	readonly footholdEvidence?: string;
	readonly extractedAssets?: readonly string[];

	// bypassing 结局强约束字段 (触发 SmartTier 升档)
	readonly wafSignature?: string;
	readonly blockReason?: string;
	readonly attemptsCount?: number;

	// rejected 结局刚性防偷懒字段
	readonly probeHistory?: readonly ProbeRecord[];
	readonly falsificationSummary?: string;
}

export interface TerminationReceipt {
	readonly receiptId: string;
	readonly accepted: boolean;
	readonly outcome: TerminationOutcome;
	readonly timestamp: number;
	readonly message: string;
	readonly nextAction: "early_exit" | "plan_lateral" | "escalate_smart_tier" | "close_ledger";
}

/**
 * 校验 worker_submit 提交参数是否符合 ADR 0005 刚性终结契约
 */
export function validateTerminationContract(raw: unknown): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!raw || typeof raw !== "object") {
		return { valid: false, errors: ["worker_submit 载荷必须为有效非空对象"] };
	}

	const payload = raw as Partial<WorkerSubmitPayload>;

	if (!payload.workerId || typeof payload.workerId !== "string" || !payload.workerId.trim()) {
		errors.push("缺少有效 workerId");
	}
	if (!payload.taskEnvelopeId || typeof payload.taskEnvelopeId !== "string" || !payload.taskEnvelopeId.trim()) {
		errors.push("缺少有效 taskEnvelopeId");
	}
	if (!payload.endpointId || typeof payload.endpointId !== "string" || !payload.endpointId.trim()) {
		errors.push("缺少有效 endpointId");
	}
	if (!payload.summary || typeof payload.summary !== "string" || !payload.summary.trim()) {
		errors.push("缺少有效 summary 总结");
	}

	const validOutcomes: TerminationOutcome[] = ["confirmed", "escalating", "bypassing", "rejected"];
	if (!payload.outcome || !validOutcomes.includes(payload.outcome)) {
		errors.push(`无效的 outcome 结局: ${String(payload.outcome)}，必须为 confirmed/escalating/bypassing/rejected 之一`);
		return { valid: false, errors };
	}

	// -------------------------------------------------------------
	// 四态差异化准出准则严格校验
	// -------------------------------------------------------------
	switch (payload.outcome) {
		case "confirmed": {
			if (!payload.vulnerabilityTitle || typeof payload.vulnerabilityTitle !== "string" || !payload.vulnerabilityTitle.trim()) {
				errors.push("[confirmed 契约违背] 漏洞证实必须提供 vulnerabilityTitle (漏洞名称)");
			}
			if (!payload.evidenceRequest || typeof payload.evidenceRequest !== "string" || !payload.evidenceRequest.trim()) {
				errors.push("[confirmed 契约违背] 漏洞证实必须提供 evidenceRequest (原始 HTTP 请求包)");
			}
			if (!payload.evidenceResponse || typeof payload.evidenceResponse !== "string" || !payload.evidenceResponse.trim()) {
				errors.push("[confirmed 契约违背] 漏洞证实必须提供 evidenceResponse (关键响应/差分切片)");
			}
			break;
		}

		case "escalating": {
			const hasFoothold = typeof payload.footholdEvidence === "string" && payload.footholdEvidence.trim().length > 0;
			const hasAssets = Array.isArray(payload.extractedAssets) && payload.extractedAssets.length > 0;
			if (!hasFoothold && !hasAssets) {
				errors.push("[escalating 契约违背] 纵深突破必须提供 footholdEvidence 或提取的 extractedAssets");
			}
			break;
		}

		case "bypassing": {
			const hasWaf = typeof payload.wafSignature === "string" && payload.wafSignature.trim().length > 0;
			const hasReason = typeof payload.blockReason === "string" && payload.blockReason.trim().length > 0;
			if (!hasWaf && !hasReason) {
				errors.push("[bypassing 契约违背] 强阻抗升档必须提供 wafSignature 或 blockReason 阻断特征");
			}
			if (typeof payload.attemptsCount !== "number" || payload.attemptsCount < 2) {
				errors.push("[bypassing 契约违背] 必须经历至少 2 组以上变异尝试受挫方可请求升档换将 (attemptsCount >= 2)");
			}
			break;
		}

		case "rejected": {
			// 刚性防偷懒红线：严禁一次不报错就草率判定无漏洞
			if (!Array.isArray(payload.probeHistory) || payload.probeHistory.length < 3) {
				errors.push(`[rejected 契约违背 - 防偷懒刚性门禁拦截] 必须完成基线探针、编码变异与语法变形等多维尝试 (probeHistory 必须包含 ≥3 条无差分实测记录)，实测仅有 ${payload.probeHistory?.length ?? 0} 条`);
			}
			if (!payload.falsificationSummary || typeof payload.falsificationSummary !== "string" || !payload.falsificationSummary.trim()) {
				errors.push("[rejected 契约违背] 必须提供 falsificationSummary 说明多维证伪依据");
			}
			break;
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * 处理 Worker 终结提交并生成回执凭据
 */
export function handleWorkerSubmit(payload: WorkerSubmitPayload): TerminationReceipt {
	const check = validateTerminationContract(payload);
	if (!check.valid) {
		throw new Error(`[worker_submit 拒绝收口] 违反四态终结契约:\n${check.errors.map((e) => `  * ${e}`).join("\n")}`);
	}

	const receiptId = `rcpt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
	let nextAction: TerminationReceipt["nextAction"] = "early_exit";
	let message = "";

	switch (payload.outcome) {
		case "confirmed":
			nextAction = "early_exit";
			message = `[Confirmed] 漏洞确凿证实，触发 Early Exit 快速结案，节省后续 Token: ${payload.vulnerabilityTitle}`;
			break;
		case "escalating":
			nextAction = "plan_lateral";
			message = `[Escalating] 突破初始立足点，转交主控大脑进行横向/提权推演`;
			break;
		case "bypassing":
			nextAction = "escalate_smart_tier";
			message = `[Bypassing] 遭遇现场强阻抗 WAF，挂起当前信封，触发 ADR 0003 SmartTier 旗舰模型升档换将`;
			break;
		case "rejected":
			nextAction = "close_ledger";
			message = `[Rejected] 经 ≥3 维深度探针充分证伪，合规闭环结案`;
			break;
	}

	return {
		receiptId,
		accepted: true,
		outcome: payload.outcome,
		timestamp: Date.now(),
		message,
		nextAction,
	};
}
