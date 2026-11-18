/**
 * throttler.ts — 调用方反馈驱动的并发窗口控制器 (ADR 0004)
 *
 * 显式 recordFeedback 调用更新全局 WorkerPool 并发上限并记录冷却截止时间。
 * 不监听网络、不 sleep、不拒绝冷却期内任务，也不取消已运行 Worker；调用方负责等待。
 */

import { globalWorkerPool } from "./worker-pool.ts";

export type ThrottleState = "normal" | "throttled_429" | "throttled_waf" | "throttled_timeout";

export interface ThrottlerConfig {
	baselineConcurrency?: number; // 正常基线并发窗口 (默认 2)
	cooldownMs?: number; // 降级冷却保护时间 (默认 3000ms)
	recoveryThreshold?: number; // 恢复基线所需的连续无阻断成功响应次数 (默认 10)
}

export interface ThrottleReport {
	readonly state: ThrottleState;
	readonly currentWindow: number;
	readonly baselineWindow: number;
	readonly inCooldown: boolean;
	readonly cooldownRemainingMs: number;
	readonly consecutiveSuccess: number;
	readonly recoveryThreshold: number;
	readonly lastTriggerReason?: string;
}

export class AdaptiveThrottler {
	private baselineConcurrency: number;
	private cooldownMs: number;
	private recoveryThreshold: number;

	private currentState: ThrottleState = "normal";
	private currentWindow: number;
	private consecutiveSuccess = 0;
	private cooldownUntil = 0;
	private lastTriggerReason?: string;

	constructor(config: ThrottlerConfig = {}) {
		const baseline = config.baselineConcurrency ?? 2;
		const cooldown = config.cooldownMs ?? 3000;
		const threshold = config.recoveryThreshold ?? 10;
		if (!Number.isSafeInteger(baseline) || baseline < 1 || !Number.isSafeInteger(cooldown) || cooldown < 1000 || !Number.isSafeInteger(threshold) || threshold < 3) {
			throw new Error("[AdaptiveThrottler] 无效的并发、冷却或恢复阈值配置");
		}
		this.baselineConcurrency = Math.min(baseline, globalWorkerPool.getMetrics().totalSlots);
		this.cooldownMs = cooldown;
		this.recoveryThreshold = threshold;
		this.currentWindow = this.baselineConcurrency;
	}

	/**
	 * 报告单次网络请求的反馈指标
	 */
	public recordFeedback(params: {
		statusCode: number;
		isWafBlock?: boolean;
		isTimeout?: boolean;
		now?: number;
	}): ThrottleReport {
		const now = params.now ?? Date.now();
		const is429 = params.statusCode === 429;
		const isWaf = params.isWafBlock === true || params.statusCode === 403;
		const isTimeout = params.isTimeout === true;

		// -------------------------------------------------------------
		// 1. 触发阻抗防御：瞬间收缩并发窗口至 1，并进入冷却期
		// -------------------------------------------------------------
		if (is429 || isWaf || isTimeout) {
			this.consecutiveSuccess = 0;
			this.currentWindow = 1;
			this.cooldownUntil = now + this.cooldownMs;

			if (is429) {
				this.currentState = "throttled_429";
				this.lastTriggerReason = "遭遇 HTTP 429 Too Many Requests 频控限流";
			} else if (isWaf) {
				this.currentState = "throttled_waf";
				this.lastTriggerReason = "遭遇云 WAF / 防火墙 403 拦截挑战";
			} else {
				this.currentState = "throttled_timeout";
				this.lastTriggerReason = "遭遇网络连接超时或目标服务无响应";
			}

			// 限制后续槽位申请；不会取消已有 Worker
			globalWorkerPool.setMaxConcurrency(1);

			return this.getReport(now);
		}

		// -------------------------------------------------------------
		// 2. 冷却结束后的 2xx/3xx/常规 4xx 反馈累计恢复计数，5xx 重置计数
		// -------------------------------------------------------------
		if (this.isInCooldown(now)) return this.getReport(now);
		if (params.statusCode >= 200 && params.statusCode < 500) {
			this.consecutiveSuccess++;

			// 若当前处于降级受限态，且连续成功次数达到恢复阈值
			if (this.currentWindow < this.baselineConcurrency && this.consecutiveSuccess >= this.recoveryThreshold) {
				// 达到阈值后恢复到配置基线
				this.currentWindow = this.baselineConcurrency;
				this.currentState = "normal";
				this.lastTriggerReason = undefined;

				// 联动 WorkerPool 恢复基线并发窗口
				globalWorkerPool.setMaxConcurrency(this.baselineConcurrency);
			}
		} else {
			this.consecutiveSuccess = 0;
		}

		return this.getReport(now);
	}

	/**
	 * 查询冷却期限；调用方负责等待，不阻塞执行
	 */
	public isInCooldown(now: number = Date.now()): boolean {
		return now < this.cooldownUntil;
	}

	/**
	 * 获取当前动态并发窗口
	 */
	public getCurrentWindow(): number {
		return this.currentWindow;
	}

	/**
	 * 获取自适应流控完整遥测报告
	 */
	public getReport(now: number = Date.now()): ThrottleReport {
		const remaining = Math.max(0, this.cooldownUntil - now);
		return {
			state: this.currentState,
			currentWindow: this.currentWindow,
			baselineWindow: this.baselineConcurrency,
			inCooldown: remaining > 0,
			cooldownRemainingMs: remaining,
			consecutiveSuccess: this.consecutiveSuccess,
			recoveryThreshold: this.recoveryThreshold,
			lastTriggerReason: this.lastTriggerReason,
		};
	}

	/**
	 * 重置清空流控状态
	 */
	public reset(): void {
		this.currentState = "normal";
		this.currentWindow = this.baselineConcurrency;
		this.consecutiveSuccess = 0;
		this.cooldownUntil = 0;
		this.lastTriggerReason = undefined;
		globalWorkerPool.setMaxConcurrency(this.baselineConcurrency);
	}

}

// 导出全局单例
export const globalAdaptiveThrottler = new AdaptiveThrottler({
	baselineConcurrency: 2,
	cooldownMs: 3000,
	recoveryThreshold: 10,
});
