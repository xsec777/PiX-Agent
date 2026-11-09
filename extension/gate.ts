/**
 * gate.ts — 运行时命令看门狗、读卡门禁与防偷懒闭环门禁 (Runtime Watchdog & Anti-Sloth Gate)
 *
 * 核心职责：
 * 1. 读卡门禁：命令命中工具箱武器但尚未通过 howto 查阅过姿势卡时，拦截并提示先读卡；读卡后同族命令彻底放行。
 * 2. 确定性超时注入：针对 bash / powershell 工具调用，若未显式传 timeout，自动原地注入 600s 上限，
 *    防止长时间端口扫描、大型内网爆破或死循环导致进程永久挂起。
 * 3. 刚性结案门禁 (Anti-Sloth Gate)：当模型在 agent_before_settle 试图收工时，底层硬性核对端点闭环状态；
 *    若尚存未闭环接口，强制阻止结案并回推下一优先端点。
 * 4. L4 深度证伪门禁 (Anti-False-Negative Gate)：严禁单次碰壁直接判定为 rejected，必须达到测试深度阈值。
 */

import type { ToolCard } from "./toolbox-data.ts";
import { loadRegistry, hasBeenRead } from "./toolbox.ts";
import { getUnresolvedEndpoints, type EndpointNode } from "./state.ts";

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

export interface AntiSlothResult {
	blocked: boolean;
	unresolvedCount: number;
	nextEndpoint: EndpointNode | null;
	message: string;
}

/**
 * 防偷懒结案门禁 (Anti-Sloth Gate):
 * 当 Agent 试图结束会话 (agent_before_settle) 时触发硬性检查。
 * 若台账中仍有未闭环端点，强制拒止提前结案并自动注入下一优先端点。
 */
export function verifyAntiSlothGate(): AntiSlothResult {
	const unresolved = getUnresolvedEndpoints(5);
	if (unresolved.length === 0) {
		return {
			blocked: false,
			unresolvedCount: 0,
			nextEndpoint: null,
			message: "全量端点已 100% 闭环测试完成，门禁放行结案。",
		};
	}

	const nextEp = unresolved[0];
	const paramStr = nextEp.params?.length ? ` (参数: ${nextEp.params.join(", ")})` : "";
	const message =
		`【PiX 刚性结案门禁拒止】检测到接口台账中尚有 ${unresolved.length} 个端点处于未闭环状态（状态=${nextEp.status}）！` +
		`\n严禁抽样偷懒或中途收工！请立即对下一个优先端点执行深度测试：\n` +
		`➔ [${nextEp.id}] ${nextEp.method} ${nextEp.url}${paramStr} (当前已测 ${nextEp.testedTimes} 次)\n` +
		`【纪律指令】：测试后请立即调用 update_endpoint 回写最新流转状态（bypassing / confirmed / rejected）！`;

	return {
		blocked: true,
		unresolvedCount: unresolved.length,
		nextEndpoint: nextEp,
		message,
	};
}

/**
 * L4 深度证伪门禁 (Anti-False-Negative Gate):
 * 严禁单次 403/异常碰壁直接标记为 rejected。
 * 必须在 testHistory 中积累至少 3 次不同维度变异，或 testedTimes >= 3。
 */
export function verifyL4Falsification(ep: EndpointNode): { allowed: boolean; reason?: string } {
	const minAttempts = 3;
	if (ep.testedTimes < minAttempts) {
		return {
			allowed: false,
			reason: `【L4 深度证伪门禁拦截】端点 ${ep.id} 当前仅测试了 ${ep.testedTimes} 次（阈值: ${minAttempts}次）。尚未穷尽编码嵌套、请求方法及动静参数变异，严禁单凭碰壁判定为 rejected！请继续变异测试或流转为 bypassing。`,
		};
	}
	return { allowed: true };
}
