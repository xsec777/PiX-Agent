/**
 * concurrency.ts — 同进程内 Host 字符串互斥锁 (ADR 0004)
 *
 * 仅管理 trim/lowercase 后的键，不解析 DNS、合并别名或协调其他进程。
 * 锁只约束使用它的槽位调用方，不拦截网络请求，不保证无过载或不触发限流。
 */

export interface HostLock {
	readonly host: string;
	readonly workerId: string;
	readonly lockedAt: number;
}

export class HostMutex {
	private locks: Map<string, HostLock> = new Map();

	/**
	 * 规范化 HostKey (忽略大小写与去除首尾空白)
	 */
	public normalizeHost(rawHost: string): string {
		return rawHost.trim().toLowerCase();
	}

	/**
	 * 尝试锁定指定 Host
	 * 若当前 Host 已被其他 Worker 锁定，返回 false；若未被锁定或已被自身持有，返回 true
	 */
	public acquire(rawHost: string, workerId: string): boolean {
		const host = this.normalizeHost(rawHost);
		if (!host || !workerId.trim()) return false;
		const existing = this.locks.get(host);

		if (existing) {
			if (existing.workerId === workerId) {
				return true; // 自身重复加锁，幂等允许
			}
			// 已被其他 Worker 持有，互斥硬拦截
			return false;
		}

		this.locks.set(host, {
			host,
			workerId,
			lockedAt: Date.now(),
		});
		return true;
	}

	/**
	 * 释放指定 Host 的互斥锁
	 */
	public release(rawHost: string, workerId: string): boolean {
		const host = this.normalizeHost(rawHost);
		const existing = this.locks.get(host);

		if (!existing) return false;
		if (existing.workerId !== workerId) {
			// 非持有者无权释放其他 Worker 的互斥锁
			return false;
		}

		this.locks.delete(host);
		return true;
	}

	/**
	 * 释放指定 Worker 持有的全部站点锁 (会话销毁或异常收尾时兜底)
	 */
	public releaseByWorker(workerId: string): number {
		let count = 0;
		for (const [host, lock] of this.locks.entries()) {
			if (lock.workerId === workerId) {
				this.locks.delete(host);
				count++;
			}
		}
		return count;
	}

	/**
	 * 检查指定 Host 是否当前正处于锁定中
	 */
	public isLocked(rawHost: string): boolean {
		const host = this.normalizeHost(rawHost);
		return this.locks.has(host);
	}

	/**
	 * 获取当前持有该 Host 锁的 Worker ID
	 */
	public getOwner(rawHost: string): string | undefined {
		const host = this.normalizeHost(rawHost);
		return this.locks.get(host)?.workerId;
	}

	/**
	 * 获取当前全部活跃的站点锁快照
	 */
	public getAllLocks(): HostLock[] {
		return Array.from(this.locks.values()).map((l) => ({ ...l }));
	}

	/**
	 * 清空全部互斥锁 (用于测试与重开会话)
	 */
	public reset(): void {
		this.locks.clear();
	}
}

// 导出全局单例
export const globalHostMutex = new HostMutex();
