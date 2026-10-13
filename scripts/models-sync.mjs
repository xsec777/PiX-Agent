#!/usr/bin/env node
/**
 * PiX：models-store.json 幽灵缓存同步
 *
 * 问题：在 pi-web 里删除服务商时，只删了 models.json，
 *       pi 的模型目录缓存 models-store.json 里对应 key 会残留，
 *       导致模型选择器出现已删服务商的"幽灵"模型。
 *
 * 本脚本监听 ~/.pi/agent 目录，一旦 models.json 变化，
 * 自动把 models-store.json 里不属于现存服务商的 key 剪掉。
 *
 * 用法：
 *   node models-sync.mjs            剪枝一次后退出
 *   node models-sync.mjs --watch    持续监听（配合 pi-web 使用）
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const agentDir = path.join(os.homedir(), ".pi", "agent");
const modelsJson = path.join(agentDir, "models.json");
const storeJson = path.join(agentDir, "models-store.json");

function prune() {
  let providers;
  try {
    providers = Object.keys(JSON.parse(fs.readFileSync(modelsJson, "utf8")).providers || {});
  } catch {
    return false; // models.json 正被写入或暂不可读，下轮再试
  }
  if (!fs.existsSync(storeJson)) return false;
  let store;
  try {
    store = JSON.parse(fs.readFileSync(storeJson, "utf8"));
  } catch {
    return false;
  }
  const ghosts = Object.keys(store).filter((k) => !providers.includes(k));
  if (ghosts.length === 0) return false;
  for (const k of ghosts) delete store[k];
  const tmp = storeJson + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, storeJson);
  console.log(`[pix-sync] ${new Date().toLocaleTimeString()} 剪除幽灵缓存: ${ghosts.join(", ")}`);
  return true;
}

const pruned = prune();
if (process.argv.includes("--watch")) {
  console.log("[pix-sync] 监听中:", agentDir);
  let t = null;
  fs.watch(agentDir, (_, filename) => {
    if (filename !== "models.json") return;
    clearTimeout(t);
    t = setTimeout(prune, 500); // 防抖：等写入完成
  });
} else {
  console.log(pruned ? "[pix-sync] 剪枝完成（见上方明细）" : "[pix-sync] 无幽灵缓存");
}
