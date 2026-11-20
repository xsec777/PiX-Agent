/**
 * escalation.ts — 本地升档建议与任务信封重建 (ADR 0003)
 *
 * 显式调用时评估输入状态、返回 SmartTier 信封并保存每端点最新内存记录。
 * 不终止 Worker、不调用模型、不重新派发任务；保留原信封配额及安全边界。
 */

import type { EndpointNode } from "./state.ts";
import { createTaskEnvelope, type TaskEnvelope, type ModelTier } from "./task-envelope.ts";
import type { WorkerResult } from "./worker-result.ts";

export interface EscalationDecision {
	readonly shouldEscalate: boolean;
	readonly currentTier: ModelTier;
	readonly targetTier: ModelTier;
	readonly reason?: string;
	readonly failureStreak: number;
	readonly status: string;
}

export interface EscalationRecord {
	readonly endpointId: string;
	readonly originalEnvelopeId: string;
	readonly promotedEnvelopeId: string;
	readonly reason: string;
	readonly promotedAt: number;
}

export class EscalationPromoter {
	private escalationRecords: Map<string, EscalationRecord> = new Map();
	private readonly failureStreakThreshold: number;

	constructor(failureStreakThreshold = 2) {
		if (!Number.isSafeInteger(failureStreakThreshold) || failureStreakThreshold < 1) {
			throw new Error("[EscalationPromoter] failureStreakThreshold 必须为正整数");
		}
		this.failureStreakThreshold = failureStreakThreshold;
	}

	/**
	 * 评估端点或最近 WorkerResult 是否满足自动升档换将条件
	 */
	public evaluateEscalation(
		endpoint: Pick<EndpointNode, "id" | "status" | "failureStreak" | "escalationLevel">,
		lastResult?: Pick<WorkerResult, "status" | "action">,
	): EscalationDecision {
		const isBypassing = endpoint.status === "bypassing" || lastResult?.status === "bypassing";
		const isStreakExceeded = (endpoint.failureStreak || 0) >= this.failureStreakThreshold;
		const isHighEscalation = (endpoint.escalationLevel || 0) >= 1;

		if (!["confirmed", "rejected", "blocked"].includes(endpoint.status) && (isBypassing || isStreakExceeded || isHighEscalation)) {
			let reason = "";
			if (isBypassing) {
				reason = `端点处于 bypassing 状态，常规探针遭遇 WAF 强阻抗拦截`;
			} else if (isStreakExceeded) {
				reason = `连续失败次数达到 ${endpoint.failureStreak} 次 (阈值: ${this.failureStreakThreshold})，遭遇高抗阻瓶颈`;
			} else {
				reason = `变异攻坚深度达到 Level ${endpoint.escalationLevel}`;
			}

			return {
				shouldEscalate: true,
				currentTier: "FastTier",
				targetTier: "SmartTier",
				reason,
				failureStreak: endpoint.failureStreak || 0,
				status: endpoint.status,
			};
		}

		return {
			shouldEscalate: false,
			currentTier: "FastTier",
			targetTier: "FastTier",
			failureStreak: endpoint.failureStreak || 0,
			status: endpoint.status,
		};
	}

	/**
	 * 自动升档生成携带攻坚上下文的新 TaskEnvelope
	 */
	public promoteTaskEnvelope(
		originalEnvelope: TaskEnvelope,
		reason: string,
	): Readonly<TaskEnvelope> {
		if (originalEnvelope.assignedTier !== "FastTier") throw new Error("[EscalationPromoter] 任务已处于 SmartTier");
		if (!reason.trim()) throw new Error("[EscalationPromoter] 升档原因不能为空");
		const enhancedFacts = [
			...originalEnvelope.contextFacts,
			`[EscalationPromotion 升档接管] 原因: ${reason}。建议由 SmartTier 处理；尚未派发执行`,
		];

		const promoted = createTaskEnvelope({
			endpointId: originalEnvelope.endpointId,
			targetUrl: originalEnvelope.targetUrl,
			httpMethod: originalEnvelope.httpMethod,
			params: [...originalEnvelope.params],
			assignedTier: "SmartTier", // 强制升档至 SmartTier 旗舰脑
			probeQuota: {
				maxTurns: originalEnvelope.probeQuota.maxTurns,
				timeoutMs: originalEnvelope.probeQuota.timeoutMs,
				maxMutations: originalEnvelope.probeQuota.maxMutations, // 不扩大调用方配额
			},
			boundary: {
				forbiddenPaths: [...originalEnvelope.boundary.forbiddenPaths],
				allowedHosts: [...originalEnvelope.boundary.allowedHosts],
				readOnly: originalEnvelope.boundary.readOnly,
			},
			contextFacts: enhancedFacts,
		});

		this.escalationRecords.set(originalEnvelope.endpointId, {
			endpointId: originalEnvelope.endpointId,
			originalEnvelopeId: originalEnvelope.id,
			promotedEnvelopeId: promoted.id,
			reason,
			promotedAt: Date.now(),
		});

		return promoted;
	}

	/**
	 * 获取指定端点的升档换将历史记录
	 */
	public getRecord(endpointId: string): EscalationRecord | undefined {
		const record = this.escalationRecords.get(endpointId);
		return record ? { ...record } : undefined;
	}

	/**
	 * 获取全量升档记录列表
	 */
	public getAllRecords(): EscalationRecord[] {
		return Array.from(this.escalationRecords.values(), (record) => ({ ...record }));
	}

	/**
	 * 重置清空升档台账
	 */
	public reset(): void {
		this.escalationRecords.clear();
	}
}

// 导出全局单例
export const globalEscalationPromoter = new EscalationPromoter();
