/**
 * gate.ts — 运行时命令看门狗与读卡门禁 (Runtime Watchdog & Tool Card Gate)
 *
 * 核心职责：
 * 1. 读卡门禁：命令命中工具箱武器但尚未通过 howto 查阅过姿势卡时，拦截并提示先读卡；读卡后同族命令彻底放行。
 * 2. 确定性超时注入：针对 bash / powershell 工具调用，若未显式传 timeout，自动原地注入 600s 上限，
 *    防止长时间端口扫描、大型内网爆破或死循环导致进程永久挂起。
 */

import type { ToolCard } from "./toolbox-data.ts";
import { loadRegistry, hasBeenRead } from "./toolbox.ts";

/** bash / powershell 工具默认熔断超时（秒）。模型显式传值时不覆盖。 */
export const DEFAULT_BASH_TIMEOUT_S = 600;

interface GateVerdict {
	card: ToolCard | null;
}

/**
 * 读卡门禁：命中注册表工具且本会话未 howto 时拦截，读卡后放行
 */
export function checkCardGate(toolName: string, command: string): GateVerdict["card"] {
	if (toolName !== "bash" && toolName !== "powershell") return null;
	const lowerCmd = command.toLowerCase();
	const registry = loadRegistry();

	for (const card of registry) {
		const name = card.name.toLowerCase();
		// 匹配工具独立命令词或脚本名
		const re = new RegExp(`(?:^|[\\s"'/\\\\])${name}(?:\\.exe|\\.py)?(?:[\\s"'/\\\\]|$)`, "i");
		if (re.test(lowerCmd)) {
			if (!hasBeenRead(name)) {
				return card;
			}
		}
	}
	return null;
}

/**
 * 超时注入：无 timeout 时原地写默认值（pi tool_call 钩子支持 input 原地改参）
 */
export function ensureTimeout(toolName: string, input: Record<string, unknown>): boolean {
	if (toolName !== "bash" && toolName !== "powershell") return false;
	if (input.timeout === undefined) {
		input.timeout = DEFAULT_BASH_TIMEOUT_S;
		return true;
	}
	return false;
}
