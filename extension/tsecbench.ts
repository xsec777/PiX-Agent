/**
 * tsecbench.ts — 腾讯 TSecBench 评测靶场接入
 *
 * 协议细节以腾讯 TSecBench OpenAPI 实测核对为准
 *   平台 tsecbench.zc.tencent.com 本地模式 OpenAPI：
 *   {BASE_URL}/openapi/v1/challenges            GET  列题
 *   {BASE_URL}/openapi/v1/challenges/start      POST {unique_code}
 *   {BASE_URL}/openapi/v1/challenges/hint       GET  ?unique_code=
 *   {BASE_URL}/openapi/v1/challenges/submit      POST {unique_code, flag}
 *   {BASE_URL}/openapi/v1/challenges/close      POST {unique_code}
 *   鉴权：Header BENCHMARK_TOKEN；需平台 VPN。
 *
 * 凭据：~/.pix/tsecbench.json（{"baseUrl":"https://...","token":"..."}，0600）；
 *      环境变量 BENCHMARK_BASE_URL/BENCHMARK_TOKEN 作为回退。
 *      /tsecbench <baseUrl> <token> 命令写入。
 */

import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getState, persist } from "./state.ts";

const CONFIG_PATH = join(homedir(), ".pix", "tsecbench.json");
const API_TIMEOUT_MS = 35000;

interface TsecConfig {
	baseUrl: string;
	token: string;
}

function loadConfig(): TsecConfig | null {
	if (existsSync(CONFIG_PATH)) {
		try {
			const c = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
			if (c.baseUrl && c.token) return { baseUrl: c.baseUrl, token: c.token };
		} catch {}
	}
	const url = process.env.BENCHMARK_BASE_URL;
	const token = process.env.BENCHMARK_TOKEN;
	if (url && token) return { baseUrl: url, token };
	return null;
}

const GUIDE =
	"TSecBench 未配置。由用户执行：/tsecbench <平台下发的BASE_URL> <平台下发的TOKEN>（需平台 VPN 连接）。" +
	"配置来源：腾讯 TSecBench 评测平台（tsecbench.zc.tencent.com）本地模式接入页。";

/** 直调 OpenAPI（D7/A2 纠偏：Node fetch 默认不走系统代理，无需 trust_env；响应限 2MB 截断） */
async function api(config: TsecConfig, operation: string, params?: { uniqueCode?: string; flag?: string }): Promise<unknown> {
	const base = config.baseUrl.replace(/\/+$/, "");
	const headers: Record<string, string> = { BENCHMARK_TOKEN: config.token };
	let url = `${base}/openapi/v1/challenges`;
	let method = "GET";
	let body: string | undefined;

	if (operation === "challenges") {
		// GET 无参数
	} else if (operation === "hint") {
		method = "GET";
		url += `/hint?unique_code=${encodeURIComponent(params?.uniqueCode ?? "")}`;
	} else if (operation === "start" || operation === "close") {
		// POST + query 参数（平台 OpenAPI 约定，unique_code 不走 body）
		method = "POST";
		url += `/${operation}?unique_code=${encodeURIComponent(params?.uniqueCode ?? "")}`;
	} else if (operation === "submit") {
		method = "POST";
		headers["Content-Type"] = "application/json";
		url += "/submit";
		body = JSON.stringify({ unique_code: params?.uniqueCode ?? "", flag: params?.flag ?? "" });
	}
	const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
	const text = (await res.text()).slice(0, 2 * 1024 * 1024);
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`TSecBench 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`);
	}
	if (res.status >= 400) {
		// D3/A1：透传平台 message 原文（截断 300 字）——agent 可据实判断（如 409 平台常带"已启动过/容器地址"等关键上下文）
		const code = (data as { code?: string })?.code ?? "unknown";
		const message = (data as { message?: unknown })?.message;
		const msg = typeof message === "string" ? message.slice(0, 300) : "";
		throw new Error(`TSecBench HTTP ${res.status}: ${code}${msg ? `：${msg}` : ""}`);
	}
	return data;
}

function requireUniqueCode(v: unknown): string {
	const s = String(v ?? "").trim();
	if (s.length < 1 || s.length > 200) throw new Error("unique_code 需为 1-200 字符");
	return s;
}

/** 条件注册依据（TSecBench 已配置才挂 5 个评测工具，省上下文与选择噪声） */
export function isTsecbenchConfigured(): boolean {
	return loadConfig() !== null;
}

/** 错误提示状态感知：409 invalid_state ≠ 连接问题——曾误导 agent 一刀切"先查 VPN"。
 *  409 = 容器地址池冲突/状态残留（平台实测：地址被其他题容器占用即 409，非任务结束），
 *  无人值守场景按恢复剧本自救，不再"告知用户+勿重试"（a-02/c-02/b-01 三次成功恢复全靠主动重试）。 */
