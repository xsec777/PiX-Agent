/**
 * gate.ts — 读卡门禁 + bash/powershell 默认超时注入（机制保证，不靠条令恳求）
 *
 * 1. 读卡门禁：命令命中注册表工具但本会话未 howto 读卡 → block 并指示先读卡（宁误拦不漏拦）。
 * 2. 超时注入：bash 工具未显式传 timeout 时原地写 600s（pi 默认永不熔断）；显式传值不覆盖。
 * 匹配口径：token = 卡名 + 可执行名去扩展 + invocation 脚本名去扩展（不含自然语言别名防误伤）。
 */

import { loadRegistry, hasBeenRead } from "./toolbox.ts";
import type { ToolCard } from "./toolbox-data.ts";

/** bash 工具默认超时（秒）。模型显式传值不覆盖。 */
export const DEFAULT_BASH_TIMEOUT_S = 600;

interface GateCard {
	card: ToolCard;
	tokens: Set<string>;
}

let cache: GateCard[] | null = null;

function stem(fileName: string): string {
	const m = fileName.toLowerCase().match(/^(.+)\.(exe|py|cmd|bat|jar)$/);
	return m ? m[1] : fileName.toLowerCase();
}

function buildGateCards(): GateCard[] {
	return loadRegistry().map((card) => {
		const tokens = new Set<string>();
		const add = (t: string | undefined) => {
			if (t && t.length >= 2) tokens.add(t.toLowerCase());
		};
		add(card.name);
		if (card.path) add(stem(card.path.split(/[\\/]/).pop() ?? ""));
		// invocation 中的脚本名（rg_batch.py / jwt_tool.py 等别名未覆盖的入口）
		for (const m of card.invocation.matchAll(/([\w.-]+\.(?:py|exe|cmd|jar))/gi)) add(stem(m[1]));
		return { card, tokens };
	});
}

function commandChunks(command: string): Set<string> {
	return new Set(command.toLowerCase().split(/[^a-z0-9._-]+/).filter(Boolean));
}

function matchToken(chunks: Set<string>, token: string): boolean {
	for (const c of chunks) {
		if (c === token || c.startsWith(token + ".")) return true;
	}
	return false;
}

interface GateVerdict {
	/** 命中的工具卡（未读卡时返回） */
	card: ToolCard | null;
}

/**
 * 读卡门禁：返回该命令应先读哪张卡（已读卡或未命中 → null）。
 * 也把门禁当作超时注入的挂载点：bash/powershell 无 timeout 时写 600。
 */
export function checkCardGate(toolName: string, command: string): GateVerdict["card"] {
	if (toolName !== "bash" && toolName !== "powershell") return null;
	if (!cache) cache = buildGateCards();
	const chunks = commandChunks(command);
	if (chunks.size === 0) return null;
	for (const { card, tokens } of cache) {
		if (hasBeenRead(card.name)) continue;
		for (const t of tokens) {
			if (matchToken(chunks, t)) return card;
		}
	}
	return null;
}

/** 超时注入：无 timeout 时原地写默认值（pi tool_call 钩子支持 input 原地改参） */
export function ensureTimeout(toolName: string, input: Record<string, unknown>): boolean {
	if (toolName !== "bash" && toolName !== "powershell") return false;
	if (input.timeout === undefined) {
		input.timeout = DEFAULT_BASH_TIMEOUT_S;
		return true;
	}
	return false;
}
