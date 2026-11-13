#!/usr/bin/env node
/**
 * pix-doctor.mjs — 运行环境与网络驱动健康巡检诊断工具 (Environment Doctor)
 *
 * 核心功能：
 * 1. 一键全自动巡检宿主机关键依赖：Node.js、Python、Git、Npcap 驱动、端口占用与扩展文件完整性；
 * 2. 格式化输出终端色彩诊断体检表，针对异常项直接输出可复制的修复指令；
 * 3. 给出确定性的系统退出状态码 (exit code 0 / 1)，完美契合自动化 CI/CD 与部署自检。
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
};

/** @type {Array<{ name: string; category: string; status: 'pass'|'warn'|'fail'; current: string; recommendation?: string }>} */
const report = [];

console.log(`${ANSI.bold}🛡️  PiX 渗透测试智能体 · 运行环境健康巡检 (pix-doctor)${ANSI.reset}`);
console.log(`${ANSI.dim}========================================================${ANSI.reset}\n`);

// 1. 检查 Node.js 版本 (要求 >= 20, 推荐 >= 22)
const nodeVer = process.version;
const major = Number.parseInt(nodeVer.replace("v", "").split(".")[0], 10);
if (major >= 22) {
	report.push({ name: "Node.js 运行时", category: "runtime", status: "pass", current: `${nodeVer} (满足 >= 22.0)` });
} else if (major >= 20) {
	report.push({ name: "Node.js 运行时", category: "runtime", status: "warn", current: `${nodeVer} (建议升级至 Node 22+)`, recommendation: "winget install OpenJS.NodeJS.LTS" });
} else {
	report.push({ name: "Node.js 运行时", category: "runtime", status: "fail", current: `${nodeVer} (过低，要求 >= 20)`, recommendation: "winget install OpenJS.NodeJS.LTS" });
}

// 2. 检查 Python 运行时与可用性
try {
	const pyRes = spawnSync("python", ["--version"], { encoding: "utf8" });
	const out = (pyRes.stdout || pyRes.stderr || "").trim();
	if (out.includes("Python 3.")) {
		report.push({ name: "Python 运行时", category: "runtime", status: "pass", current: out });
	} else {
		report.push({ name: "Python 运行时", category: "runtime", status: "warn", current: "未检测到 Python 3", recommendation: "winget install Python.Python.3.10" });
	}
} catch {
	report.push({ name: "Python 运行时", category: "runtime", status: "warn", current: "命令不可达", recommendation: "将 python 添加入系统环境变量 PATH" });
}

// 3. 检查 Git 环境与用户信息
try {
	const gitVer = execSync("git --version", { encoding: "utf8" }).trim();
	report.push({ name: "Git 客户端", category: "runtime", status: "pass", current: gitVer });
} catch {
	report.push({ name: "Git 客户端", category: "runtime", status: "fail", current: "未安装或 PATH 缺失", recommendation: "winget install Git.Git" });
}

// 4. 检查 Npcap / WinPcap 网卡底层抓包驱动 (Windows 下 nmap/masscan 必备)
if (process.platform === "win32") {
	const npcapSys = "C:\\Windows\\System32\\Npcap";
	const winpcapDll = "C:\\Windows\\System32\\wpcap.dll";
	if (fs.existsSync(npcapSys) || fs.existsSync(winpcapDll)) {
		report.push({ name: "Npcap 抓包驱动", category: "driver", status: "pass", current: "已检测到底层驱动就绪" });
	} else {
		report.push({ name: "Npcap 抓包驱动", category: "driver", status: "warn", current: "未检测到驱动（SYN 扫描受限）", recommendation: "访问 https://npcap.com/#download 下载安装 (勾选 WinPcap 兼容)" });
	}
}

// 5. 检查端口占用 (30141 主服务与 30142 矩阵服务)
async function testPort(port) {
	return new Promise((resolve) => {
		const s = net.createServer();
		s.once("error", (err) => {
			if (err.code === "EADDRINUSE") resolve(false);
			else resolve(true);
		});
		s.once("listening", () => {
			s.close(() => resolve(true));
		});
		s.listen(port, "127.0.0.1");
	});
}

const p30141Ok = await testPort(30141);
report.push({
	name: "端口 30141 (主控制台)",
	category: "network",
	status: p30141Ok ? "pass" : "warn",
	current: p30141Ok ? "空闲就绪" : "已被占用 (当前可能有已在运行的实例)",
	recommendation: p30141Ok ? undefined : "双击运行 PiX-Stop.cmd 释放端口",
});

const p30142Ok = await testPort(30142);
report.push({
	name: "端口 30142 (矩阵大屏)",
	category: "network",
	status: p30142Ok ? "pass" : "warn",
	current: p30142Ok ? "空闲就绪" : "已被占用",
	recommendation: p30142Ok ? undefined : "双击运行 PiX-Stop.cmd 释放端口",
});

// 6. 检查核心扩展文件完整性
const coreFiles = [
	"extension/index.ts",
	"extension/state.ts",
	"extension/rules.ts",
	"extension/sniffer.ts",
	"extension/live-matrix.ts",
	"extension/matrix-view.ts",
	"extension/artifacts.ts",
	"extension/gate.ts",
	"extension/verifier.ts",
	"extension/mutator.ts",
	"extension/pivot-router.ts",
	"extension/cred-vault.ts",
	"extension/toolbox-data.ts",
];

const missing = coreFiles.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length === 0) {
	report.push({ name: "核心扩展文件完整性", category: "integrity", status: "pass", current: `${coreFiles.length}/${coreFiles.length} 模块齐全` });
} else {
	report.push({ name: "核心扩展文件完整性", category: "integrity", status: "fail", current: `缺失 ${missing.join(", ")}`, recommendation: "重新同步仓库源码" });
}

// 输出巡检大表
let hasFail = false;
for (const item of report) {
	let icon = `${ANSI.green}✓ PASS${ANSI.reset}`;
	if (item.status === "warn") icon = `${ANSI.yellow}⚠ WARN${ANSI.reset}`;
	if (item.status === "fail") {
		icon = `${ANSI.red}✗ FAIL${ANSI.reset}`;
		hasFail = true;
	}

	console.log(`[${icon}] ${ANSI.bold}${item.name.padEnd(20)}${ANSI.reset} : ${item.current}`);
	if (item.recommendation) {
		console.log(`       ${ANSI.cyan}↳ 修复建议: ${item.recommendation}${ANSI.reset}`);
	}
}

console.log(`\n${ANSI.dim}========================================================${ANSI.reset}`);
if (hasFail) {
	console.log(`${ANSI.red}${ANSI.bold}体检未通过：存在严重阻碍项，请根据上述建议修复后重试。${ANSI.reset}\n`);
	process.exit(1);
} else {
	console.log(`${ANSI.green}${ANSI.bold}体检完成：运行环境健康，随时可拉起 PiX 发起渗透测试！${ANSI.reset}\n`);
	process.exit(0);
}
