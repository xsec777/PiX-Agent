#!/usr/bin/env node
/**
 * sessions-prune.mjs — pi-web 归档会话滚动清理（keep-100）
 *
 * 机制（实测 pi-web 存储）：
 *   state = ~/.pi/agent/pi-web-session-state.json → sessions{ <会话uuid>: {archivedAt} }（归档簿记）
 *   index = ~/.pi/agent/pi-web-session-index.json → entries{ <JSONL 绝对路径>: {fp, info} }（指纹缓存）
 *   uuid → JSONL 路径：index 键的文件名形如 <时间戳>_<uuid>.jsonl
 *
 * 行为：按 archivedAt 倒序保留最新 N（默认 100；--all=全删），超额项删除 JSONL 文件
 * 并双向清簿记。只碰有 archivedAt 的归档会话——活跃会话绝不触碰。
 * 默认 dry-run 预览；--exec 才真删；删除清单落 acceptance/scratch/prune-log.txt 可追溯。
 *
 * 用法：
 *   node scripts/sessions-prune.mjs                # dry-run 预览（keep 100）
 *   node scripts/sessions-prune.mjs --exec         # 执行（keep 100）
 *   node scripts/sessions-prune.mjs --all --exec   # 全删归档
 *   node scripts/sessions-prune.mjs --keep 50 --exec
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, appendFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "acceptance", "scratch", "prune-log.txt");

/** uuid → JSONL 路径（从 index 键文件名解析 <时间戳>_<uuid>.jsonl） */
function buildUuid2Path(index) {
	const map = new Map();
	for (const p of Object.keys(index.entries ?? {})) {
		const base = p.replace(/\\/g, "/").split("/").pop() ?? "";
		const dot = base.lastIndexOf(".");
		const stem = dot >= 0 ? base.slice(0, dot) : base;
		const us = stem.split("_").pop();
		if (us) map.set(us, p);
	}
	return map;
}

/**
 * 归档滚动清理。
 * @returns {{kept: number, deleted: Array<{uuid, path, firstMessage}>, missingFiles: number}}
 */
export function pruneArchived({ home = join(homedir(), ".pi", "agent"), keep = 100, exec = false, logFile = LOG } = {}) {
	const statePath = join(home, "pi-web-session-state.json");
	const indexPath = join(home, "pi-web-session-index.json");
	let state = { sessions: {} };
	try {
		state = JSON.parse(readFileSync(statePath, "utf8"));
	} catch {}
	let index = { entries: {} };
	try {
		index = JSON.parse(readFileSync(indexPath, "utf8"));
	} catch {}
	const uuid2path = buildUuid2Path(index);

	// 归档会话按 archivedAt 倒序
	const archived = Object.entries(state.sessions ?? {})
		.filter(([, v]) => v && typeof v.archivedAt === "number")
		.map(([uuid, v]) => ({ uuid, archivedAt: v.archivedAt, path: uuid2path.get(uuid) ?? null }))
		.sort((a, b) => b.archivedAt - a.archivedAt);

	const toDelete = keep === 0 ? archived : archived.slice(keep);
	const deleted = [];
	let missingFiles = 0;

	const preview = toDelete.map((item) => {
		const info = (item.path && index.entries?.[item.path]?.info) || {};
		return { uuid: item.uuid, path: item.path, firstMessage: (info.firstMessage ?? "").slice(0, 70) };
	});

	if (exec) {
		for (const item of toDelete) {
			const info = (item.path && index.entries?.[item.path]?.info) || {};
			// 1) 删 JSONL（找不到记数——可能已被手工删过）
			if (item.path && existsSync(item.path)) {
				try {
					unlinkSync(item.path);
				} catch {
					missingFiles += 1;
					continue; // 删不掉文件就不清簿记，保持一致性
				}
			} else {
				missingFiles += 1;
			}
			// 2) 双向清簿记
			delete state.sessions[item.uuid];
			if (item.path && index.entries?.[item.path]) delete index.entries[item.path];
			// 3) 日志（firstMessage 摘要可追溯）
			deleted.push({ uuid: item.uuid, path: item.path, firstMessage: info.firstMessage ?? "" });
		}
		// 原子写回 + revision 递增
		state.revision = (state.revision ?? 0) + 1;
		for (const [target, data] of [
			[statePath, state],
			[indexPath, index],
		]) {
			const tmp = target + ".tmp";
			writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
			renameSync(tmp, target);
		}
		if (deleted.length && existsSync(dirname(logFile))) {
			const ts = new Date().toISOString();
			appendFileSync(
				logFile,
				`[${ts}] exec keep=${keep} 删除 ${deleted.length} 个归档：\n` +
					deleted.map((d) => `  - ${d.uuid} ${(d.firstMessage || "").slice(0, 60).replace(/\n/g, " ")}`).join("\n") +
					"\n",
				"utf8",
			);
		}
	}

	return { kept: archived.length - (exec ? deleted.length : toDelete.length), deleted, missingFiles, archivedTotal: archived.length, preview };
}

// ---------- CLI ----------
const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const getArg = (k, d) => {
	const i = argv.indexOf(k);
	return i >= 0 ? argv[i + 1] : d;
};
if (process.argv[1] && process.argv[1].endsWith("sessions-prune.mjs")) {
	const exec = has("--exec");
	const keep = has("--all") ? 0 : Number(getArg("--keep", "100"));
	const r = pruneArchived({ keep, exec });
	const count = exec ? r.deleted.length : r.preview.length;
	console.log(
		`归档总数 ${r.archivedTotal} · 保留 ${r.kept} · ${exec ? "已删除" : "将删除（dry-run，加 --exec 执行）"} ${count} 个` +
			(exec && r.missingFiles ? ` · 文件缺失/不可删 ${r.missingFiles}` : ""),
	);
	for (const p of r.preview.slice(0, 10)) {
		console.log(`  - ${p.uuid.slice(0, 8)}… ${(p.firstMessage || "（无首条消息）").replace(/\n/g, " ")}`);
	}
	if (r.preview.length > 10) console.log(`  …共 ${r.preview.length} 项（完整清单见 ${LOG}）`);
}
