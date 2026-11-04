/**
 * sensor.ts — tool 侧智能传感器（机制保证的阻断识别、止损与战术反向推荐）
 *
 * 核心升级：
 *   1. 多维阻断模式识别：区分 WAF拦截 / 频控限流 / 人机挑战 / 协议错误 / 内网域认证拒绝；
 *   2. 战术反向推荐引擎：当触发连续拦截时，自动根据阻断特征向 System Prompt 推荐精准的战术 SOP 与绕过策略；
 *   3. 记账监控与客观信号入账：连续 5 次外部动作未记账触发【记账提醒】；连续 5 次受阻触发【止损提醒】。
 */

import { bumpFailure } from "./state.ts";

export type BlockType = "waf" | "rate_limit" | "captcha" | "ad_auth" | "timeout" | "generic";

const PATTERNS: Record<BlockType, RegExp> = {
	waf: /\b(?:waf|cloudflare|imperva|safe.?line|mod_security|access denied|forbidden|403 forbidden)\b/i,
	rate_limit: /\b(?:429|rate.?limit|too many requests|retry.?after|speed limit)\b/i,
	captcha: /\b(?:captcha|geetest|turnstile|verify code|人机验证|滑块)\b/i,
	ad_auth: /\b(?:STATUS_LOGON_FAILURE|STATUS_ACCESS_DENIED|KDC_ERR_|KRB_AP_ERR|clock skew|NTLMSSP)\b/i,
	timeout: /command timed out|timed out after|timed out|ETIMEDOUT|504 gateway/i,
	generic: /(?:^|[^0-9])(?:403|429)(?:[^0-9]|$)/,
};

const TACTICAL_RECOMMENDATIONS: Record<BlockType, string[]> = {
	waf: ["waf-bypass-techniques", "401-403-bypass-techniques", "request-smuggling"],
	rate_limit: ["api-recon-and-docs", "tunneling-and-pivoting"],
	captcha: ["authbypass-authentication-flaws", "api-recon-and-docs"],
	ad_auth: ["windows-lateral-movement", "active-directory-kerberos-attacks", "ntlm-relay-coercion"],
	timeout: ["tunneling-and-pivoting", "windows-lateral-movement"],
	generic: ["401-403-bypass-techniques", "waf-bypass-techniques"],
};

/** 连续外部动作未入账计数（会话内） */
let externalStreak = 0;
/** 连续 blocked/error 计数 */
let blockedStreak = 0;
/** 最新识别出的阻断主因 */
let lastBlockType: BlockType | null = null;

/** 会话切换或重置时清零计数器 */
export function resetSensors(): void {
	externalStreak = 0;
	blockedStreak = 0;
	lastBlockType = null;
}

/** 外部动作计数（tool_execution_start，非豁免工具） */
export function countExternalAction(): void {
	externalStreak += 1;
}

/** 入账（record_* 结果 / pentrack 镜像落节点）→ 清零 */
export function noteLedger(): void {
	externalStreak = 0;
}

/** 检测文本命中的阻断类型 */
function detectBlockType(text: string, isError: boolean): BlockType | null {
	if (PATTERNS.waf.test(text)) return "waf";
	if (PATTERNS.ad_auth.test(text)) return "ad_auth";
	if (PATTERNS.rate_limit.test(text)) return "rate_limit";
	if (PATTERNS.captcha.test(text)) return "captcha";
	if (PATTERNS.timeout.test(text)) return "timeout";
	if (isError || PATTERNS.generic.test(text)) return "generic";
	return null;
}

/** 每个工具结果过一遍：更新止损计数；返回是否超时（供「结果未知」标注） */
export function noteResult(isError: boolean, text: string): { timeout: boolean; blockType: BlockType | null } {
	const hit = detectBlockType(text, isError);
	const isTimeout = isError && PATTERNS.timeout.test(text);

	if (hit || isError) {
		blockedStreak += 1;
		lastBlockType = hit || "generic";
		if (blockedStreak === 5) {
			// 客观失败信号喂进状态机：跨过阈值那一刻计一次方向失败
			bumpFailure("连续拦截/报错（观察器）");
		}
	} else {
		blockedStreak = 0;
		lastBlockType = null;
	}
	return { timeout: isTimeout, blockType: hit };
}

/** section 注入用的提醒段（rules.ts buildSection 调用；无提醒返回空串） */
export function sensorReminders(): string {
	const parts: string[] = [];
	if (blockedStreak >= 5) {
		const recTactics = lastBlockType ? TACTICAL_RECOMMENDATIONS[lastBlockType] : ["waf-bypass-techniques"];
		const tacticsTip = recTactics
			? `\n建议立即调用 consult_tactics("${recTactics[0]}") 检索针对「${lastBlockType?.toUpperCase()}」的实战 SOP 与绕过变形字典。`
			: "";
		parts.push(
			`【止损提醒】已连续 ${blockedStreak} 次被拦截/报错/WAF 阻断。执行红队军规：1. 将当前路径假设标记为 rejected 并记录差分证据；2. 回退至超图分叉点换线；3. 换用同族替代姿势或协议走私/换跳板横向，禁止原地机械重复。${tacticsTip}`,
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
