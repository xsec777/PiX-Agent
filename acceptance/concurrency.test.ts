/**
 * concurrency.test.ts — HostMutex 站点互斥锁机制验收套件 (ADR 0004)
 */

import assert from "node:assert/strict";
import { HostMutex, globalHostMutex } from "../extension/concurrency.ts";
import { WorkerPool } from "../extension/worker-pool.ts";

console.log("==================================================================");
console.log("🛡️  PiX-Pacing: HostMutex 站点互斥锁机制断言套件 (v3.1.0)");
console.log("==================================================================\n");

// 1. HostMutex 基础锁定与所有者
console.log("[断言 1/5] HostMutex 基础加锁与所有者追踪...");
const mutex = new HostMutex();
const lock1 = mutex.acquire("api.corp.local", "worker-01");
assert.ok(lock1 === true, "首次加锁应成功返回 true");
assert.ok(mutex.isLocked("api.corp.local") === true, "站点应标记为锁定");
assert.ok(mutex.getOwner("api.corp.local") === "worker-01", "所有者应为 worker-01");

// 相同 Worker 再次加锁应幂等放行
assert.ok(mutex.acquire("api.corp.local", "worker-01") === true, "同 Worker 幂等加锁应成功");
console.log("  → 通过 ✓");

// 2. 同站点多 Worker 互斥硬拦截 (ADR 0004 发包安全红线)
console.log("[断言 2/5] 同一站点多 Worker 发包互斥硬拦截...");
const lockConflict = mutex.acquire("api.corp.local", "worker-02");
assert.ok(lockConflict === false, "不同 Worker 对同一站点加锁必须被硬拦截 (返回 false)");
assert.ok(mutex.getOwner("api.corp.local") === "worker-01", "所有者仍应保持为 worker-01");

// 大小写与首尾空格不敏感归一化
assert.ok(mutex.acquire("  API.corp.LOCAL  ", "worker-03") === false, "大小写变体必须严格互斥");
console.log("  → 通过 ✓");

// 3. 跨独立站点安全并发
console.log("[断言 3/5] 跨独立站点/子域安全并发验证...");
const lockSiteB = mutex.acquire("auth.corp.local", "worker-02");
const lockSiteC = mutex.acquire("pay.corp.local", "worker-03");
assert.ok(lockSiteB === true, "不同站点 auth.corp.local 应允许安全并发加锁");
assert.ok(lockSiteC === true, "不同站点 pay.corp.local 应允许安全并发加锁");
assert.ok(mutex.getAllLocks().length === 3, "当前应记录 3 个活跃独立站点锁");
console.log("  → 通过 ✓");

// 4. 站点锁释放与重新获取
console.log("[断言 4/5] 站点锁释放与后续 Worker 排队唤醒...");
// 非持有者无权释放
assert.ok(mutex.release("api.corp.local", "worker-02") === false, "非持有者尝试释放应被拦截");
// 持有者正常释放
assert.ok(mutex.release("api.corp.local", "worker-01") === true, "持有者释放应成功");
assert.ok(mutex.isLocked("api.corp.local") === false, "释放后站点应变为空闲");

// 此时 worker-02 应能成功锁定
assert.ok(mutex.acquire("api.corp.local", "worker-02") === true, "空闲后排队 Worker 应可成功加锁");
console.log("  → 通过 ✓");

// 5. WorkerPool 调度池深度联动验证
console.log("[断言 5/5] WorkerPool 调度池联动 HostMutex 阻断与自动释放...");
globalHostMutex.reset();
const pool = new WorkerPool({ maxConcurrency: 3, maxCapacity: 4 });

// Worker A 申请 api.test.corp
const slotA = pool.acquireSlot({
	workerId: "w-pool-a",
	endpointId: "ep-a",
	targetHost: "api.test.corp",
});
assert.ok(slotA !== null, "Worker A 应成功分配槽位");
assert.ok(globalHostMutex.isLocked("api.test.corp") === true, "站点锁应自动加锁");

// Worker B 在并发窗口还有空闲 (1/3) 时，尝试再次申请同站点 api.test.corp
const slotB = pool.acquireSlot({
	workerId: "w-pool-b",
	endpointId: "ep-b",
	targetHost: "api.test.corp",
});
assert.ok(slotB === null, "即使槽位充足，同站点并发必须被 HostMutex 硬拦截，返回 null");

// Worker C 申请不同站点 admin.test.corp，应成功
const slotC = pool.acquireSlot({
	workerId: "w-pool-c",
	endpointId: "ep-c",
	targetHost: "admin.test.corp",
});
assert.ok(slotC !== null, "不同站点应成功分配槽位");

// 释放 Worker A，站点锁应自动清除
pool.releaseSlot("w-pool-a", "completed");
assert.ok(globalHostMutex.isLocked("api.test.corp") === false, "释放槽位应自动释放绑定的站点锁");

// 此时 Worker B 再次申请同站点，应成功
const slotBRetry = pool.acquireSlot({
	workerId: "w-pool-b",
	endpointId: "ep-b",
	targetHost: "api.test.corp",
});
assert.ok(slotBRetry !== null, "站点锁释放后 Worker B 应成功分配槽位");
console.log("  → 通过 ✓");

// A pool reset must only release its own locks.
const otherPool = new WorkerPool({ maxConcurrency: 1 });
assert.ok(otherPool.acquireSlot({ workerId: "other-pool", endpointId: "ep-other", targetHost: "other.example.test" }));
pool.reset();
assert.equal(globalHostMutex.isLocked("api.test.corp"), false);
assert.equal(globalHostMutex.isLocked("admin.test.corp"), false);
assert.equal(globalHostMutex.getOwner("other.example.test"), "other-pool");
otherPool.reset();
assert.equal(globalHostMutex.getAllLocks().length, 0);
assert.equal(mutex.acquire("  ", "worker-empty-host"), false);
assert.equal(mutex.acquire("empty.example.test", "  "), false);

console.log("==================================================================");
console.log("🎉  HostMutex 站点互斥锁机制全部 5 项断言 100% 绿色通过！");
console.log("==================================================================\n");
