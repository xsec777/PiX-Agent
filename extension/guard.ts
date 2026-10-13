/**
 * guard.ts — 本机危险命令拦截（环境防护，非渗透限制）
 *
 * 口径（最终方案 Q29）：只拦「本机破坏性命令」——删根盘/格盘/关机/重启类。
 * 目标侧操作（对测试系统发起的写入/利用动作）不在拦截范围：
 *   - pent 模式的写路径口径由模式规则（软约束）管理；
 *   - redt 模式由任务书围栏管理。
 *
 * 行为：命中黑名单 → 有 UI 时 ctx.ui.confirm 让人裁决；无 UI（RPC/headless）→ 直接拦截。
 */

/** bash 侧危险模式（子串匹配，命令文本包含即命中） */
const DANGEROUS_BASH = [
	"rm -rf /",
	"rm -rf /*",
	"dd if=",
	"mkfs",
	"> /dev/sd",
	"shutdown",
	"reboot",
	"halt -p",
	// 全盘扫描类（e1-02 的 find / 挂死 13 分钟教训；find /e/Hacker 合法不拦）
	"find / -",
	"find /*",
	// 补项（T9 深查）
	"diskpart",
	"cipher /w",
	"rd /s /q c:",
	"rd /s /q c:\\",
	"del /s /q c:",
	":(){ :|:& };:",
	":(){:|:&};:",
	"chmod -r 000",
	"chmod -r 000 /",
];

/** PowerShell 侧危险模式 */
const DANGEROUS_PS = [
	"format c:",
	"format d:",
	"remove-item c:\\ -recurse -force",
	"remove-item \\\\?\\c:",
	"stop-computer",
	"restart-computer",
	"diskpart",
	"cipher /w",
];

interface GuardVerdict {
	hit: string | null;
}

/** 判断命令是否命中本机破坏性黑名单（返回命中的模式，未命中返回 null） */
export function detectDangerous(toolName: string, command: string): GuardVerdict["hit"] {
	const cmd = command.toLowerCase();
	const list = toolName === "powershell" ? DANGEROUS_PS : DANGEROUS_BASH;
	return list.find((d) => cmd.includes(d)) ?? null;
}
