/**
 * worker-result.ts — WorkerResult 结构化内存对象回传与状态机对账引擎 (ADR 0001/0002 & CONTEXT.md)
 *
 * 核心职责：
 * 1. 结构化契约：Worker 子会话向 Planner 交付的强类型内存结果对象；
 * 2. 状态机对账：自动将 WorkerResult 回写至 state.ts 的端点台账 (EndpointLedger)，驱动七态闭环跃迁；
 * 3. 资产级联水合：自动解析回传的新资产 (extractedAssets)，通过完全匹配去重自动录入台账队列；
 * 4. 资源物理回收：对账完成后无缝联动 WorkerPool 释放槽位与 WatchdogCeiling 解除看门狗。
 */

import { updateEndpointStatus, recordEndpoint, getEndpointById, type EndpointStatus } from "./state.ts";
import type { ProbeRecord } from "./termination.ts";
import { globalWorkerPool } from "./worker-pool.ts";
import { globalWatchdogCeiling } from "./watchdog.ts";

export interface WorkerResult {
	readonly id: string;
	readonly workerId: string;
	readonly taskEnvelopeId: string;
	readonly endpointId: string;
	readonly status: EndpointStatus;
	readonly action: string;
	readonly testedTimes: number;
	readonly escalationLevel: number;
	readonly evidenceRequest?: string;
	readonly evidenceResponse?: string;
	readonly vulnerabilityTitle?: string;
	readonly probeHistory?: readonly ProbeRecord[];
	readonly falsificationSummary?: string;
	readonly extractedAssets?: readonly string[];
	readonly turnCount: number;
	readonly elapsedMs: number;
	readonly completedAt: number;
}

export interface CreateWorkerResultOptions {
	id?: string;
	workerId: string;
	taskEnvelopeId: string;
	endpointId: string;
	status: EndpointStatus;
	action: string;
	testedTimes?: number;
	escalationLevel?: number;
	evidenceRequest?: string;
	evidenceResponse?: string;
	vulnerabilityTitle?: string;
	probeHistory?: ProbeRecord[];
	falsificationSummary?: string;
	extractedAssets?: string[];
	turnCount?: number;
	elapsedMs?: number;
	completedAt?: number;
}

export interface ReconciliationReport {
	readonly reconciled: boolean;
	readonly endpointId: string;
	readonly originalStatus?: EndpointStatus;
	readonly newStatus: EndpointStatus;
	readonly newAssetsAdded: number;
	readonly slotReleased: boolean;
	readonly watchdogCleared: boolean;
	readonly message: string;
}

/**
 * 校验 WorkerResult 数据契约合法性
 */
