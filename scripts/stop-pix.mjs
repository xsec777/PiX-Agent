#!/usr/bin/env node
/**
 * stop-pix.mjs — 安全终止 PiX 服务与后台进程，释放端口
 */
import { execSync } from "node:child_process";

console.log("正在排查并关闭 PiX 服务与关联进程...");
const pidSet = new Set();
const currentPid = String(process.pid);

// 1. 查找监听 30141 端口的进程
try {
  const portOut = execSync(
    `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
    { encoding: "utf8" }
  );
  for (const p of portOut.split(/\s+/)) {
    const trimmed = p.trim();
    if (/^\d+$/.test(trimmed) && trimmed !== "0" && trimmed !== "4" && trimmed !== currentPid) {
      pidSet.add(trimmed);
    }
  }
} catch {}

// 2. 查找命令行含 pi-web 或 models-sync 的守护进程 (排除 powershell 自查进程与当前进程)
try {
  const cmdOut = execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -ne 'powershell.exe' -and $_.Name -ne 'pwsh.exe' -and $_.CommandLine -notmatch 'stop-pix' -and ($_.CommandLine -match 'pi-web\\.js|models-sync\\.mjs' -or $_.CommandLine -match 'next start') } | ForEach-Object { $_.ProcessId }"`,
    { encoding: "utf8" }
  );
  for (const p of cmdOut.split(/\s+/)) {
    const trimmed = p.trim();
    if (/^\d+$/.test(trimmed) && trimmed !== "0" && trimmed !== "4" && trimmed !== currentPid) {
      pidSet.add(trimmed);
    }
  }
} catch {}

if (pidSet.size === 0) {
  console.log("✓ 未检测到运行中的 PiX 服务，端口 30141 处于空闲就绪状态。");
  process.exit(0);
}

console.log(`发现运行中的 PiX 进程 PID: ${Array.from(pidSet).join(", ")}，正在关闭...`);
for (const pid of pidSet) {
  try {
    execSync(`taskkill /F /T /PID ${pid} >nul 2>&1`);
  } catch {}
}

// 再次确认端口是否释放
let stillInUse = false;
try {
  const check = execSync(
    `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
    { encoding: "utf8" }
  );
  if (/\d+/.test(check)) stillInUse = true;
} catch {}

if (stillInUse) {
  console.log("⚠ 端口 30141 仍被占用，可能需要管理员权限结束占用进程。");
} else {
  console.log("✓ 所有 PiX 进程已安全终止，端口 30141 释放完毕。");
}
