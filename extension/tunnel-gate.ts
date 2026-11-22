/** 隧道命令前置防护：只检查文本，不启动工具、不维护授权状态。 */
const FINGERPRINTS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "chisel", pattern: /(?:^|[\s;|&/\\'"])chisel(?:\.exe)?(?=$|[\s;|&'"])/i },
	{ name: "frp", pattern: /(?:^|[\s;|&/\\'"])frp[cs](?:\.exe)?(?=$|[\s;|&'"])/i },
	{ name: "ew", pattern: /(?:^|[\s;|&/\\'"])ew(?:\.exe)?(?=$|[\s;|&'"])/i },
	{ name: "nps", pattern: /(?:^|[\s;|&/\\'"])(?:nps|npc)(?:\.exe)?(?=$|[\s;|&'"])/i },
	{ name: "gost", pattern: /(?:^|[\s;|&/\\'"])gost(?:\.exe)?(?=$|[\s;|&'"])/i },
	{ name: "ngrok", pattern: /(?:^|[\s;|&/\\'"])ngrok(?:\.exe)?(?=$|[\s;|&'"])/i },
	{ name: "ssh", pattern: /(?:^|[\s;|&/\\'"])ssh(?:\.exe)?["']?[^;|&\r\n]*\s+-[RLD]/ },
];

export function detectTunnelCommand(command: string): string | undefined {
	return FINGERPRINTS.find(({ pattern }) => pattern.test(command))?.name;
}
