/**
 * matrix-view.ts — 终端交互式攻防接口看板渲染器 (Terminal Matrix View)
 *
 * 核心功能：
 * 1. 注册 /matrix 与 /ledger 斜杠命令，在控制台输出高颜值 ANSI 字符画攻击面进度看板；
 * 2. 渲染闭环率 ASCII 进度条、多站点分栏卡片、带色状态徽标与待测优先队列；
 * 3. 支持 /matrix <ep_id> 单端点深度下钻，在终端输出原始可复现 HTTP 请求包与响应差分。
 */

import {
	getAllHosts,
	getAllEndpoints,
	getMatrixMetrics,
	getPendingEndpointsQueue,
	type EndpointNode,
} from "./state.ts";

// ANSI 颜色代码定义 (跨平台终端兼容)
const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
	bgRed: "\x1b[41m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
};

/** 生成 ASCII 动态进度条 */
function renderProgressBar(percentage: number, width = 24): string {
	const filled = Math.round((percentage / 100) * width);
	const empty = Math.max(0, width - filled);
	return `${ANSI.green}${"█".repeat(filled)}${ANSI.gray}${"░".repeat(empty)}${ANSI.reset} ${ANSI.bold}${percentage.toFixed(1)}%${ANSI.reset}`;
}

/** 状态格式化 */
function formatStatusBadge(status: EndpointNode["status"]): string {
	switch (status) {
		case "confirmed":
			return `${ANSI.red}${ANSI.bold}🔴 已坐实${ANSI.reset}`;
		case "rejected":
			return `${ANSI.green}🟢 已排除${ANSI.reset}`;
		case "bypassing":
			return `${ANSI.magenta}🟣 变异中${ANSI.reset}`;
		case "escalating":
			return `${ANSI.blue}${ANSI.bold}⚡ 提权中${ANSI.reset}`;
		case "probing":
			return `${ANSI.yellow}🟡 探针中${ANSI.reset}`;
		case "blocked":
			return `${ANSI.gray}⛔ 已阻断${ANSI.reset}`;
		default:
			return `${ANSI.gray}⚪ 待测${ANSI.reset}`;
	}
}

/** 格式化请求方法 */
function formatMethod(method: string): string {
	switch (method.toUpperCase()) {
		case "GET":
			return `${ANSI.cyan}GET ${ANSI.reset}`;
		case "POST":
			return `${ANSI.green}POST${ANSI.reset}`;
		case "PUT":
			return `${ANSI.yellow}PUT ${ANSI.reset}`;
		case "DELETE":
			return `${ANSI.red}DEL ${ANSI.reset}`;
		default:
			return `${ANSI.gray}${method.slice(0, 4).padEnd(4)}${ANSI.reset}`;
	}
}

