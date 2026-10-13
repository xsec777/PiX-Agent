#!/usr/bin/env node
/**
 * bench-score.mjs — TSecBench 评测成绩单（维护者执行）
 *
 * 用法：node scripts/bench-score.mjs
 * 读取 ~/.pix/tsecbench.json 凭据，拉取挑战列表打印分系列成绩单。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cfg = JSON.parse(readFileSync(join(homedir(), ".pix", "tsecbench.json"), "utf8"));
const base = cfg.baseUrl.replace(/\/+$/, "");

const list = await fetch(`${base}/openapi/v1/challenges`, {
	headers: { BENCHMARK_TOKEN: cfg.token },
	signal: AbortSignal.timeout(35000),
}).then((r) => r.json());

// 任务结束/过期时 API 返回 {code:"invalid_state", message:"task ... already finished"}
if (!Array.isArray(list)) {
	console.error("challenges API 未返回列表（评测任务可能已结束，需平台新开任务换 token）:");
	console.error(JSON.stringify(list, null, 2));
	process.exit(1);
}

const total = list.reduce((s, c) => s + c.total_score, 0);
const done = list.filter((c) => c.is_completed);
const score = done.reduce((s, c) => s + c.total_score, 0);

console.log(`== TSecBench 成绩单 ${new Date().toISOString().slice(0, 16).replace("T", " ")} ==`);
console.log(`总得分 ${score}/${total}（${list.length} 题 · 已完成 ${done.length}）\n`);

const series = new Map();
for (const c of list) {
	const key = c.unique_code.split("-")[0];
	if (!series.has(key)) series.set(key, { all: [], done: 0, max: 0, got: 0 });
	const s = series.get(key);
	s.all.push(c);
	s.max += c.total_score;
	if (c.is_completed) { s.done++; s.got += c.total_score; }
}
console.log("系列   完成     得分/满分   明细");
for (const [key, s] of series) {
	const marks = s.all.map((c) => (c.is_completed ? "●" : c.difficulty === "hard" ? "·h" : "·")).join(" ");
	console.log(`${key.padEnd(6)} ${String(s.done).padStart(2)}/${String(s.all.length).padEnd(3)}  ${String(s.got).padStart(5)}/${String(s.max).padEnd(5)}  ${marks}`);
}

const pending = list.filter((c) => !c.is_completed);
if (pending.length) {
	console.log(`\n待跑 ${pending.length} 题：${pending.slice(0, 8).map((c) => c.unique_code).join("、")}${pending.length > 8 ? " …" : ""}`);
}