function errorHint(msg: string): string {
	if (/HTTP 409|invalid_state/i.test(msg)) {
		return "409 = 容器地址池冲突或状态残留（平台实测：地址被占用时 start 即 409，非任务结束）。" +
			"恢复剧本（无人值守跑批必须自救，勿停下等人工）：" +
			"① tsecbench_close(本题) 释放残留 ② 等待 30~60 秒 ③ tsecbench_start(本题) 重试，最多 3 轮；" +
			"3 轮仍 409 → record_fact(type=failure) 记录阻塞证据后待命。补充：若 challenges 显示本题 " +
			"container_status=available，说明容器已在跑——直接对已有 container_addr 续测，不要重复 start。";
	}
	if (/fetch failed|terminated|timeout|aborted|ECONN|ENOTFOUND|socket/i.test(msg)) {
		return "连接中断：先查 VPN 与 BASE_URL；已发送操作的结果未知，先核实现状再重试——不自动重发。";
	}
	return "已发送操作的结果未知，先核实现状再重试——不自动重发。";
}

export function registerTsecbench(pi: ExtensionAPI): void {
	// ---------- /tsecbench 配置命令 ----------
	pi.registerCommand("tsecbench", {
		description: "配置腾讯 TSecBench 评测接入（用法: /tsecbench <BASE_URL> <TOKEN>；/tsecbench status 查看状态）",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			if (parts[0] === "status") {
				const c = loadConfig();
				ctx.ui.notify(c ? `TSecBench 已配置（${c.baseUrl}）` : GUIDE, c ? "info" : "warning");
				return;
			}
			if (parts.length < 2 || !parts[0].startsWith("http")) {
				ctx.ui.notify("用法: /tsecbench <BASE_URL> <TOKEN>（平台下发，需 VPN）；/tsecbench status 查看状态", "warning");
				return;
			}
			writeFileSync(CONFIG_PATH, JSON.stringify({ baseUrl: parts[0], token: parts.slice(1).join(" ") }, null, 2), {
				mode: 0o600,
			});
			try {
				chmodSync(CONFIG_PATH, 0o600);
			} catch {
				// Windows ACL 差异，尽力而为
			}
			ctx.ui.notify(`TSecBench 已配置（${parts[0]}，凭据仅存本机 ${CONFIG_PATH}）。先 tsecbench_challenges 列题。`, "info");
		},
	});

	// ---------- 5 个工具 ----------
	const register = (
		operation: string,
		description: string,
		paramsSchema: object,
		extraCheck?: (args: Record<string, unknown>) => { uniqueCode?: string; flag?: string },
	) => {
		pi.registerTool({
			name: `tsecbench_${operation}`,
			label: `TSecBench ${operation}`,
			description,
			parameters: Type.Object(paramsSchema as never),
			async execute(_id, args) {
				const config = loadConfig();
				if (!config) return { content: [{ type: "text", text: GUIDE }], details: {} };
				try {
					const data = await api(config, operation, extraCheck?.(args));
					let text = JSON.stringify(data, null, 2);
					if (operation === "start") {
						// 突出 container_addr（任务唯一范围）并自动并入授权登记（范围约束从提示词升级为登记）
						// 平台返回 container_addr 为数组（如 ["10.0.1.1:80"]）——取首元素归一为字符串，防嵌套数组污染 auth.targets
						const raw = (data as { container_addr?: unknown })?.container_addr;
						const addr = Array.isArray(raw) ? String(raw[0] ?? "").trim() : typeof raw === "string" ? raw.trim() : "";
						if (addr) {
							text = `靶场已启动。任务范围（唯一授权目标）= ${addr}\n\n${text}`;
							const st = getState();
							const auth = st.auth ?? {
								targets: [],
								source: "TSecBench 评测（container_addr 为唯一细粒度范围）",
								recordedAt: new Date().toISOString(),
							};
							if (!auth.targets.includes(addr)) auth.targets.push(addr);
							st.auth = auth;
							persist(pi);
						}
					}
					if (operation === "submit") {
						text += "\n提醒：submit 后记得 tsecbench_close 释放评测资源；把题目与结果记入画板（record_fact type=finding）。";
					}
					return { content: [{ type: "text", text }], details: {} };
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return {
						content: [{ type: "text", text: `TSecBench ${operation} 失败：${msg}\n（${errorHint(msg)}）` }],
						details: {},
					};
				}
			},
		});
	};

	register("challenges", "列出当前 TSecBench 评测任务的题目与进度（唯一入口工具，其他 tsecbench_* 均需题目标识）。", {}, undefined);

	register("start", "启动指定题目的远端靶场（返回 container_addr 即本次唯一测试范围；禁打平台域名本身）。", { unique_code: Type.String({ description: "题目标识（来自 challenges 列表）" }) }, (a) => ({ uniqueCode: requireUniqueCode(a.unique_code) }));

	register("hint", "获取题目提示（平台会扣分，结合评测目标决定是否使用）。", { unique_code: Type.String({ description: "题目标识" }) }, (a) => ({ uniqueCode: requireUniqueCode(a.unique_code) }));

	register(
		"submit",
		"提交从靶场实际取得的 flag。前置：画板已有对应 finding/证据支撑——拿不到实际证据不提交，不编造 flag。",
		{ unique_code: Type.String({ description: "题目标识" }), flag: Type.String({ description: "靶场实际取得的 flag" }) },
		(a) => {
			const flag = String(a.flag ?? "");
			if (flag.length < 1 || flag.length > 4096) throw new Error("flag 需为 1-4096 字符");
			return { uniqueCode: requireUniqueCode(a.unique_code), flag };
		},
	);

	register("close", "关闭指定题目的远端靶场，释放评测资源。", { unique_code: Type.String({ description: "题目标识" }) }, (a) => ({ uniqueCode: requireUniqueCode(a.unique_code) }));
}
