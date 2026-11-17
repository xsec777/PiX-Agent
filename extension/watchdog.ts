/**
 * watchdog.ts — Worker 轮次与墙钟阈值状态记录器 (ADR 0005)
 *
 * 此模块仅在调用 check/recordTurn 时计算阈值状态；不运行定时器、不取消会话或子进程，
 * 也不接入台账。因此 tripped 是状态结果，不代表执行已被终止或资源已回收。
 */

export type WatchdogStatus = "active" | "tripped_turns" | "tripped_timeout" | "cleared";

export interface WatchdogConfig {
	maxTurns?: number; // 默认 6 轮
	timeoutMs?: number; // 默认 180,000ms
}

export interface WatchdogEntry {
	readonly workerId: string;
	readonly taskEnvelopeId: string;
	readonly endpointId: string;
	readonly startTime: number;
	readonly maxTurns: number;
	readonly timeoutMs: number;
	turnCount: number;
	status: WatchdogStatus;
	trippedAt?: number;
	trippedReason?: string;
}

export interface WatchdogCheckResult {
	tripped: boolean;
	status: WatchdogStatus;
	reason?: string;
	turnCount: number;
	maxTurns: number;
	elapsedMs: number;
	timeoutMs: number;
}

export class WatchdogCeiling {
	private entries: Map<string, WatchdogEntry> = new Map();

	/**
	 * 登记一个 Worker 的阈值状态条目
	 */
	public register(params: {
		workerId: string;
		taskEnvelopeId: string;
		endpointId: string;
		maxTurns?: number;
		timeoutMs?: number;
		startTime?: number;
	}): WatchdogEntry {
		if (!params.workerId.trim()) throw new Error("[WatchdogCeiling] workerId 不能为空");
		if (this.entries.get(params.workerId)?.status === "active") {
			throw new Error("[WatchdogCeiling] Worker 已有活动监视器");
		}
		const entry: WatchdogEntry = {
			workerId: params.workerId,
			taskEnvelopeId: params.taskEnvelopeId,
			endpointId: params.endpointId,
			startTime: params.startTime ?? Date.now(),
			maxTurns: params.maxTurns ?? 6,
			timeoutMs: params.timeoutMs ?? 180000,
			turnCount: 0,
			status: "active",
		};
		this.entries.set(params.workerId, entry);
		return { ...entry };
	}

	/**
	 * 记录一次轮次，超过 maxTurns 时标记为 tripped_turns
	 */
	public recordTurn(workerId: string, now: number = Date.now()): WatchdogCheckResult {
		const entry = this.entries.get(workerId);
		if (!entry) {
			throw new Error(`[WatchdogCeiling] 未登记的 workerId: ${workerId}`);
		}

		if (entry.status !== "active") {
			return this.formatResult(entry, now);
		}

		entry.turnCount++;

		// 检查轮次硬顶 (若当前轮次已经超过设定的最大允许轮次)
		if (entry.turnCount > entry.maxTurns) {
			entry.status = "tripped_turns";
			entry.trippedAt = now;
			entry.trippedReason = `[WatchdogCeiling 轮次阈值超限] Worker 推理轮次达到 ${entry.turnCount} 轮，超过物理硬顶上限 (${entry.maxTurns} 轮)，记录超限状态；调用方负责停止与回收`;
			return this.formatResult(entry, now);
		}

		// 同时检查耗时硬顶
		const elapsed = now - entry.startTime;
		if (elapsed > entry.timeoutMs) {
			entry.status = "tripped_timeout";
			entry.trippedAt = now;
			entry.trippedReason = `[WatchdogCeiling 时间阈值超限] Worker 墙钟耗时达到 ${elapsed}ms，超过物理硬顶上限 (${entry.timeoutMs}ms)，记录超限状态；调用方负责停止与回收`;
			return this.formatResult(entry, now);
		}

		return this.formatResult(entry, now);
	}

	/**
	 * 检查指定 Worker 是否触发看门狗熔断 (轮次或超时)
	 */
	public check(workerId: string, now: number = Date.now()): WatchdogCheckResult {
		const entry = this.entries.get(workerId);
		if (!entry) {
			throw new Error(`[WatchdogCeiling] 未登记的 workerId: ${workerId}`);
		}

		if (entry.status === "active") {
			const elapsed = now - entry.startTime;
			if (elapsed > entry.timeoutMs) {
				entry.status = "tripped_timeout";
				entry.trippedAt = now;
				entry.trippedReason = `[WatchdogCeiling 时间阈值超限] Worker 墙钟耗时达到 ${elapsed}ms，超过物理硬顶上限 (${entry.timeoutMs}ms)，记录超限状态；调用方负责停止与回收`;
			} else if (entry.turnCount > entry.maxTurns) {
				entry.status = "tripped_turns";
				entry.trippedAt = now;
				entry.trippedReason = `[WatchdogCeiling 轮次阈值超限] Worker 推理轮次达到 ${entry.turnCount} 轮，超过物理硬顶上限 (${entry.maxTurns} 轮)，记录超限状态；调用方负责停止与回收`;
			}
		}

		return this.formatResult(entry, now);
	}

	/**
	 * Worker 正常调用 worker_submit 结案时解除看门狗注销
	 */
	public clear(workerId: string): boolean {
		const entry = this.entries.get(workerId);
		if (!entry) return false;
		entry.status = "cleared";
		return true;
	}

	/**
	 * 获取指定 Worker 看门狗条目
	 */
	public getEntry(workerId: string): WatchdogEntry | undefined {
		const entry = this.entries.get(workerId);
		return entry ? { ...entry } : undefined;
	}

	/**
	 * 获取所有当前处于熔断状态的 Worker 条目列表
	 */
	public getTrippedEntries(): WatchdogEntry[] {
		return Array.from(this.entries.values())
			.filter((e) => e.status === "tripped_turns" || e.status === "tripped_timeout")
			.map((e) => ({ ...e }));
	}

	/**
	 * 重置清空看门狗状态表 (用于测试与重开会话)
	 */
	public reset(): void {
		this.entries.clear();
	}

	private formatResult(entry: WatchdogEntry, now: number): WatchdogCheckResult {
		const isTripped = entry.status === "tripped_turns" || entry.status === "tripped_timeout";
		const elapsed = entry.trippedAt ? entry.trippedAt - entry.startTime : now - entry.startTime;
		return {
			tripped: isTripped,
			status: entry.status,
			reason: entry.trippedReason,
			turnCount: entry.turnCount,
			maxTurns: entry.maxTurns,
			elapsedMs: elapsed,
			timeoutMs: entry.timeoutMs,
		};
	}
}

// 导出全局单例
export const globalWatchdogCeiling = new WatchdogCeiling();
