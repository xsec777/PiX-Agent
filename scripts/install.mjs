#!/usr/bin/env node
/**
 * PiX 安装脚本 — 把 PiX 装进本机 pi Agent
 *
 * 用法（仓库根目录执行）：
 *   node scripts/install.mjs              # 安装/更新扩展 + pi-web 补丁（默认全做）
 *   node scripts/install.mjs --no-patch   # 只装扩展，跳过 pi-web 补丁
 *   node scripts/install.mjs --status     # 查看安装状态
 *
 * 动作：
 *   1. 把 extension/*.ts + package*.json 复制到 ~/.pi/agent/extensions/pix/
 *      （依赖 typebox：目标目录没有 node_modules 时自动 npm install）
 *   2. pi-web 补丁（默认执行，幂等，升级 pi-web 后重跑 install.mjs 即可）：
 *      推理级别菜单固定为 auto/low/medium/high（PiX 出厂行为）
 *
 * 不做（用户自主）：
 *   - 不写 mcp.json（burp / chrome-devtools 等推荐 MCP 见 README §MCP）
 *   - 不装 skill（三大渗透技能包按 README §技能 自行接入）
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execSync, spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT_SRC = join(ROOT, "extension");
const EXT_DST = join(homedir(), ".pi", "agent", "extensions", "pix");
const FILES = ["index.ts", "state.ts", "rules.ts", "pacing.ts", "guard.ts", "gate.ts", "sensor.ts", "mirror.ts", "toolbox.ts", "toolbox-data.ts", "report.ts", "package.json", "package-lock.json"];

/** 路径配置链（改良8）：install 时把实际仓库 tools 根写入 pix-config.json，跨机分发零手工 */
function writePixConfig() {
	const cfg = {
		toolsRoot: join(ROOT, "tools").replace(/\\/g, "\\\\"),
		py310: process.env.PIX_PY310 ?? "E:\\env\\python3106\\python.exe",
	};
	writeFileSync(join(EXT_DST, "pix-config.json"), JSON.stringify(cfg, null, 2), "utf8");
	console.log(`✓ pix-config.json 已写入（toolsRoot=${cfg.toolsRoot}）`);
}

function status() {
	console.log("== PiX 安装状态 ==");
	if (existsSync(EXT_DST)) {
		const installed = FILES.filter((f) => existsSync(join(EXT_DST, f)));
		console.log(`扩展目录: ${EXT_DST}（${installed.length}/${FILES.length} 文件）`);
		let stale = false;
		for (const f of FILES) {
			const src = join(EXT_SRC, f);
			const dst = join(EXT_DST, f);
			if (existsSync(src) && existsSync(dst) && readFileSync(src, "utf8") !== readFileSync(dst, "utf8")) {
				stale = true;
				console.log(`  过期: ${f}（源码已更新，重跑 install.mjs 同步）`);
			}
		}
		if (!stale) console.log("  版本：与仓库源码一致 ✓");
	} else {
		console.log(`扩展目录: 未安装（${EXT_DST} 不存在）`);
	}
}

function installExt() {
	mkdirSync(EXT_DST, { recursive: true });
	for (const f of FILES) {
		const src = join(EXT_SRC, f);
		if (!existsSync(src)) throw new Error(`源文件缺失: ${src}`);
		mkdirSync(dirname(join(EXT_DST, f)), { recursive: true });
		cpSync(src, join(EXT_DST, f));
	}
	if (!existsSync(join(EXT_DST, "node_modules", "typebox"))) {
		console.log("安装扩展依赖（typebox）…");
		execSync("npm install --no-fund --no-audit", { cwd: EXT_DST, stdio: "inherit" });
	}
	writePixConfig();
	console.log(`✓ 扩展已安装到 ${EXT_DST}`);
	console.log("  重启 pi / pi-web 后生效；启动通知应显示「PiX 已加载」");
}

function patchWeb() {
	const script = join(ROOT, "scripts", "patch-piweb.py");
	try {
		execSync(`python "${script}"`, { stdio: "inherit" });
	} catch {
		console.error("pi-web 补丁失败：确认已安装 Python 与 @agegr/pi-web，或查看 scripts/patch-piweb.py");
		process.exitCode = 1;
	}
	// F8 根因防护：磁盘补了但运行中的 pi-web 内存里还是旧 build
	if (process.argv.includes("--restart-piweb")) {
		restartPiweb();
	} else {
		console.log("提示：若 pi-web 正在运行，需重启 + 浏览器强刷才能看到新推理菜单（或直接用 --restart-piweb）");
	}
}

/** 杀掉 pi-web 进程链（sh 启动器 / node pi-web.js / next start 子进程——按端口 owner + cmdline 双保险） */
function restartPiweb() {
	try {
		const pidSet = new Set();
		// ① 端口 owner（next start 子进程 cmdline 里没有 "pi-web" 字样，2026-10-13 实锤旧 next server
		//    占着 30141 杀不掉、新进程起不来、页面永远旧 build）
		try {
			const portOut = execSync(
				`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
				{ encoding: "utf8", shell: false },
			);
			for (const p of portOut.split(/\s+/)) if (/^\d+$/.test(p)) pidSet.add(p);
		} catch {}
		// ② cmdline 兜底（壳进程 + 可能改名的情况）
		const out = execSync(
			`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pi-web|next start' } | ForEach-Object { $_.ProcessId }"`,
			{ encoding: "utf8", shell: false },
		);
		for (const p of out.split(/\s+/)) if (/^\d+$/.test(p)) pidSet.add(p);
		const pids = [...pidSet];
		if (pids.length === 0) {
			console.log("pi-web 未在运行，无需重启（启动用 scripts/pix-web.cmd）");
			return;
		}
		for (const pid of pids) {
			spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore", shell: false });
		}
		console.log(`已停止 pi-web 进程链（${pids.length} 个 PID：${pids.join(",")}）。重新启动：scripts/pix-web.cmd，然后浏览器强刷。`);
	} catch (e) {
		console.error("重启 pi-web 失败：", e.message);
		process.exitCode = 1;
	}
}

const arg = process.argv[2] ?? "";
if (arg === "--status") status();
else if (arg === "--no-patch") installExt();
else if (arg === "--restart-piweb") {
	installExt();
	patchWeb(); // 含 --restart-piweb 分支
} else if (arg === "") {
	installExt();
	patchWeb();
} else {
	console.error("用法: node scripts/install.mjs [--no-patch | --status]");
	process.exitCode = 1;
}
