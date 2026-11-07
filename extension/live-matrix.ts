/**
 * live-matrix.ts — 实时攻防矩阵总线与快照原子双写引擎 (Live Matrix Bus)
 *
 * 核心功能：
 * 1. 内存 500ms 防抖更新队列：避免高频扫描工具（dirsearch/ffuf）触发大量磁盘写 I/O；
 * 2. 原子防撕裂落盘：写入 cwd/pix-live-matrix.json.tmp 并原子重命名至 cwd/pix-live-matrix.json；
 * 3. 统计指标与当前测试焦点聚合，供外部 Web UI、SSE 服务与终端看板消费；
 * 4. 导出 readLiveMatrixSnapshot / emitMatrixUpdate / flushLiveMatrix。
 */

import { writeFileSync, renameSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
	getAllHosts,
	getAllEndpoints,
	getMatrixMetrics,
	getPendingEndpointsQueue,
	type HostNode,
	type EndpointNode,
	type MatrixMetrics,
} from "./state.ts";

export interface LiveMatrixSnapshot {
	version: string;
	updatedAt: string;
	lastSource: string;
	metrics: MatrixMetrics;
	currentFocus: EndpointNode | null;
	hosts: HostNode[];
	endpoints: EndpointNode[];
}

let debounceTimer: NodeJS.Timeout | null = null;
let pendingSource = "initial";

export function emitMatrixUpdate(source = "state_change"): void {
	pendingSource = source;
	if (debounceTimer) return;
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		flushLiveMatrix(pendingSource);
	}, 500);
}

export function flushLiveMatrix(source = "manual"): LiveMatrixSnapshot | null {
	try {
		const cwd = process.cwd();
		const targetFile = join(cwd, "pix-live-matrix.json");
		const tmpFile = join(cwd, `pix-live-matrix.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`);

		const metrics = getMatrixMetrics();
		const pendingQueue = getPendingEndpointsQueue(1);
		const currentFocus = pendingQueue.length > 0 ? pendingQueue[0] : null;

		const snapshot: LiveMatrixSnapshot = {
			version: "2.0.3",
			updatedAt: new Date().toISOString(),
			lastSource: source,
			metrics,
			currentFocus,
			hosts: getAllHosts(),
			endpoints: getAllEndpoints(),
		};

		writeFileSync(tmpFile, JSON.stringify(snapshot, null, 2), "utf8");
		renameSync(tmpFile, targetFile);
		return snapshot;
	} catch {
		// 容错处理：Windows 下若目标文件被独占，重试一次同步覆盖
		try {
			const fallbackFile = join(process.cwd(), "pix-live-matrix.json");
			const snapshot: LiveMatrixSnapshot = {
				version: "2.0.3",
				updatedAt: new Date().toISOString(),
				lastSource: source,
				metrics: getMatrixMetrics(),
				currentFocus: getPendingEndpointsQueue(1)[0] || null,
				hosts: getAllHosts(),
				endpoints: getAllEndpoints(),
			};
			writeFileSync(fallbackFile, JSON.stringify(snapshot, null, 2), "utf8");
			return snapshot;
		} catch {
			return null;
		}
	}
}

export function readLiveMatrixSnapshot(): LiveMatrixSnapshot | null {
	try {
		const p = join(process.cwd(), "pix-live-matrix.json");
		if (!existsSync(p)) return null;
		return JSON.parse(readFileSync(p, "utf8"));
	} catch {
		return null;
	}
}
