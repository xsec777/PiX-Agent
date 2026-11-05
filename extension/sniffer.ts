/**
 * sniffer.ts — 超图自动感知与水合引擎 (Automatic Hypergraph Sniffer & Auto-Hydration)
 *
 * 核心哲学：
 *   “纯靠大模型自觉记账，实测遵从率仅 11.4%” ——
 *   本引擎在底层 tool_result 钩子中，从 bash/powershell 工具的原始物理输出中，
 *   自动提取主机存活、开放端口、服务指纹、NTLM Hash、明文凭据、PWNED 攻陷标记与 API 端点，
 *   100% 自动写入四维超图，彻底杜绝大模型“打字汇报却不调记账工具”导致的超图空转！
 */

import {
	recordHost,
	recordCredential,
	recordEndpoint,
	type HostService,
	type NetworkScope,
} from "./state.ts";

export interface SniffSummary {
	hosts: number;
	services: number;
	credentials: number;
	endpoints: number;
	compromisedHosts: number;
}

/** 判定 IP 是否属于内网私网地址 (RFC 1918) */
function isPrivateIp(ip: string): boolean {
	if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("127.")) return true;
	if (ip.startsWith("172.")) {
		const second = Number.parseInt(ip.split(".")[1], 10);
		if (!Number.isNaN(second) && second >= 16 && second <= 31) return true;
	}
	return false;
}

/**
 * 从命令行与工具输出中自动提取四维超图实体并水合落库
 */
