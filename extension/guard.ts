/**
 * guard.ts — 本机危险命令防御拦截网关 (Destructive Execution Guard)
 *
 * 核心哲学：
 * 1. 严格阻断针对本机开发环境的破坏性命令：格盘/清空根目录/关机/MBR破坏；
 * 2. 深度拦截不可信管道下载并执行 (Pipe to Shell: curl|bash / IEX) 与危险提权授权；
 * 3. 目标侧渗透测试操作正常放行，由模式规则 (PENT/REDT) 纪律管理。
 */

/** bash 侧危险命令与攻击性破坏特征 */
const DANGEROUS_BASH = [
	"rm -rf /",
	"rm -rf /*",
	"dd if=",
	"dd of=/dev/sd",
	"dd of=/dev/nvme",
	"mkfs",
	"> /dev/sd",
	"> /dev/nvme",
	"shutdown",
	"reboot",
	"halt -p",
	"find / -",
	"find /*",
	"diskpart",
	"cipher /w",
	"rd /s /q c:",
	"rd /s /q c:\\",
	"del /s /q c:",
	":(){ :|:& };:",
	":(){:|:&};:",
	"chmod -r 000",
	"chmod -r 000 /",
	"chmod -r 777 /",
	"chmod -r 777 /etc",
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
	"vssadmin delete shadows",
	"bcdedit /set",
];

/** 高危动态管道执行与内存反弹特征 (Regex Patterns) */
const DANGEROUS_REGEX_PATTERNS = [
	// curl/wget 管道下载直传 shell 执行 (非受控未知脚本注入)
	/(?:curl|wget)\s+[^\n|&;]+\|\s*(?:bash|sh|zsh)\b/i,
	// PowerShell 内存字符串隐式执行 IEX
	/(?:invoke-expression|iex)\s*(?:\(|\[)?\s*(?:new-object\s+net\.webclient|iwr|invoke-webrequest)/i,
	// iwr ... | iex 管道
	/(?:iwr|invoke-webrequest)[^\n|&;]+\|\s*iex\b/i,
];

interface GuardVerdict {
	hit: string | null;
}

/** 判断命令是否命中本机破坏性黑名单（返回命中的模式，未命中返回 null） */
export function detectDangerous(toolName: string, command: string): GuardVerdict["hit"] {
	const cmd = command.toLowerCase();

	// 1. 正则高危管道与内存注入判定
	for (const pattern of DANGEROUS_REGEX_PATTERNS) {
		if (pattern.test(command)) {
			return `高危管道执行模式: ${pattern.source}`;
		}
	}

	// 2. 静态危险子串列表匹配
	const list = toolName === "powershell" ? DANGEROUS_PS : DANGEROUS_BASH;
	return list.find((d) => cmd.includes(d)) ?? null;
}
