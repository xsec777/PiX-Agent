/**
 * worker-pool.ts — 基于 Pi SDK 内存级 In-Process Sub-Session 的 WorkerPool 调度引擎 (ADR 0001/0002/0004)
 *
 * 核心职责：
 * 1. 物理隔离：管理主控 Planner 与 Worker 子会话之间的并发槽位与内存生命周期；
 * 2. 槽位调度：动态分配与维护有限并发窗口 (ConcurrencyWindow, 默认 2~3)；
 * 3. 槽位遥测：实时跟踪每个 Worker 槽位的执行时长、当前动作、轮次硬顶及状态机跃迁；
 * 4. 动态扩缩：支持自适应流控 (AdaptiveThrottle) 动态伸缩并发窗口大小。
 */

export type WorkerSlotStatus = "idle" | "running" | "completed" | "failed" | "terminated";

export interface WorkerSlot {
	id: string; // 槽位 ID，如 "slot-1", "slot-2"
	workerId: string | null; // 绑定的当前 Worker 会话 ID
	status: WorkerSlotStatus; // 槽位运行状态
	endpointId: string | null; // 正在测试的端点 ID
	taskEnvelopeId: string | null; // 绑定的任务信封 ID
	targetHost: string | null; // 目标站点 Host (供 HostMutex 联动)
	modelTier: string; // 使用的模型档位 (FastTier / SmartTier)
	startTime: number | null; // 启动时间戳
	elapsedMs: number; // 已消耗时间 (ms)
	turnCount: number; // 当前已执行推理轮次
	currentAction: string; // 当前动作描述
}

export interface WorkerPoolConfig {
	maxConcurrency: number; // 默认最大并发槽位数 (基线 2)
	maxCapacity?: number; // 物理支持的最大槽位上限 (默认 4)
}

export interface WorkerPoolMetrics {
	totalSlots: number;
	activeSlots: number;
	idleSlots: number;
	maxConcurrency: number;
	completedCount: number;
	failedCount: number;
	totalDispatched: number;
}

export class WorkerPool {
	private slots: Map<string, WorkerSlot> = new Map();
	private maxConcurrency: number;
	private readonly maxCapacity: number;
	private completedCount = 0;
	private failedCount = 0;
	private totalDispatched = 0;

	constructor(config: WorkerPoolConfig = { maxConcurrency: 2, maxCapacity: 4 }) {
		this.maxConcurrency = Math.max(1, config.maxConcurrency);
		this.maxCapacity = Math.max(this.maxConcurrency, config.maxCapacity ?? 4);
		this.initializeSlots();
	}

	/**
	 * 初始化固定内存槽位
	 */
	private initializeSlots(): void {
		this.slots.clear();
		for (let i = 1; i <= this.maxCapacity; i++) {
			const slotId = `slot-${i}`;
			this.slots.set(slotId, {
				id: slotId,
				workerId: null,
				status: "idle",
				endpointId: null,
				taskEnvelopeId: null,
				targetHost: null,
				modelTier: "FastTier",
				startTime: null,
				elapsedMs: 0,
				turnCount: 0,
				currentAction: "等待派发任务",
			});
		}
	}

	/**
	 * 获取当前动态并发窗口上限
	 */
	public getMaxConcurrency(): number {
		return this.maxConcurrency;
	}

	/**
	 * 动态设置并发窗口（供 AdaptiveThrottle 遇阻单并发降级或恢复）
	 */
	public setMaxConcurrency(n: number): void {
		const clamped = Math.max(1, Math.min(n, this.maxCapacity));
		this.maxConcurrency = clamped;
	}

	/**
	 * 申请一个可用 Worker 槽位
	 * 若当前活跃 Worker 数已达到 maxConcurrency 或无空闲槽位，返回 null
	 */
	public acquireSlot(params: {
		workerId: string;
		endpointId: string;
		taskEnvelopeId?: string;
		targetHost?: string;
		modelTier?: string;
	}): WorkerSlot | null {
		if (!params.workerId.trim() || this.getSlotByWorkerId(params.workerId)) return null;
		const activeCount = this.getActiveSlots().length;
		if (activeCount >= this.maxConcurrency) {
			return null;
		}

		// 顺序查找首个 idle 状态且序号在 maxCapacity 范围内的槽位
		for (let i = 1; i <= this.maxCapacity; i++) {
			const slotId = `slot-${i}`;
			const slot = this.slots.get(slotId);
			if (slot && slot.status === "idle") {
				const now = Date.now();
				slot.workerId = params.workerId;
				slot.status = "running";
				slot.endpointId = params.endpointId;
				slot.taskEnvelopeId = params.taskEnvelopeId ?? null;
				slot.targetHost = params.targetHost ?? null;
				slot.modelTier = params.modelTier ?? "FastTier";
				slot.startTime = now;
				slot.elapsedMs = 0;
				slot.turnCount = 0;
				slot.currentAction = `初始化会话 [${params.endpointId}]`;
				this.totalDispatched++;
				return { ...slot };
			}
		}

		return null;
	}

