/**
 * pivot-router.ts — 跳板感知透明路由运行时 (Pivot-Aware Transparent Execution Runtime)
 *
 * 核心功能：
 * 1. 自动根据目标 IP 查询超图（findRouteForIp）：
 *    - 目标为内网网段且命中活跃跳板（Pivot Session）时，执行“双轨制”代理注入：
 *      ① 原生参数优先 (Native Proxy Injection)：对 nxc/netexec、sqlmap、nuclei、httpx、dirsearch、curl 等，
 *         原地注入 --proxy/--socks5 原生命令行参数，彻底避免 Windows 下 Go 静态二进制绕过 Winsock 泄露、
 *         或 Python C 扩展 DLL 注入导致 0xc0000005 崩溃的问题；
 *      ② proxychains 兜底：对无原生参数的工具，自动水合生成 proxychains 配置并包裹 proxychains4.exe；
 * 2. 导出 wrapCommandWithPivot 供 index.ts / CLI 执行器调用。
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findRouteForIp, type PivotSessionNode } from "./state.ts";
import { TOOLS_ROOT } from "./toolbox-data.ts";

const EXT_DIR = dirname(fileURLToPath(import.meta.url));
const PROXYCHAINS_EXE = join(TOOLS_ROOT, "03_Intranet", "proxychains", "proxychains4.exe");

interface NativeProxyRule {
	match: RegExp;
	hasProxy: (cmd: string) => boolean;
	inject: (cmd: string, proxyUrl: string, port: number) => string;
}

const NATIVE_PROXY_RULES: NativeProxyRule[] = [
	{
		// netexec / nxc
		match: /\b(netexec|nxc)(?:\.exe)?\b/i,
		hasProxy: (cmd) => /--proxy\b/i.test(cmd),
		inject: (cmd, proxyUrl) => `${cmd} --proxy "${proxyUrl}"`,
	},
	{
		// sqlmap
		match: /\bsqlmap(?:\.py|\.exe)?\b/i,
		hasProxy: (cmd) => /--proxy\b/i.test(cmd),
		inject: (cmd, proxyUrl) => `${cmd} --proxy="${proxyUrl}"`,
	},
	{
		// nuclei
		match: /\bnuclei(?:\.exe)?\b/i,
		hasProxy: (cmd) => /(?:-p|-proxy)\s+socks/i.test(cmd),
		inject: (cmd, proxyUrl) => `${cmd} -proxy "${proxyUrl}"`,
	},
	{
		// httpx
		match: /\bhttpx(?:\.exe)?\b/i,
		hasProxy: (cmd) => /(?:-http-proxy|-proxy)\b/i.test(cmd),
		inject: (cmd, proxyUrl) => `${cmd} -http-proxy "${proxyUrl}"`,
	},
	{
		// dirsearch
		match: /\bdirsearch(?:\.py|\.exe)?\b/i,
		hasProxy: (cmd) => /--proxy\b/i.test(cmd),
		inject: (cmd, proxyUrl) => `${cmd} --proxy="${proxyUrl}"`,
	},
	{
		// ffuf
		match: /\bffuf(?:\.exe)?\b/i,
		hasProxy: (cmd) => /\s+-x\s+/i.test(cmd),
		inject: (cmd, proxyUrl) => `${cmd} -x "${proxyUrl}"`,
	},
	{
		// katana
		match: /\bkatana(?:\.exe)?\b/i,
		hasProxy: (cmd) => /(?:-p|-proxy)\s+/i.test(cmd),
		inject: (cmd, proxyUrl) => `${cmd} -proxy "${proxyUrl}"`,
	},
	{
		// curl
		match: /\bcurl(?:\.exe)?\b/i,
		hasProxy: (cmd) => /(?:-x|--proxy|--socks5)\b/i.test(cmd),
		inject: (cmd, _proxyUrl, port) => `${cmd} --socks5-hostname "127.0.0.1:${port}"`,
	},
	{
		// impacket 脚本与通用 python 渗透脚本
		match: /\bpython(?:\.exe)?\s+.*(?:secretsdump|psexec|wmiexec|smbclient|atexec|dcomexec|ticketConverter)\.py\b/i,
		hasProxy: (cmd) => /(?:--dc-ip|-target-ip|-hashes|ALL_PROXY)/i.test(cmd) && /proxy/i.test(cmd),
		inject: (cmd, _proxyUrl, port) => `ALL_PROXY="socks5://127.0.0.1:${port}" ${cmd}`,
	},
];

/**
 * 水合生成 proxychains 配置文件
 */
export function ensureProxychainsConfig(session: PivotSessionNode): string {
	const confDir = join(EXT_DIR, ".cache");
	if (!existsSync(confDir)) mkdirSync(confDir, { recursive: true });
	const confPath = join(confDir, `proxychains_${session.localListenPort}.conf`);

	const confContent = `strict_chain
proxy_dns
remote_dns_subnet 224
tcp_read_time_out 15000
tcp_connect_time_out 8000

[ProxyList]
socks5 127.0.0.1 ${session.localListenPort}
`;
	writeFileSync(confPath, confContent, "utf8");
	return confPath;
}

/**
 * 包装命令：若目标 IP 命中跳板网段，原生参数优先，proxychains 兜底
 */
export function wrapCommandWithPivot(
	command: string,
	targetIp?: string,
): { command: string; viaPivot: PivotSessionNode | null; strategy?: "native" | "proxychains" } {
	if (!targetIp) {
		// 尝试从命令行中提取首个 IPv4 地址（排除 127.0.0.1 / 0.0.0.0）
		const matches = command.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
		if (matches) {
			targetIp = matches.find((ip) => ip !== "127.0.0.1" && ip !== "0.0.0.0");
		}
	}

	if (!targetIp) {
		return { command, viaPivot: null };
	}

	const route = findRouteForIp(targetIp);
	if (!route || route.status !== "active") {
		return { command, viaPivot: null };
	}

	const proxyUrl = `socks5://127.0.0.1:${route.localListenPort}`;

	// 1. 原生代理参数优先检查
	for (const rule of NATIVE_PROXY_RULES) {
		if (rule.match.test(command)) {
			if (rule.hasProxy(command)) {
				// 已显式提供代理参数，不重复注入
				return { command, viaPivot: route, strategy: "native" };
			}
			const injected = rule.inject(command, proxyUrl, route.localListenPort);
			return { command: injected, viaPivot: route, strategy: "native" };
		}
	}

	// 2. 防止重复包裹已带 proxychains 的命令
	if (command.trim().toLowerCase().startsWith("proxychains")) {
		return { command, viaPivot: route, strategy: "proxychains" };
	}

	// 3. 兜底包裹 proxychains4.exe
	const confPath = ensureProxychainsConfig(route);
	if (existsSync(PROXYCHAINS_EXE)) {
		const wrapped = `"${PROXYCHAINS_EXE}" -q -f "${confPath}" ${command}`;
		return { command: wrapped, viaPivot: route, strategy: "proxychains" };
	}

	return { command, viaPivot: route, strategy: "native" };
}
