/**
 * pacing.ts — 节奏自适应
 *
 * 实际间隔 = 基准间隔 × 动态系数
 *   动态系数 = clamp(1 + (失败率 - 0.5) × 2, 0.5, 2.0)
 *   失败率 0.5 → 1.0×（正常）｜全失败 → 2.0×（加倍克制）｜全成功 → 0.5×（顺风提速）
 *
 * 基准：pent = 2000ms，redt = 1000ms（定死，不做配置项）。
 * 生效点：index.ts 的 tool_execution_start 钩子（对外部动作工具 sleep；
 * 扩展自身的状态簿记工具不占节奏）。
 */

import { getState, ADAPTIVE_WINDOW, isTimeRushActive } from "./state.ts";
import { isTsecbenchConfigured } from "./tsecbench.ts";

function pacingCoefficient(recentResults: boolean[]): number {
	if (recentResults.length === 0) return 1;
	const rate = recentResults.filter((r) => !r).length / recentResults.length;
	const coefficient = 1 + (rate - 0.5) * 2;
	return Math.min(2, Math.max(0.5, coefficient));
}

/** 当前应等待的毫秒数（考虑 adaptive 开关；评测收口冲刺阶段强制下限提速，仅评测场景生效，与规则注入共用同一条件） */
export function currentDelayMs(): number {
	const state = getState();
	if (isTsecbenchConfigured() && isTimeRushActive()) {
		return Math.round(state.baseIntervalMs * 0.5);
	}
	const coefficient = state.adaptive ? pacingCoefficient(state.recentResults) : 1;
	return Math.round(state.baseIntervalMs * coefficient);
}

/** 窗口统计（反思指令 / get_state 展示用） */
export function failureRate(): { rate: number; full: boolean } {
	const results = getState().recentResults;
	if (results.length === 0) return { rate: 0, full: false };
	const rate = results.filter((r) => !r).length / results.length;
	return { rate, full: results.length >= ADAPTIVE_WINDOW };
}

/** 可中止的 sleep：Agent 停止（abort）时立刻返回，不空转 */
export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (ms <= 0) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			signal?.removeEventListener("abort", done);
			clearTimeout(timer);
			resolve();
		}
		signal?.addEventListener("abort", done);
	});
}
