#!/usr/bin/env node
/**
 * ci-acceptance.mjs — PiX 一键验收（改良9：回归防线自动化）
 *
 * 流程：扩展一致性检查（install --status）→ 不一致自动部署（--no-patch）→
 *       acceptance 依赖安装（幂等）→ run-acceptance → 汇总退出码。
 *
 * 用法（仓库根目录）：
 *   node scripts/ci-acceptance.mjs               # 检查 + 部署 + 验收
 *   node scripts/ci-acceptance.mjs --no-deploy   # 只验收，不自动部署（不一致直接失败）
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACC = join(ROOT, "acceptance");
const args = process.argv.slice(2);
const AUTO_DEPLOY = !args.includes("--no-deploy");

console.log("== PiX 一键验收 ==");

// 1. 扩展一致性检查
console.log("\n[1/3] 扩展一致性检查（install --status）…");
const statusOut = spawnSync(process.execPath, [join(ROOT, "scripts", "install.mjs"), "--status"], { encoding: "utf8", cwd: ROOT }).stdout ?? "";
const consistent = /版本：与仓库源码一致/.test(statusOut);
if (!consistent && !AUTO_DEPLOY) {
	console.error("✗ 扩展与源码不一致，且 --no-deploy 禁止自动部署。先跑 node scripts/install.mjs");
	process.exit(1);
}
if (!consistent) {
	console.log("  → 检测到不一致，自动部署（install --no-patch）…");
	const dep = spawnSync(process.execPath, [join(ROOT, "scripts", "install.mjs"), "--no-patch"], { stdio: "inherit", cwd: ROOT });
	if (dep.status !== 0) { console.error("✗ 自动部署失败"); process.exit(1); }
} else {
	console.log("  → 一致 ✓");
}

// 2. acceptance 依赖（幂等）
console.log("\n[2/3] acceptance 依赖检查…");
if (!existsSync(join(ACC, "node_modules", "@earendil-works", "pi-ai"))) {
	execSync("npm install --no-fund --no-audit", { cwd: ACC, stdio: "inherit" });
} else {
	console.log("  → 已安装 ✓");
}

// 3. 跑验收
console.log("\n[3/3] run-acceptance…");
const r = spawnSync(process.execPath, [join(ACC, "run-acceptance.mjs")], { stdio: "inherit", cwd: ACC, timeout: 15 * 60 * 1000 });
const ok = r.status === 0;
console.log(`\n== 验收 ${ok ? "全部通过 ✅" : "有失败 ❌"}（退出码 ${r.status}）==`);
process.exit(ok ? 0 : 1);