/** Explicit local-resource cleanup. No remote operations or automatic exit hooks. */
import { lstatSync, realpathSync, unlinkSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ChildProcess } from "node:child_process";

export type CleanupItemType = "file" | "process" | "port_forward" | "temp_config";
export type CleanupItemStatus = "registered" | "cleaned" | "failed" | "skipped";

export interface CleanupItem {
	readonly id: string;
	readonly type: CleanupItemType;
	readonly target: string;
	readonly description: string;
	readonly registeredAt: number;
	status: CleanupItemStatus;
	cleanedAt?: number;
	errorMessage?: string;
}

export interface CleanupSummary {
	readonly totalItems: number;
	readonly cleanedCount: number;
	readonly failedCount: number;
	readonly skippedCount: number;
	readonly successRate: number;
	readonly records: readonly CleanupItem[];
}

type FileIdentity = { dev: number; ino: number; size: number; mtimeMs: number };

export class CleanupRegistry {
	private readonly root: string;
	private readonly items = new Map<string, CleanupItem>();
	private readonly files = new Map<string, FileIdentity>();
	private readonly children = new Map<string, ChildProcess>();
	private counter = 0;
	private running = false;

	constructor(root: string) {
		if (!isAbsolute(root)) throw new Error("cleanup root must be absolute");
		this.root = realpathSync(root);
		if (!lstatSync(this.root).isDirectory()) throw new Error("cleanup root must be a directory");
	}

	private add(type: CleanupItemType, target: string, description: string): string {
		if (this.running) throw new Error("cleanup already running");
		const id = `clean-${type}-${++this.counter}`;
		this.items.set(id, { id, type, target, description, registeredAt: Date.now(), status: "registered" });
		return id;
	}

	private checkFile(path: string): void {
		const rel = relative(this.root, path);
		if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
			throw new Error("file must be inside the cleanup root");
		}
		const actual = realpathSync(path);
		if (actual !== path || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) {
			throw new Error("only ordinary files without symlink components may be registered");
		}
	}

	public registerFile(filePath: string, description = "owned temporary file", type: "file" | "temp_config" = "file"): string {
		const path = resolve(this.root, filePath);
		this.checkFile(path);
		const stat = lstatSync(path);
		const id = this.add(type, path, description);
		this.files.set(id, { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs });
		return id;
	}

	/** Caller must pass the actual ChildProcess it created, never a numeric PID. */
	public registerProcess(child: ChildProcess, description = "owned child process"): string {
		if (!child || typeof child.kill !== "function" || typeof child.once !== "function" || child.pid === undefined || child.pid === process.pid) {
			throw new Error("an owned ChildProcess handle is required");
		}
		if ([...this.children.values()].includes(child)) throw new Error("child already registered");
		const id = this.add("process", String(child.pid), description);
		this.children.set(id, child);
		return id;
	}

	public registerPortForward(port: number, description = "port requiring manual cleanup"): string {
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("invalid port");
		return this.add("port_forward", String(port), description);
	}

	public getAllItems(): CleanupItem[] {
		return [...this.items.values()].map((item) => ({ ...item }));
	}

	public getPendingItems(): CleanupItem[] {
		return this.getAllItems().filter((item) => item.status === "registered");
	}

	private async stopChild(child: ChildProcess, timeoutMs: number): Promise<void> {
		if (child.exitCode !== null || child.signalCode !== null) return;
		await new Promise<void>((done, fail) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (error?: Error) => {
				if (timer) clearTimeout(timer);
				child.removeListener("exit", onExit);
				child.removeListener("error", onError);
				if (error) fail(error); else done();
			};
			const onExit = () => finish();
			const onError = (error: Error) => finish(error);
			child.once("exit", onExit);
			child.once("error", onError);
			timer = setTimeout(() => finish(new Error("child exit was not confirmed before timeout")), timeoutMs);
			try {
				if (!child.kill("SIGTERM")) finish(new Error("child termination request was rejected"));
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	/** Explicitly invoke and await. Failed/skipped items remain visible and may be retried. */
	public async executeAllCleanup(timeoutMs = 2000): Promise<CleanupSummary> {
		if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new RangeError("invalid cleanup timeout");
		if (this.running) throw new Error("cleanup already running");
		this.running = true;
		try {
			for (const item of [...this.items.values()].reverse()) {
				if (item.status === "cleaned") continue;
				item.errorMessage = undefined;
				try {
					if (item.type === "file" || item.type === "temp_config") {
						try {
							this.checkFile(item.target);
							const current = lstatSync(item.target);
							const original = this.files.get(item.id)!;
							if (current.dev !== original.dev || current.ino !== original.ino || current.size !== original.size || current.mtimeMs !== original.mtimeMs) {
								throw new Error("registered file changed; refusing deletion");
							}
							unlinkSync(item.target);
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
						}
					} else if (item.type === "process") {
						await this.stopChild(this.children.get(item.id)!, timeoutMs);
					} else {
						item.status = "skipped";
						item.errorMessage = "port forwarding removal is not implemented";
						continue;
					}
					item.status = "cleaned";
					item.cleanedAt = Date.now();
				} catch (error) {
					item.status = "failed";
					item.errorMessage = error instanceof Error ? error.message : String(error);
				}
			}
		} finally {
			this.running = false;
		}
		const records = this.getAllItems();
		const cleanedCount = records.filter((item) => item.status === "cleaned").length;
		return {
			totalItems: records.length,
			cleanedCount,
			failedCount: records.filter((item) => item.status === "failed").length,
			skippedCount: records.filter((item) => item.status === "skipped").length,
			successRate: records.length ? Math.round(cleanedCount / records.length * 100) : 100,
			records,
		};
	}
}