	/**
	 * 更新指定 Worker 槽位的执行遥测状态
	 */
	public updateSlot(
		workerId: string,
		patch: Partial<Omit<WorkerSlot, "id" | "workerId" | "endpointId" | "taskEnvelopeId" | "targetHost">>,
	): WorkerSlot | null {
		for (const slot of this.slots.values()) {
			if (slot.workerId === workerId) {
				if (patch.status !== undefined) slot.status = patch.status;
				if (patch.currentAction !== undefined) slot.currentAction = patch.currentAction;
				if (patch.turnCount !== undefined) slot.turnCount = patch.turnCount;
					if (patch.modelTier !== undefined) slot.modelTier = patch.modelTier;

				if (slot.startTime) {
					slot.elapsedMs = Date.now() - slot.startTime;
				}
				return { ...slot };
			}
		}
		return null;
	}

	/**
	 * 释放并回收 Worker 槽位
	 */
	public releaseSlot(workerId: string, finalStatus: "completed" | "failed" | "terminated" = "completed"): boolean {
		for (const slot of this.slots.values()) {
			if (slot.workerId === workerId) {
				if (finalStatus === "completed") {
					this.completedCount++;
				} else {
					this.failedCount++;
				}
				// 重置为 idle 纯净态
				slot.workerId = null;
				slot.status = "idle";
				slot.endpointId = null;
				slot.taskEnvelopeId = null;
				slot.targetHost = null;
				slot.modelTier = "FastTier";
				slot.startTime = null;
				slot.elapsedMs = 0;
				slot.turnCount = 0;
				slot.currentAction = "等待派发任务";
				return true;
			}
		}
		return false;
	}

	/**
	 * 获取指定 Worker 绑定的槽位
	 */
	public getSlotByWorkerId(workerId: string): WorkerSlot | null {
		for (const slot of this.slots.values()) {
			if (slot.workerId === workerId) {
				if (slot.startTime && slot.status === "running") {
					slot.elapsedMs = Date.now() - slot.startTime;
				}
				return { ...slot };
			}
		}
		return null;
	}

	/**
	 * 获取指定槽位 ID 的快照
	 */
	public getSlot(slotId: string): WorkerSlot | null {
		const slot = this.slots.get(slotId);
		if (!slot) return null;
		if (slot.startTime && slot.status === "running") {
			slot.elapsedMs = Date.now() - slot.startTime;
		}
		return { ...slot };
	}

	/**
	 * 获取所有槽位的当前快照
	 */
	public getAllSlots(): WorkerSlot[] {
		const now = Date.now();
		return Array.from(this.slots.values()).map((slot) => {
			const elapsed = slot.startTime && slot.status === "running" ? now - slot.startTime : slot.elapsedMs;
			return { ...slot, elapsedMs: elapsed };
		});
	}

	/**
	 * 获取所有当前处于运行态的活跃槽位
	 */
	public getActiveSlots(): WorkerSlot[] {
		return this.getAllSlots().filter((s) => s.status === "running");
	}

	/**
	 * 获取全局调度池指标统计
	 */
	public getMetrics(): WorkerPoolMetrics {
		const all = this.getAllSlots();
		const active = all.filter((s) => s.status === "running").length;
		return {
			totalSlots: all.length,
			activeSlots: active,
			idleSlots: all.length - active,
			maxConcurrency: this.maxConcurrency,
			completedCount: this.completedCount,
			failedCount: this.failedCount,
			totalDispatched: this.totalDispatched,
		};
	}

	/**
	 * 彻底重置池状态（清理会话、单测用）
	 */
	public reset(): void {
		this.completedCount = 0;
		this.failedCount = 0;
		this.totalDispatched = 0;
		this.initializeSlots();
	}
}

// 导出全局单例
export const globalWorkerPool = new WorkerPool({ maxConcurrency: 2, maxCapacity: 4 });