/** 渲染全景接口矩阵看板 */
export function renderMatrixView(): string {
	const metrics = getMatrixMetrics();
	const endpoints = getAllEndpoints();
	const hosts = getAllHosts();
	const queue = getPendingEndpointsQueue(3);

	const L: string[] = [];
	L.push("");
	L.push(`${ANSI.bold}🛡️  PiX 攻防接口闭环测试看板 (Attack Surface Matrix)${ANSI.reset}`);
	L.push(`${ANSI.dim}──────────────────────────────────────────────────────────────────${ANSI.reset}`);

	// 进度条与核心统计
	L.push(`进度: [${renderProgressBar(metrics.closedPercentage)}] (${metrics.closedEndpoints}/${metrics.totalEndpoints} 接口已闭环)`);
	L.push(
		`统计: ${ANSI.bold}${metrics.totalEndpoints}${ANSI.reset} 端点 | ` +
			`${ANSI.green}已闭环: ${metrics.closedEndpoints}${ANSI.reset} | ` +
			`${ANSI.red}坐实漏洞: ${metrics.confirmedCount}${ANSI.reset} | ` +
			`${ANSI.magenta}变异中: ${metrics.bypassingCount}${ANSI.reset} | ` +
			`${ANSI.yellow}探针中: ${metrics.probingCount}${ANSI.reset} | ` +
			`${ANSI.gray}待测: ${metrics.discoveredCount}${ANSI.reset}`,
	);
	L.push(`${ANSI.dim}──────────────────────────────────────────────────────────────────${ANSI.reset}`);

	if (endpoints.length === 0) {
		L.push(`  ${ANSI.dim}暂无接口资产。运行侦察工具 (rg_cli / URLFinder / dirsearch) 自动水合。${ANSI.reset}`);
	} else {
		// 按 Host 归类显示
		const hostGroups = new Map<string, EndpointNode[]>();
		for (const ep of endpoints) {
			let host = "Unknown Target";
			try {
				host = new URL(ep.url).host;
			} catch {
				host = ep.url.split("/")[0] || "Unknown Target";
			}
			if (!hostGroups.has(host)) hostGroups.set(host, []);
			hostGroups.get(host)!.push(ep);
		}

		for (const [host, eps] of hostGroups) {
			const hostInfo = hosts.find((h) => h.ips.includes(host) || h.hostname === host);
			const pwnedTag = hostInfo?.isCompromised ? ` ${ANSI.red}${ANSI.bold}[⚡PWNED]${ANSI.reset}` : "";
			L.push(`\n${ANSI.bold}🌐 目标站点: ${host}${pwnedTag}${ANSI.reset} ${ANSI.dim}(${eps.length} 接口)${ANSI.reset}`);
			L.push(`${ANSI.dim}┌──────┬──────┬───────────────────────────────┬────────────┬─────────────┐${ANSI.reset}`);
			L.push(`${ANSI.dim}│ 编号 │ 方法 │ 接口路径                      │ 状态机     │ 实测结论    │${ANSI.reset}`);
			L.push(`${ANSI.dim}├──────┼──────┼───────────────────────────────┼────────────┼─────────────┤${ANSI.reset}`);

			for (const ep of eps) {
				let path = ep.url;
				try {
					const u = new URL(ep.url);
					path = u.pathname + u.search;
				} catch {}
				if (path.length > 29) path = path.slice(0, 26) + "...";

				const vuln = (ep.vulnerabilities && ep.vulnerabilities[0]) || (ep.status === "rejected" ? "已充分证伪" : "-");
				const vulnStr = vuln.length > 11 ? vuln.slice(0, 9) + ".." : vuln;

				L.push(
					`│ ${ANSI.dim}${ep.id.padEnd(4)}${ANSI.reset} │ ${formatMethod(ep.method)} │ ${path.padEnd(29)} │ ${formatStatusBadge(ep.status).padEnd(10)} │ ${vulnStr.padEnd(11)} │`,
				);
			}
			L.push(`${ANSI.dim}└──────┴──────┴───────────────────────────────┴────────────┴─────────────┘${ANSI.reset}`);
		}
	}

	// 待测优先队列推荐
	L.push("");
	L.push(`${ANSI.bold}⚡ 当前待测调度队列 (Top ${queue.length}):${ANSI.reset}`);
	if (queue.length === 0) {
		L.push(`  ${ANSI.green}✓ 全量端点已 100% 闭环测试完成！无待测项。${ANSI.reset}`);
	} else {
		queue.forEach((q, i) => {
			L.push(`  ${i + 1}. [${q.id}] ${formatMethod(q.method)} ${q.url} ${formatStatusBadge(q.status)} (已测 ${q.testedTimes} 次)`);
		});
		L.push(`${ANSI.dim}提示: 执行 /matrix <ep_id> 可深入下钻单个接口的测试报文与响应差分。${ANSI.reset}`);
	}
	L.push("");

	return L.join("\n");
}

/** 渲染单端点详细证据抽屉 */
export function renderEndpointDetail(idOrUrl: string): string {
	const endpoints = getAllEndpoints();
	const ep = endpoints.find((e) => e.id === idOrUrl || e.url === idOrUrl);
	if (!ep) {
		return `${ANSI.red}未找到端点「${idOrUrl}」，输入 /matrix 查全量列表。${ANSI.reset}`;
	}

	const L: string[] = [];
	L.push("");
	L.push(`${ANSI.bold}🔎 端点详情下钻: [${ep.id}] ${ep.url}${ANSI.reset}`);
	L.push(`${ANSI.dim}──────────────────────────────────────────────────────────────────${ANSI.reset}`);
	L.push(`HTTP 方法: ${formatMethod(ep.method)}`);
	L.push(`状态流转: ${formatStatusBadge(ep.status)} (已测试: ${ep.testedTimes} 次 | 连续失败: ${ep.failureStreak || 0} 次)`);
	L.push(`参数列表: ${(ep.params || []).join(", ") || "无"}`);
	if (ep.vulnerabilities?.length) {
		L.push(`${ANSI.red}确认漏洞: ${ep.vulnerabilities.join("、")}${ANSI.reset}`);
	}

	if (ep.evidenceRequest) {
		L.push(`\n${ANSI.bold}实证请求报文 (Raw HTTP Request):${ANSI.reset}`);
		L.push(`${ANSI.dim}------------------------------------------------${ANSI.reset}`);
		L.push(ep.evidenceRequest.trim());
		L.push(`${ANSI.dim}------------------------------------------------${ANSI.reset}`);
	}

	if (ep.evidenceResponse) {
		L.push(`\n${ANSI.bold}关键响应差分证据 (Response Snippet):${ANSI.reset}`);
		L.push(`${ANSI.dim}------------------------------------------------${ANSI.reset}`);
		L.push(ep.evidenceResponse.trim());
		L.push(`${ANSI.dim}------------------------------------------------${ANSI.reset}`);
	}

	if (ep.testHistory?.length) {
		L.push(`\n${ANSI.bold}测试生命周期流转履历 (${ep.testHistory.length} 次动作):${ANSI.reset}`);
		ep.testHistory.forEach((h, idx) => {
			L.push(`  ${idx + 1}. [${h.timestamp.slice(11, 19)}] ${formatStatusBadge(h.status)} - ${h.action}`);
		});
	}
	L.push("");

	return L.join("\n");
}