export function sniffAndHydrate(command: string, output: string): SniffSummary {
	const summary: SniffSummary = {
		hosts: 0,
		services: 0,
		credentials: 0,
		endpoints: 0,
		compromisedHosts: 0,
	};

	if (!output || output.length < 5) return summary;

	const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, ""); // 去除 ANSI 终端颜色码

	// -----------------------------------------------------------------------
	// 1. 嗅探主机资产与开放端口服务 (Host & Port Sniffer)
	// -----------------------------------------------------------------------
	const hostMap = new Map<string, { ports: Map<number, { protocol: string; banner?: string }>; os?: string }>();

	const ensureHostEntry = (ip: string) => {
		if (!hostMap.has(ip)) {
			hostMap.set(ip, { ports: new Map() });
		}
		return hostMap.get(ip)!;
	};

	// 1.1 fscan 格式: "192.168.1.1:445 open" 或 "[*] 192.168.1.1:445"
	const fscanPortRe = /\b((?:\d{1,3}\.){3}\d{1,3}):(\d+)\s+(?:open\b|\[\*\])/gi;
	let m: RegExpExecArray | null;
	while ((m = fscanPortRe.exec(cleanOutput)) !== null) {
		const ip = m[1];
		const port = Number.parseInt(m[2], 10);
		if (ip !== "127.0.0.1" && ip !== "0.0.0.0" && port > 0 && port <= 65535) {
			const entry = ensureHostEntry(ip);
			const proto = port === 445 ? "smb" : port === 3389 ? "rdp" : port === 22 ? "ssh" : port === 80 || port === 8080 ? "http" : port === 443 ? "https" : "tcp";
			entry.ports.set(port, { protocol: proto });
		}
	}

	// 1.2 fscan 存活主机: "[*] LiveTop 192.168.1.1" 或 "[*] alive host: 192.168.1.1"
	const fscanAliveRe = /\[\*\]\s*(?:LiveTop|alive|Live):?\s*((?:\d{1,3}\.){3}\d{1,3})/gi;
	while ((m = fscanAliveRe.exec(cleanOutput)) !== null) {
		const ip = m[1];
		if (ip !== "127.0.0.1" && ip !== "0.0.0.0") ensureHostEntry(ip);
	}

	// 1.3 Nmap 格式: "Nmap scan report for ... (192.168.1.1)" 或 "Nmap scan report for 192.168.1.1"
	let currentNmapIp: string | null = null;
	for (const line of cleanOutput.split("\n")) {
		const hMatch = line.match(/Nmap scan report for (?:[^\s()]+\s+\()?((?:\d{1,3}\.){3}\d{1,3})\)?/i);
		if (hMatch) {
			currentNmapIp = hMatch[1];
			ensureHostEntry(currentNmapIp);
			continue;
		}
		if (currentNmapIp) {
			const pMatch = line.match(/^(\d+)\/(tcp|udp)\s+open\s+(\S+)(?:\s+(.*))?$/i);
			if (pMatch) {
				const port = Number.parseInt(pMatch[1], 10);
				const proto = pMatch[3] || pMatch[2];
				const banner = pMatch[4] ? pMatch[4].trim() : undefined;
				const entry = ensureHostEntry(currentNmapIp);
				entry.ports.set(port, { protocol: proto, banner });
			}
			const osMatch = line.match(/(?:OS details|Running):\s*([^\r\n]+)/i);
			if (osMatch) {
				const entry = ensureHostEntry(currentNmapIp);
				entry.os = osMatch[1].trim();
			}
		}
	}

	// 1.4 masscan 格式: "Discovered open port 80/tcp on 192.168.1.1"
	const masscanRe = /Discovered open port (\d+)\/(tcp|udp) on ((?:\d{1,3}\.){3}\d{1,3})/gi;
	while ((m = masscanRe.exec(cleanOutput)) !== null) {
		const port = Number.parseInt(m[1], 10);
		const ip = m[3];
		const proto = m[2];
		const entry = ensureHostEntry(ip);
		entry.ports.set(port, { protocol: proto });
	}

	// 1.5 httpx 格式: "http://192.168.1.1:8080 [200]" 或 "http://192.168.1.1 [200] [title]"
	const httpxRe = /https?:\/\/((?:\d{1,3}\.){3}\d{1,3})(?::(\d+))?\s+\[\d+\](?:\s+\[(.*?)\])?/gi;
	while ((m = httpxRe.exec(cleanOutput)) !== null) {
		const ip = m[1];
		const isHttps = m[0].startsWith("https");
		const port = m[2] ? Number.parseInt(m[2], 10) : isHttps ? 443 : 80;
		const banner = m[3] ? m[3].trim() : undefined;
		const entry = ensureHostEntry(ip);
		entry.ports.set(port, { protocol: isHttps ? "https" : "http", banner });
	}

	// 执行主机与服务入库水合
	for (const [ip, data] of hostMap) {
		const networkScope: NetworkScope = isPrivateIp(ip) ? "internal" : "external";
		const serviceList: HostService[] = Array.from(data.ports.entries()).map(([port, info]) => ({
			port,
			protocol: info.protocol,
			banner: info.banner,
		}));

		recordHost({
			ips: [ip],
			os: data.os,
			networkScope,
			services: serviceList,
		});
		summary.hosts += 1;
		summary.services += serviceList.length;
	}

	// -----------------------------------------------------------------------
	// 2. 嗅探凭据金库与 PWNED 攻陷状态 (Credential & PWNED Sniffer)
	// -----------------------------------------------------------------------
	// 从命令行或上下文尝试寻找目标 Host IP
	let targetHostIp: string | null = null;
	const cmdIpMatch = command.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
	if (cmdIpMatch && cmdIpMatch[0] !== "127.0.0.1") targetHostIp = cmdIpMatch[0];

	// 2.1 secretsdump / impacket 格式: "Administrator:500:aad3b4...:31d6cfe0...:::"
	const hashRe = /\b([a-zA-Z0-9_.-]+):(\d+):([a-fA-F0-9]{32}):([a-fA-F0-9]{32}):::/g;
	while ((m = hashRe.exec(cleanOutput)) !== null) {
		const account = m[1];
		const ntlmHash = m[4];
		const isDomainAdmin = account.toLowerCase() === "administrator" || m[2] === "500";
		recordCredential({
			account,
			type: "ntlm_hash",
			value: ntlmHash,
			originHostId: targetHostIp ? `host_${targetHostIp.replace(/\./g, "_")}` : "target_host",
			privilegeScope: isDomainAdmin ? "domain_admin" : "domain_user",
		});
		summary.credentials += 1;
	}

	// 2.2 netexec / nxc 成功喷洒: "[+] domain\user:password (Pwn3d!)" 或 "[+] domain\user:hash"
	const nxcRe = /\[\+\]\s+(?:([a-zA-Z0-9_.-]+)\\)?([a-zA-Z0-9_.-]+):(\S+)(?:\s+.*?(Pwn3d!))?/gi;
	while ((m = nxcRe.exec(cleanOutput)) !== null) {
		const domain = m[1];
		const account = m[2];
		const secret = m[3];
		const isPwned = Boolean(m[4]);
		const isHash = /^[a-fA-F0-9]{32}$/.test(secret);

		recordCredential({
			account,
			domain,
			type: isHash ? "ntlm_hash" : "plaintext",
			value: secret,
			originHostId: targetHostIp ? `host_${targetHostIp.replace(/\./g, "_")}` : "target_host",
			privilegeScope: isPwned ? "domain_admin" : "domain_user",
			validTargets: targetHostIp ? [`host_${targetHostIp.replace(/\./g, "_")}`] : undefined,
		});
		summary.credentials += 1;

		if (isPwned && targetHostIp) {
			// 自动坐实该主机为 PWNED
			recordHost({
				ips: [targetHostIp],
				isCompromised: true,
				compromiseVector: `netexec 凭据喷洒成功获得管理员权限 (${account})`,
			});
			summary.compromisedHosts += 1;
		}
	}

	// 2.3 pypykatz 格式: "Username: ... Domain: ... NTLM: ..."
	const pypyRe = /Username:\s*([a-zA-Z0-9_.-]+)[\s\S]*?Domain:\s*([a-zA-Z0-9_.-]+)[\s\S]*?NTLM:\s*([a-fA-F0-9]{32})/gi;
	while ((m = pypyRe.exec(cleanOutput)) !== null) {
		const account = m[1];
		const domain = m[2];
		const ntlmHash = m[3];
		recordCredential({
			account,
			domain,
			type: "ntlm_hash",
			value: ntlmHash,
			originHostId: targetHostIp ? `host_${targetHostIp.replace(/\./g, "_")}` : "target_host",
			privilegeScope: account.toLowerCase() === "administrator" ? "domain_admin" : "domain_user",
		});
		summary.credentials += 1;
	}

		// -----------------------------------------------------------------------
		// 3. 嗅探 Web/API 接口资产台账 (Multi-Source Endpoint & Nuclei Sniffer)
		// -----------------------------------------------------------------------
		const staticExtRe = /\.(?:png|jpg|jpeg|gif|svg|ico|css|js|woff|woff2|ttf|eot|map|mp4|avi|mp3|pdf|doc|docx|xls|xlsx)(?:\?.*)?$/i;
		const foundEndpoints = new Map<string, { method: "GET" | "POST" | "PUT" | "DELETE"; params?: string[]; vuln?: string; status?: "discovered" | "confirmed"; resp?: string }>();

		// 3.0 从命令行推导基准目标根 URL (Base URL)
		let baseUrl: string | null = null;
		const uMatch = command.match(/(?:-u|--url|-target|--target)\s+["']?(https?:\/\/[^\s"']+)["']?/i);
		if (uMatch) {
			try {
				const p = new URL(uMatch[1]);
				baseUrl = `${p.protocol}//${p.host}`;
			} catch {}
		}
		if (!baseUrl) {
			const directUrlMatch = command.match(/\bhttps?:\/\/[^\s"']+/i);
			if (directUrlMatch) {
				try {
					const p = new URL(directUrlMatch[0]);
					baseUrl = `${p.protocol}//${p.host}`;
				} catch {}
			}
		}

		const addDiscoveredEndpoint = (rawPathOrUrl: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", extra?: { vuln?: string; status?: "discovered" | "confirmed"; resp?: string }) => {
			let fullUrl = rawPathOrUrl.trim();
			if (!fullUrl || staticExtRe.test(fullUrl)) return;

			if (!fullUrl.startsWith("http://") && !fullUrl.startsWith("https://")) {
				if (fullUrl.startsWith("/")) {
					if (!baseUrl) return;
					fullUrl = `${baseUrl}${fullUrl}`;
				} else if (baseUrl) {
					fullUrl = `${baseUrl}/${fullUrl}`;
				} else {
					return;
				}
			}

			// 解析查询参数
			let params: string[] | undefined;
			try {
				const p = new URL(fullUrl);
				const keys = Array.from(p.searchParams.keys());
				if (keys.length > 0) params = keys;
			} catch {}

			const key = `${method}:${fullUrl}`;
			if (!foundEndpoints.has(key) && foundEndpoints.size < 40) {
				foundEndpoints.set(key, {
					method,
					params,
					vuln: extra?.vuln,
					status: extra?.status,
					resp: extra?.resp,
				});
			}
		};

			// 3.1 嗅探 Nuclei 漏洞命中: [vuln-id] [http] [severity] https://target/path
			const nucleiRe = /\[([a-zA-Z0-9_.:-]+)\]\s+\[(?:http|https)\]\s+\[(info|low|medium|high|critical)\]\s+(https?:\/\/[^\s"'<>\\]+)/gi;
		while ((m = nucleiRe.exec(cleanOutput)) !== null) {
			const vulnId = m[1];
			const severity = m[2].toLowerCase();
			const targetUrl = m[3];
			const isConfirmed = severity === "critical" || severity === "high" || severity === "medium";
			addDiscoveredEndpoint(targetUrl, "GET", {
				vuln: `Nuclei [${severity.toUpperCase()}]: ${vulnId}`,
				status: isConfirmed ? "confirmed" : "discovered",
				resp: `[Nuclei命中] 规则: ${vulnId} · 严重度: ${severity}`,
			});
		}

		// 3.2 嗅探 Katana 爬虫输出: [GET/POST] https://target/path 或纯 URL 行
		const katanaRe = /(?:\[(GET|POST|PUT|DELETE)\]\s+)?(https?:\/\/[^\s"'<>\\]+)/gi;
		while ((m = katanaRe.exec(cleanOutput)) !== null) {
			const method = (m[1]?.toUpperCase() as "GET" | "POST" | "PUT" | "DELETE") || "GET";
			const u = m[2];
			addDiscoveredEndpoint(u, method);
		}

		// 3.3 嗅探 Dirsearch 目录爆破输出: [12:34:56] 200 - 1KB - /admin/config.php
		const dirsearchRe = /(?:\[\d{2}:\d{2}:\d{2}\]\s+)?(200|301|302|403)\s+-\s+[\d.]+[A-Za-zB]+\s+-\s+(\/[^\s"']+)/gi;
		while ((m = dirsearchRe.exec(cleanOutput)) !== null) {
			const path = m[2];
			addDiscoveredEndpoint(path, "GET");
		}

		// 3.4 嗅探 Ffuf Fuzz 输出: "admin [Status: 200, Size: 1234]" 或 JSON {"url":"..."}
		const ffufRe = /(?:^\s*|\n\s*)(\/[a-zA-Z0-9_./?=&%-]+|[a-zA-Z0-9_.-]+)\s+\[Status:\s*(200|301|302|403)/gi;
		while ((m = ffufRe.exec(cleanOutput)) !== null) {
			const raw = m[1].startsWith("/") ? m[1] : `/${m[1]}`;
			addDiscoveredEndpoint(raw, "GET");
		}

		// 3.5 嗅探 LinkFinder / rg_cli / URLFinder 提取的引号路由: "/api/v1/auth/reset_password"
		const quotedRouteRe = /["'](\/(?:api|v[0-9]|rest|admin|user|auth|service|upload|graphql|system)[a-zA-Z0-9_./?=&%-]*)["']/gi;
		while ((m = quotedRouteRe.exec(cleanOutput)) !== null) {
			const path = m[1];
			addDiscoveredEndpoint(path, "GET");
		}

		// 3.6 兜底通用 URL 提取
		const isUrlDiscoveryCmd = /katana|URLFinder|rg_cli|LinkFinder|waybackurls|dirsearch|ffuf|httpx/i.test(command);
		if (isUrlDiscoveryCmd) {
			const generalUrlRe = /\bhttps?:\/\/[^\s"'<>\\]+/gi;
			while ((m = generalUrlRe.exec(cleanOutput)) !== null) {
				addDiscoveredEndpoint(m[0], "GET");
			}
		}

		// 执行端点入账水合
		for (const [key, data] of foundEndpoints) {
			const epUrl = key.slice(key.indexOf(":") + 1);
			const node = recordEndpoint({
				url: epUrl,
				method: data.method,
				params: data.params,
				status: data.status || "discovered",
				discoveredFrom: command.split(" ")[0] || "scanner",
			});
			if (data.vuln) {
				node.vulnerabilities ??= [];
				if (!node.vulnerabilities.includes(data.vuln)) node.vulnerabilities.push(data.vuln);
				if (data.status === "confirmed") {
					node.status = "confirmed";
					node.evidenceResponse = data.resp;
				}
			}
			summary.endpoints += 1;
		}

		return summary;
	}
