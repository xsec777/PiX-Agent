import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { CleanupRegistry } from "../extension/cleanup-watchdog.ts";

const root = mkdtempSync(join(tmpdir(), "pix-cleanup-fixture-"));
const child = spawn(process.execPath, ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "ignore"] });
try {
	await once(child.stdout!, "data");
	const registry = new CleanupRegistry(root);
	const file = join(root, "owned.tmp");
	const config = join(root, "owned-config.tmp");
	const changed = join(root, "changed.tmp");
	const removed = join(root, "already-removed.tmp");
	for (const path of [file, config, changed, removed]) writeFileSync(path, "fixture");
	registry.registerFile(file);
	registry.registerFile(config, "fixture config", "temp_config");
	registry.registerFile(changed);
	registry.registerFile(removed);
	unlinkSync(removed);
	writeFileSync(changed, "changed fixture content");
	registry.registerProcess(child);
	assert.throws(() => registry.registerProcess(child), /already registered/);
	assert.throws(() => registry.registerProcess(process.pid as unknown as ChildProcess), /ChildProcess/);
	assert.throws(() => registry.registerFile(root), /inside/);
	assert.throws(() => registry.registerFile(join(root, "..", "unowned.tmp")), /inside/);
	assert.throws(() => registry.registerPortForward(0), RangeError);
	registry.registerPortForward(12345);
	const snapshot = registry.getPendingItems();
	snapshot[0].status = "cleaned";
	assert.equal(registry.getPendingItems().length, 6);
	const summary = await registry.executeAllCleanup();
	assert.equal(summary.totalItems, 6);
	assert.equal(summary.cleanedCount, 4);
	assert.equal(summary.failedCount, 1);
	assert.equal(summary.skippedCount, 1);
	assert.ok(!existsSync(file) && !existsSync(config));
	assert.ok(existsSync(changed));
	assert.ok(child.exitCode !== null || child.signalCode !== null);
	assert.equal(summary.records.find((item) => item.target === changed)?.cleanedAt, undefined);
	assert.ok(summary.records.find((item) => item.target === changed)?.errorMessage?.includes("changed"));
	assert.equal((await registry.executeAllCleanup()).cleanedCount, 4);

	// A refused termination must be a failure, never reported as an exited process.
	const fake = Object.assign(new EventEmitter(), { pid: 999999, exitCode: null, signalCode: null, kill: () => false });
	const failures = new CleanupRegistry(root);
	failures.registerProcess(fake as unknown as ChildProcess);
	assert.equal((await failures.executeAllCleanup()).failedCount, 1);
	assert.equal(failures.getAllItems()[0].status, "failed");
} finally {
	if (child.exitCode === null && child.signalCode === null) {
		const exited = once(child, "exit");
		child.kill();
		await exited;
	}
	rmSync(root, { recursive: true, force: true });
}
console.log("Local cleanup ownership, child exit, failure, and audit checks passed.");
