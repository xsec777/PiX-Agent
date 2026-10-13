/**
 * sensor.ts — tool 侧传感器（机制保证的止损与记账）
 *
 * 三个信号全部来自真实工具事件而非 agent 自报：
 *   1. 记账提醒：连续 ≥5 次外部动作无任何入账（record_* / pentrack 镜像）→【记账提醒】
 *   2. 止损观察器：连续 ≥5 次 blocked/error 结果（403/429/captcha/waf/限流/超时）→
 *      自动 bumpFailure(合成方向)——强制回读可被客观信号触发 +【止损提醒】
 *   3. 超时未知：被熔断命令的结果标注「结果未知≠失败」——由 index.ts tool_result 钩子追加。
 */

import { bumpFailure } from "./state.ts";

const BLOCKED_RE = /(?:^|[^0-9])(?:403|429)(?:[^0-9]|$)|captcha|\bwaf\b|rate.?limit|forbidden|too many/i;
const TIMEOUT_RE = /command timed out|timed out after/i;

/** 连续外部动作未入账计数（会话内） */
let externalStreak = 0;
/** 连续 blocked/error 计数 */
let blockedStreak = 0;

/** 外部动作计数（tool_execution_start，非豁免工具） */
export function countExternalAction(): void {
	externalStreak += 1;
}

/** 入账（record_* 结果 / pentrack 镜像落节点）→ 清零 */
export function noteLedger(): void {
	externalStreak = 0;
}

/** 每个工具结果过一遍：更新止损计数；返回是否超时（供「结果未知」标注） */
export function noteResult(isError: boolean, text: string): { timeout: boolean } {
	const timeout = isError && TIMEOUT_RE.test(text);
	if (isError || BLOCKED_RE.test(text) || timeout) {
		blockedStreak += 1;
		if (blockedStreak === 5) {
			// 客观失败信号喂进状态机：跨过阈值那一刻计一次方向失败
			bumpFailure("连续拦截/报错（观察器）");
		}
	} else {
		blockedStreak = 0;
	}
	return { timeout };
}

/** section 注入用的提醒段（rules.ts buildSection 调用；无提醒返回空串） */
export function sensorReminders(): string {
	const parts: string[] = [];
	if (blockedStreak >= 5) {
		parts.push(
			`【止损提醒】已连续 ${blockedStreak} 次被拦截/报错（403/429/WAF/超时类）：该方向已被防守盯上。` +
				`立即停止当前方向，record_failure 记录后换方向或收口——继续硬刚只会浪费预算并加深封锁。`,
		);
	}
	if (externalStreak >= 5) {
		parts.push(
			`【记账提醒】已连续 ${externalStreak} 个外部动作未入画板：把当前确认的能力/发现/失败用 record_fact 记入` +
				`（防上下文压缩丢失），再继续。`,
		);
	}
	return parts.join("\n\n");
}
