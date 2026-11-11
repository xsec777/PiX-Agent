/**
 * pivot-router.ts — 跳板感知透明路由运行时 (Pivot-Aware Transparent Execution Runtime)
 *
 * 核心功能：
 * 1. 自动根据目标 IP 查询超图（findRouteForIp 与多跳链推演）：
 *    - 目标为内网网段且命中活跃跳板（Pivot Session）时，执行“双轨制”代理注入：
 *      ① 原生参数优先 (Native Proxy Injection)：对 nxc/netexec、sqlmap、nuclei、httpx、fscan、dirsearch、curl 等，
 *         原地注入 --proxy/--socks5 原生命令行参数，彻底避免 Windows 下 Go 静态二进制绕过 Winsock 泄露、
 *         或 Python C 扩展 DLL 注入导致 0xc0000005 崩溃的问题；
 *      ② proxychains 多跳链式兜底：对多层嵌套内网，自动组装严格链式 strict_chain 配置并包裹 proxychains4.exe；
 * 2. 导出 wrapCommandWithPivot 供 index.ts / CLI 执行器调用。
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findRouteForIp, getAllSessions, type PivotSessionNode } from "./state.ts";
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
		// fscan 内网扫描器
		match: /\bfscan(?:\.exe)?\b/i,
		hasProxy: (cmd) => /(?:-socks5|-proxy)\b/i.test(cmd),
		inject: (cmd, _proxyUrl, port) => `${cmd} -socks5 127.0.0.1:${port}`,
	},
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
		// AD/内网 Python 工具 (certipy / bloodhound / impacket / pypykatz)
		match: /\b(?:python(?:\.exe)?\s+.*(?:certipy|bloodhound|secretsdump|psexec|wmiexec|smbclient|pypykatz)\b|(?:certipy|bloodhound-python)(?:\.exe)?\b)/i,
		hasProxy: (cmd) => /(?:--dc-ip|-target-ip|ALL_PROXY)/i.test(cmd) && /proxy/i.test(cmd),
		inject: (cmd, _proxyUrl, port) => `ALL_PROXY="socks5://127.0.0.1:${port}" ${cmd}`,
	},
];

/**
 * 组装多跳 Proxychains 严格链式配置文件
 */
export function ensureMultiHopProxychainsConfig(sessions: PivotSessionNode[]): string {
	const confDir = join(EXT_DIR, ".cache");
	if (!existsSync(confDir)) mkdirSync(confDir, { recursive: true });
	const portsTag = sessions.map((s) => s.localListenPort).join("_");
	const confPath = join(confDir, `proxychains_chain_${portsTag}.conf`);

	const proxyLines = sessions.map((s) => `socks5 127.0.0.1 ${s.localListenPort}`).join("\n");
	const confContent = `strict_chain
proxy_dns
remote_dns_subnet 224
tcp_read_time_out 15000
tcp_connect_time_out 8000

[ProxyList]
${proxyLines}
`;
	writeFileSync(confPath, confContent, "utf8");
	return confPath;
}

/**
 * 水合生成单跳 proxychains 配置文件
 */
export function ensureProxychainsConfig(session: PivotSessionNode): string {
	return ensureMultiHopProxychainsConfig([session]);
}

/**
 * 包装命令：若目标 IP 命中跳板网段，原生参数优先，多跳 proxychains 兜底
 */
export function wrapCommandWithPivot(
	command: string,
	targetIp?: string,
): { command: string; viaPivot: PivotSessionNode | null; strategy?: "native" | "proxychains"; hopsCount: number } {
	if (!targetIp) {
		// 尝试从命令行中提取首个 IPv4 地址（排除 127.0.0.1 / 0.0.0.0）
		const matches = command.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
		if (matches) {
			targetIp = matches.find((ip) => ip !== "127.0.0.1" && ip !== "0.0.0.0");
		}
	}

	if (!targetIp) {
		return { command, viaPivot: null, hopsCount: 0 };
	}

	const route = findRouteForIp(targetIp);
	if (!route || route.status !== "active") {
		return { command, viaPivot: null, hopsCount: 0 };
	}

	const activeSessions = getAllSessions().filter((s) => s.status === "active");
	const hopsCount = activeSessions.length > 1 ? activeSessions.length : 1;
	const proxyUrl = `socks5://127.0.0.1:${route.localListenPort}`;

	// 1. 单跳且命中原生参数规则优先
	if (hopsCount === 1) {
		for (const rule of NATIVE_PROXY_RULES) {
			if (rule.match.test(command)) {
				if (rule.hasProxy(command)) {
					return { command, viaPivot: route, strategy: "native", hopsCount: 1 };
				}
				const injected = rule.inject(command, proxyUrl, route.localListenPort);
				return { command: injected, viaPivot: route, strategy: "native", hopsCount: 1 };
			}
		}
	}

	// 2. 防止重复包裹已带 proxychains 的命令
	if (command.trim().toLowerCase().startsWith("proxychains")) {
		return { command, viaPivot: route, strategy: "proxychains", hopsCount };
	}

	// 3. 兜底包裹链式 proxychains4.exe
	const confPath = hopsCount > 1 ? ensureMultiHopProxychainsConfig(activeSessions) : ensureProxychainsConfig(route);
	if (existsSync(PROXYCHAINS_EXE)) {
		const wrapped = `"${PROXYCHAINS_EXE}" -q -f "${confPath}" ${command}`;
		return { command: wrapped, viaPivot: route, strategy: "proxychains", hopsCount };
	}

	// 若未发现 proxychains 二进制，回退到环境代理变量前置注入
	const envWrapped = `ALL_PROXY="socks5://127.0.0.1:${route.localListenPort}" ${command}`;
	return { command: envWrapped, viaPivot: route, strategy: "native", hopsCount };
}