export function validateWorkerResult(raw: unknown): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!raw || typeof raw !== "object") {
		return { valid: false, errors: ["WorkerResult 必须是非空对象"] };
	}

	const res = raw as Partial<WorkerResult>;

	if (!res.id || typeof res.id !== "string") errors.push("缺少或无效的 id");
	if (!res.workerId || typeof res.workerId !== "string") errors.push("缺少或无效的 workerId");
	if (!res.taskEnvelopeId || typeof res.taskEnvelopeId !== "string") errors.push("缺少或无效的 taskEnvelopeId");
	if (!res.endpointId || typeof res.endpointId !== "string") errors.push("缺少或无效的 endpointId");

	const validStatuses: EndpointStatus[] = [
		"discovered",
		"probing",
		"bypassing",
		"escalating",
		"confirmed",
		"rejected",
		"blocked",
	];
	if (!res.status || !validStatuses.includes(res.status)) {
		errors.push(`无效的 status 状态机值: ${String(res.status)}`);
	}

	if (!res.action || typeof res.action !== "string") errors.push("缺少或无效的 action 动作描述");
	if (res.status === "confirmed" && (!res.vulnerabilityTitle?.trim() || !res.evidenceRequest?.trim() || !res.evidenceResponse?.trim())) {
		errors.push("confirmed 结果必须包含漏洞标题、请求与响应证据");
	}
	if (res.status === "rejected" && (!Array.isArray(res.probeHistory) || res.probeHistory.length < 3 || !res.falsificationSummary?.trim())) {
		errors.push("rejected 结果必须包含至少三条探测历史和证伪摘要");
	}

	if (typeof res.turnCount !== "number" || !Number.isInteger(res.turnCount) || res.turnCount < 0) {
		errors.push("turnCount 必须为非负整数");
	}
	if (typeof res.elapsedMs !== "number" || !Number.isInteger(res.elapsedMs) || res.elapsedMs < 0) {
		errors.push("elapsedMs 必须为非负整数");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * 工厂函数：构建并冻结一份强类型的 WorkerResult
 */
export function createWorkerResult(options: CreateWorkerResultOptions): Readonly<WorkerResult> {
	const now = options.completedAt ?? Date.now();
	const resultId = options.id ?? `res-${now}-${Math.random().toString(36).substring(2, 7)}`;

	const result: WorkerResult = {
		id: resultId,
		workerId: options.workerId,
		taskEnvelopeId: options.taskEnvelopeId,
		endpointId: options.endpointId,
		status: options.status,
		action: options.action,
		testedTimes: options.testedTimes ?? 1,
		escalationLevel: options.escalationLevel ?? 0,
		evidenceRequest: options.evidenceRequest,
		evidenceResponse: options.evidenceResponse,
		vulnerabilityTitle: options.vulnerabilityTitle,
		probeHistory: options.probeHistory ? Object.freeze([...options.probeHistory]) : undefined,
		falsificationSummary: options.falsificationSummary,
		extractedAssets: options.extractedAssets ? Object.freeze([...options.extractedAssets]) : undefined,
		turnCount: options.turnCount ?? 1,
		elapsedMs: options.elapsedMs ?? 0,
		completedAt: now,
	};

	const check = validateWorkerResult(result);
	if (!check.valid) {
		throw new Error(`[WorkerResult] 契约校验失败: ${check.errors.join("; ")}`);
	}

	return Object.freeze(result);
}

/**
 * 核心对账函数：将 WorkerResult 结果原子回写至端点台账，并联动释放系统资源
 */
const reconciledResultIds = new Set<string>();

export function reconcileWorkerResult(result: WorkerResult): ReconciliationReport {
	const check = validateWorkerResult(result);
	if (!check.valid) {
		throw new Error(`[reconcileWorkerResult 拒绝对账] 契约校验不通过: ${check.errors.join("; ")}`);
	}
	if (reconciledResultIds.has(result.id)) {
		throw new Error("[reconcileWorkerResult 拒绝对账] 结果 ID 已处理，拒绝重放");
	}

	const existing = getEndpointById(result.endpointId);
	if (!existing) throw new Error("[reconcileWorkerResult 拒绝对账] endpointId 不存在");
	if (existing.status === "confirmed" || existing.status === "rejected" || existing.status === "blocked") {
		throw new Error("[reconcileWorkerResult 拒绝对账] 端点已闭环，拒绝重复或迟到结果");
	}

	const slot = globalWorkerPool.getSlotByWorkerId(result.workerId);
	if (!slot || slot.taskEnvelopeId !== result.taskEnvelopeId || slot.endpointId !== result.endpointId) {
		throw new Error("[reconcileWorkerResult 拒绝对账] Worker、任务信封与端点绑定不匹配");
	}
	const watchdog = globalWatchdogCeiling.getEntry(result.workerId);
	if (!watchdog || watchdog.taskEnvelopeId !== result.taskEnvelopeId || watchdog.endpointId !== result.endpointId || watchdog.status === "cleared") {
		throw new Error("[reconcileWorkerResult 拒绝对账] Worker 看门狗状态或绑定不匹配");
	}

	const originalStatus = existing.status;

	// 1. 回写端点状态机跃迁 (更新台账)
		updateEndpointStatus(result.endpointId, result.status, {
			action: result.action,
			diffSignature: result.evidenceResponse ? result.evidenceResponse.slice(0, 120) : undefined,
			vuln: result.vulnerabilityTitle,
			evidenceRequest: result.evidenceRequest,
			evidenceResponse: result.evidenceResponse,
		});

	// 2. 级联水合回传的新资产 (URL 端点)
	let newAssetsAdded = 0;
	if (result.extractedAssets && result.extractedAssets.length > 0) {
		for (const rawAsset of result.extractedAssets) {
			const trimmed = rawAsset.trim();
			if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
				try {
					recordEndpoint({
						url: trimmed,
						method: "GET",
						discoveredFrom: `WorkerResult [${result.workerId}]`,
					});
					newAssetsAdded++;
				} catch {
					// 忽略格式异常资产
				}
			}
		}
	}

	// 3. 联动 WorkerPool 释放槽位
	const poolStatus = result.status === "confirmed" || result.status === "rejected" ? "completed" : "failed";
	const slotReleased = globalWorkerPool.releaseSlot(result.workerId, poolStatus);

	// 4. 联动 WatchdogCeiling 解除看门狗注销
	const watchdogCleared = globalWatchdogCeiling.clear(result.workerId);
	reconciledResultIds.add(result.id);

	return {
		reconciled: true,
		endpointId: result.endpointId,
		originalStatus,
		newStatus: result.status,
		newAssetsAdded,
		slotReleased,
		watchdogCleared,
		message: `WorkerResult 成功对账入库，状态机流转为 ${result.status}，新收录资产 ${newAssetsAdded} 条，槽位已释放，看门狗已解除`,
	};
}
