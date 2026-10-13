/**
 * toolbox-data.ts — PiX 工具注册表（内嵌默认数据）
 *
 * 数据来源：
 *   - 31+7 个工具全部实测/卡化：路径与姿势均经过真机验证（云 CLI 等）
 *   - path 统一为 TOOLS_ROOT（项目内 tools/）拼接——工具随项目分发，本机零外部引用
 *   - PIX_TOOLS_ROOT / PIX_PY310 环境变量可覆盖（逃生口）
 *   - 路径配置链：环境变量 → 扩展目录 pix-config.json（install.mjs 写入）→ 默认
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type ToolRuntime = "direct" | "python" | "java";
export type ToolCategory =
	| "recon" // 信息收集（子域/存活/指纹/端口/目录/JS）
	| "intranet" // 内网/横向
	| "exploit" // 漏洞验证与利用
	| "crypto" // 解密/凭证
	| "reverse" // 逆向/二进制分析
	| "cloud" // 云环境只读
	| "util"; // 基础件

export interface ToolCard {
	name: string;
	category: ToolCategory;
	aliases: string[];
	purpose: string;
	/** 实测可用（true=路径与姿势已验证；false=扩展位，需用户自装） */
	tested: boolean;
	runtime: ToolRuntime;
	/** 工具可执行文件路径 */
	path?: string;
	/** python/java 解释器绝对路径 */
	runtimePath?: string;
	/** 需要 cd 到的工作目录（python 系工具） */
	workdir?: string;
	/** 唯一正确姿势（AI 编排模板，<占位符> 需替换） */
	invocation: string;
	/** 硬约束（违反=预期失败或违反红线） */
	hardRules: string[];
	/** 关键参数速查 */
	params?: string[];
	/** 限速/节奏 */
	rate?: string;
	/** 已知陷阱 */
	traps?: string[];
	/** 扩展位的安装提示 */
	installHint?: string;
}

/** 路径配置链（改良8）：环境变量 → 扩展目录 pix-config.json（install 写入）→ 默认（仓库开发态） */
const EXT_DIR = dirname(fileURLToPath(import.meta.url));
let pixConfig: { toolsRoot?: string; py310?: string } = {};
try {
	const cf = join(EXT_DIR, "pix-config.json");
	if (existsSync(cf)) pixConfig = JSON.parse(readFileSync(cf, "utf8")) ?? {};
} catch {
	// 配置缺失/坏档：走默认
}

export const TOOLS_ROOT =
	process.env.PIX_TOOLS_ROOT ?? pixConfig.toolsRoot ?? "E:\\AProjs\\Zcode\\PiX\\tools";

export const PY310 =
	process.env.PIX_PY310 ?? pixConfig.py310 ?? "E:\\env\\python3106\\python.exe";

export const TOOLBOX: ToolCard[] = [
	// ------------------------------------------------ recon · 子域
	{
		name: "subfinder",
		category: "recon",
		aliases: ["子域", "子域名", "subdomain", "被动枚举"],
		purpose: "被动子域枚举（证书透明 + 被动数据源），全量收口第一步",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\subfinder\\subfinder.exe",
		invocation: "<path> -d <域名> -all -o <输出.txt>",
		hardRules: ["与 OneForAll/crt.sh 并跑取并集（子域任务必跑全跑）"],
		params: ["-d 域名", "-all 全部被动源", "-o 输出文件"],
		rate: "被动查询，无限速要求",
		traps: ["纯被动不出网打目标，可放心全量"],
	},
	{
		name: "oneforall",
		category: "recon",
		aliases: ["子域聚合", "oneforall", "子域爆破"],
		purpose: "子域聚合枚举（证书+爆破+搜索引擎），subfinder 的互补源",
		tested: true,
		runtime: "python",
		runtimePath: PY310,
		path: TOOLS_ROOT + "\\01_AssetScan\\OneForAll\\oneforall.py",
		workdir: TOOLS_ROOT + "\\01_AssetScan\\OneForAll",
		invocation: "cd <workdir> && NO_PROXY=127.0.0.1,localhost HTTP_PROXY= HTTPS_PROXY= <runtime> oneforall.py --target <域名> run",
		hardRules: ["必须 cd 到工具目录再跑", "Python 系工具先清代理环境变量", "护网场景加 --brute False 关爆破"],
		params: ["--target 域名", "run 执行", "--brute False 关爆破（护网）"],
		rate: "默认即可；爆破模式对权威 DNS 压力大",
		traps: ["不清代理会走系统代理导致全部超时"],
	},
	{
		name: "crt.sh",
		category: "recon",
		aliases: ["证书透明", "ct log", "crtsh"],
		purpose: "证书透明 4 源子域枚举（无 key，零成本）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\crt.sh\\crt.sh.exe",
		invocation: "<path> -d <域名> -f json -o <输出.json>；安静模式加 -q 可管道给 httpx",
		hardRules: ["子域任务三源之一（subfinder/OneForAll/crt.sh 并跑取并集）"],
		params: ["-d 域名", "-f json 格式", "-q 安静模式（可管道）"],
	},
	// ------------------------------------------------ recon · 存活与指纹
	{
		name: "httpx",
		category: "recon",
		aliases: ["存活", "http 探测", "技术栈", "指纹"],
		purpose: "批量存活探测 + HTTP 技术栈指纹（子域列表 → 可访问 URL 列表）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\httpx\\httpx.exe",
		invocation: "<path> -l <子域列表.txt> -title -tech-detect -status-code -silent -t 30 -rl 100 -o <输出.txt>",
		hardRules: ["AI 解析必加 -silent（否则横幅噪声淹没结果）", "必加 -t/-rl 限速（默认太猛）"],
		params: ["-l 列表", "-title/-tech-detect/-status-code 指纹", "-silent 安静", "-t 30 并发", "-rl 100 每秒请求"],
		rate: "-t 30 -rl 100（实测安全值）",
		traps: ["结果再做指纹聚类：只归组不删条目"],
	},
	{
		name: "ehole",
		category: "recon",
		aliases: ["重点系统指纹", "oa", "指纹识别"],
		purpose: "重点系统指纹识别（OA/VPN/Weblogic/通达等国产系统强项）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\EHole\\EHole_windows_amd64.exe",
		invocation: "<path> finger -l <url列表.txt> -t 30 -o <输出.json>",
		hardRules: ["-o 只支持 json/xlsx，用其他扩展名会静默失败（无输出文件）"],
		params: ["finger 指纹模式", "-l url 列表", "-t 30 线程", "-o 输出（json/xlsx）"],
		rate: "-t 30",
	},
	// ------------------------------------------------ recon · 端口与服务
	{
		name: "nmap",
		category: "recon",
		aliases: ["端口", "服务识别", "nse"],
		purpose: "端口 + 服务版本 + NSE 脚本探测（服务识别权威）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\nmap\\nmap.exe",
		invocation: "<path> -sV -Pn -T3 -p <端口集> <目标> -oX <输出.xml>",
		hardRules: ["必加 -T3 及以下（T4/T5 漏端口且易封禁）", "输出必带 -oX（机器可读）"],
		params: ["-sV 服务版本", "-Pn 跳过 ping", "-T3 模板（≤3）", "-oX XML 输出", "--script NSE"],
		rate: "-T3；扫描段越大越要保守",
		traps: ["UDP 扫描慢且不可靠，明确需要才 -sU"],
	},
	{
		name: "naabu",
		category: "recon",
		aliases: ["快速端口", "syn 扫描", "端口发现"],
		purpose: "快速端口发现（SYN/CONNECT/被动），nmap 的前置筛",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\naabu\\naabu.exe",
		invocation: "<path> -host <目标> -top-ports 1000 -rate 500 -auth=false -j -o <输出.jsonl>",
		hardRules: ["必加 -auth=false（默认连 PD 云鉴权，离线会卡死）", "SYN 模式需 Npcap+管理员，无权限自动降 CONNECT", "rate 从 500 起步，护网更低"],
		params: ["-host/-list 目标", "-top-ports 100/1000/full", "-rate 500", "-auth=false", "-nmap-cli 一段出服务版本", "-passive Shodan 被动", "-exclude-cdn"],
		rate: "-rate 500 起步",
		traps: ["只答开没开；服务版本用 -nmap-cli 或交 nmap", "IPv6 不需要时 -ip-version 4"],
	},
	{
		name: "masscan",
		category: "recon",
		aliases: ["大网段", "极速端口"],
		purpose: "大网段极速端口发现（无状态扫描，C 段/B 段首选）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\masscan\\masscan.exe",
		invocation: "<path> <网段/CIDR> -p <端口集> --rate 500 -oL <输出.txt>",
		hardRules: ["依赖 Npcap（已装）；--rate 500 起步绝不加码", "收尾出现 waiting 10-secs 是正常倒计时不是卡死"],
		params: ["-p 端口", "--rate 500", "-oL 列表输出"],
		rate: "--rate 500（护网更低）",
	},
	// ------------------------------------------------ recon · 目录与接口
	{
		name: "dirsearch",
		category: "recon",
		aliases: ["目录扫描", "目录爆破", "path"],
		purpose: `目录爆破（随包通用字典 ${TOOLS_ROOT}\\wordlists\\网站目录字典\\dicc.txt 9638 条，另有全量字典树按目录取用）`,
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\dirsearch\\dirsearch-v0.5.0-windows-x64-threaded.exe",
		invocation: "<path> -u <目标URL> -e php,jsp,asp,aspx,html,js -x 404,403 -w <字典路径> -O <输出.json>",
		hardRules: [`包内 exe 不带内置字典，必加 -w 指向随包 ${TOOLS_ROOT}\\wordlists\\网站目录字典\\dicc.txt`, "必加 -x 404,403 过滤噪声码", "结果只作漏洞证明素材，不做下一步全自动跳转"],
		params: ["-u 目标", "-e 扩展名", "-x 排除状态码", `-w 字典（${TOOLS_ROOT}\\wordlists\\网站目录字典\\dicc.txt）`, "-O json 输出"],
		rate: "默认线程保守；单目标逐个测",
	},
	{
		name: "ffuf",
		category: "recon",
		aliases: ["fuzz", "参数发现", "vhost"],
		purpose: "极速 Fuzz（目录/参数/Host/POST 通用，dirsearch 不够时用）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\ffuf\\ffuf.exe",
		invocation: "<path> -u <目标URL>/FUZZ -w <字典路径> -t 20 -noninteractive -o <输出.json> -of json",
		hardRules: ["必加 -noninteractive（交互模式会挂死编排）", `必带 -w 字典：随包 ${TOOLS_ROOT}\\wordlists\\网站目录字典\\dicc.txt，全量字典树按目录名取用`],
		params: ["-u 含 FUZZ 关键位", "-w 字典", "-t 20 线程", "-noninteractive", "-o/-of 输出", "-X 方法", "-d POST 体"],
		rate: "-t 20",
	},
	// ------------------------------------------------ recon · JS
	{
		name: "urlfinder",
		category: "recon",
		aliases: ["js 接口", "url 提取", "接口发现"],
		purpose: "页面+JS 抽 URL/接口（含 404 fuzz 的源）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\URLFinder\\URLFinder.exe",
		invocation: "<path> -u <目标URL> -m 2 -s 200,403 -o <输出目录>",
		hardRules: ["挖漏洞用 -m 2（-m 3 会过滤危险路由）", "大站 timeout ≥600s"],
		params: ["-u 目标", "-m 2 模式", "-s 200,403 状态码", "-o 输出"],
	},
	{
		name: "linkfinder",
		category: "recon",
		aliases: ["js endpoint", "静态提取"],
		purpose: "JS 静态正则提 endpoint（轻量，配合 URLFinder）",
		tested: true,
		runtime: "python",
		runtimePath: PY310,
		path: TOOLS_ROOT + "\\01_AssetScan\\LinkFinder\\linkfinder.py",
		workdir: TOOLS_ROOT + "\\01_AssetScan\\LinkFinder",
		invocation: "cd <workdir> && NO_PROXY=127.0.0.1,localhost HTTP_PROXY= HTTPS_PROXY= <runtime> linkfinder.py -i <目标URL或js> -d -o cli",
		hardRules: ["必须 cd 到目录", "清代理"],
		params: ["-i 目标（URL/JS 文件/目录）", "-d 含域名", "-o cli 终端输出"],
	},
	// ------------------------------------------------ intranet
	{
		name: "fscan",
		category: "intranet",
		aliases: ["内网扫描", "内网综合", "域扫描"],
		purpose: "内网综合扫描（端口+服务+爆破+漏洞+域信息），拿到内网立足点后的首查工具",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\fscan\\fscan-nolocal.exe",
		invocation: "<path> -h <C段或IP> -nopoc",
		hardRules: ["-h 是 host 参数不是 help（写错会当目标扫）", "首发探测加 -nopoc（只探不利用）", "输出 GBK 编码需转码后解析"],
		params: ["-h 目标/CIDR", "-nopoc 关 POC", "-hf 列表文件"],
		rate: "内网低频；redt 模式须任务书覆盖内网目标",
		traps: ["GBK 转码：iconv -f GBK -t UTF-8"],
	},
	// ------------------------------------------------ exploit
	{
		name: "nuclei",
		category: "exploit",
		aliases: ["模板漏扫", "poc 验证", "点射"],
		purpose: "模板漏洞点射验证（引擎 v3.11.0，本地模板 1.3 万+，随模板库更新浮动）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\02_Exploit\\nuclei\\nuclei.exe",
		invocation:
			`四步点射：①拿指纹(httpx -tech-detect/EHole) → ②grep -ril "<产品关键词>" ${TOOLS_ROOT}\\02_Exploit\\nuclei-templates --include=*.yaml → ③读候选 YAML 确认无破坏性 → ④<path> -t <单个模板.yaml> -u <目标> -rl 10 -c 2 -je <输出.jsonl>`,
		hardRules: [
			"禁全模板扫：不带 -t 或 -t 整目录 = 全扫，等同红线违规",
			"点射≠只射一次：指纹清单有几个指纹就点射几轮",
			"必加 -rl 10 -c 2（默认 -c 25 太猛）",
			"读模板确认匹配条件与破坏性，不适合的排除",
		],
		params: ["-t 单模板（点射核心）", "-u/-l 目标", "-rl 10/-c 2 限速并发", "-je JSONL 输出"],
		rate: "-rl 10 -c 2",
	},
	{
		name: "sqlmap",
		category: "exploit",
		aliases: ["sql 注入", "sqli", "注入利用"],
		purpose: "SQL 注入检测与利用（定位到可疑参数后逐点验证）",
		tested: true,
		runtime: "python",
		runtimePath: PY310,
		path: TOOLS_ROOT + "\\02_Exploit\\sqlmap\\sqlmap.py",
		workdir: TOOLS_ROOT + "\\02_Exploit\\sqlmap",
		invocation: "cd <workdir> && NO_PROXY=127.0.0.1,localhost HTTP_PROXY= HTTPS_PROXY= <runtime> sqlmap.py -r <请求文件.txt> -p <参数> --batch --level 2 --risk 1",
		hardRules: [
			"所有调用一律加 --batch（含 --version/-h，否则停在 Press Enter 挂死编排）",
			"必加 -p 指定参数（否则全参数扫）",
			"无明确注入点不跑（禁全站裸扫）",
			"禁全量 --dump：总量计数 + LIMIT 3~5 最小真实样本证明能拖多少",
		],
		params: ["-r 请求文件（保 Cookie/鉴权，推荐）", "-p 参数", "--batch 非交互", "--level/--risk 默认 1/1", "--dbs/-D --tables 取证链"],
		rate: "--level 2 --risk 1（--risk 3 破坏性慎用）",
		traps: ["产出在 ~/.local/share/sqlmap/output/<host>/", "清代理"],
	},
	// ------------------------------------------------ crypto
	{
		name: "jwt-tool",
		category: "crypto",
		aliases: ["jwt", "jwt 分析", "alg none"],
		purpose: "JWT 全能测试（解析/篡改/alg:none/弱密钥）",
		tested: true,
		runtime: "python",
		runtimePath: PY310,
		path: TOOLS_ROOT + "\\02_Exploit\\jwt_tool\\jwt_tool.py",
		workdir: TOOLS_ROOT + "\\02_Exploit\\jwt_tool",
		invocation: "cd <workdir> && NO_PROXY=127.0.0.1,localhost HTTP_PROXY= HTTPS_PROXY= <runtime> jwt_tool.py <token> <模式flag>",
		hardRules: ["必须带模式 flag（-X a 篡改 / -T 全交互 tamper / -C -d jwt-common.txt 弱密钥）——裸跑进交互菜单挂死编排"],
		params: ["-X a alg none 攻击", "-T 交互篡改", "-C -d <字典> 爆破密钥"],
		traps: [`字典：${TOOLS_ROOT}\\02_Exploit\\jwt_tool\\jwt-common.txt（随包自带）`],
	},
	{
		name: "jwtcrack",
		category: "crypto",
		aliases: ["jwt 爆破", "弱密钥"],
		purpose: "JWT 弱密钥大字典爆破（HS256）",
		tested: true,
		runtime: "python",
		runtimePath: PY310,
		path: TOOLS_ROOT + "\\02_Exploit\\JWTCrack\\CrackJWT_cli.py",
		workdir: TOOLS_ROOT + "\\02_Exploit\\JWTCrack",
		invocation: "cd <workdir> && NO_PROXY=127.0.0.1,localhost HTTP_PROXY= HTTPS_PROXY= <runtime> CrackJWT_cli.py <token>",
		hardRules: ["字典固定 pass.txt（100 万行），分钟级任务——后台跑别阻塞等待", "必须 cd 到目录"],
		traps: ["清代理"],
	},
	// ------------------------------------------------ reverse
	{
		name: "capa",
		category: "reverse",
		aliases: ["恶意能力", "capability 分析", "malware"],
		purpose: "二进制恶意能力分析（shellcode/加载器行为面识别）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\04_Misc\\capa\\capa.exe",
		invocation: "<path> <样本路径> -j",
		hardRules: ["离线分析，不执行样本"],
	},
	{
		name: "radare2",
		category: "reverse",
		aliases: ["逆向", "反汇编", "r2"],
		purpose: "逆向工程框架（反汇编/调试/补丁分析）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\04_Misc\\radare2\\radare2-6.2.4-w64\\bin\\radare2.exe",
		invocation: "<path> -q -c 'aaa; pdf @ main' <二进制>",
		hardRules: ["批处理用 -q -c，禁交互模式"],
	},
	{
		name: "yara-x",
		category: "reverse",
		aliases: ["yara", "规则扫描", "yara 检测"],
		purpose: "YARA 规则匹配（样本家族归类/敏感特征扫描）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\04_Misc\\yarax\\yr.exe",
		invocation: "<path> scan <规则.yar> <目标文件>",
		hardRules: ["CLI 名为 yr（yara-x 1.21+）；规则语法与经典 YARA 高度兼容但个别模块不同"],
	},
	{
		name: "trivy",
		category: "reverse",
		aliases: ["sca", "组件漏洞", "依赖扫描"],
		purpose: "SCA 组件漏洞扫描（文件系统/依赖清单，配合代码审计）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\04_Misc\\trivy\\trivy.exe",
		invocation: "<path> fs <目录> --format json -o <输出.json>",
		hardRules: ["首次运行联网更新漏洞库；离线环境加 --skip-db-update"],
	},
	{
		name: "strings-bin",
		category: "reverse",
		aliases: ["字符串提取", "strings"],
		purpose: "二进制字符串提取（strings/objdump/readelf 三件套，随包带依赖 DLL）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\04_Misc\\binutils\\strings.exe",
		invocation: "<path> <二进制> | grep -iE 'http|key|pass'",
		hardRules: ["objdump/readelf 同目录；分析样本在隔离目录做，别混进项目"],
	},
	// ------------------------------------------------ recon
	{
		name: "katana",
		category: "recon",
		aliases: ["爬虫", "spider", "站点爬取"],
		purpose: "标准/无头爬虫（发现隐藏路径与表单，URLFinder 的动态补充）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\katana\\katana.exe",
		invocation: "<path> -u <目标URL> -d 3 -jc -o <输出.txt>",
		hardRules: ["-d 控制深度（≤3）；频率跟随模式节奏"],
	},
	{
		name: "waybackurls",
		category: "recon",
		aliases: ["历史 url", "web archive"],
		purpose: "Wayback 历史全量 URL（旧接口/失效页面常藏洞）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\01_AssetScan\\waybackurls\\waybackurls.exe",
		invocation: "<path> <域名> | sort -u > <输出.txt>",
		hardRules: ["输出必 sort -u 去重；仅取历史 URL 做线索，别直接当存活资产打"],
	},
	// ------------------------------------------------ intranet
	{
		name: "netexec",
		category: "intranet",
		aliases: ["内网协议", "smb", "winrm", "横向"],
		purpose: "内网协议验证（SMB/WinRM/LDAP/MSSQL 凭据喷洒与枚举，fscan 精细化）",
		tested: true,
		runtime: "direct",
		path: "E:\\env\\python3146\\Scripts\\nxc.exe",
		invocation: "<path> smb <目标> -u <用户> -p <密码> --shares",
		hardRules: ["redt 模式须任务书覆盖；凭据喷洒单轮低频", "需 Python 3.11+（pip 装 git+https://github.com/Pennyw0rth/NetExec；PyPI 已无 netexec 包）"],
	},
	{
		name: "impacket",
		category: "intranet",
		aliases: ["ad 协议", "secretsdump", "psexec"],
		purpose: "AD/Windows 协议套件（secretsdump/psexec/wmiexec 等后渗透动作）",
		tested: true,
		runtime: "python",
		path: "E:\\env\\python3106\\Scripts\\secretsdump.py",
		invocation: "<runtime> <path> <域>/<用户>:<密码>@<目标> <域>/<用户>:<密码>@<目标>",
		hardRules: ["redt 专属：任务书明示允许才用；动作全部留证", "示例脚本在 <runtime> 同级 Scripts/ 下"],
	},
	// ------------------------------------------------ cloud（只读口径）
	{
		name: "aws-cli",
		category: "cloud",
		aliases: ["aws", "s3", "云凭证"],
		purpose: "AWS 只读枚举（SSRF 拿到云凭证后的资源面确认）",
		tested: true,
		runtime: "direct",
		path: "E:\\env\\python3106\\Scripts\\aws.cmd",
		invocation: "<path> s3 ls --profile <凭证>；<path> sts get-caller-identity",
		hardRules: ["只读枚举（ls/get/list 类）；禁任何写/删操作"],
		installHint: "环境依赖：PY310 Scripts 下的 pip 包（awscli）",
	},
	{
		name: "az-cli",
		category: "cloud",
		aliases: ["azure", "az", "云凭证"],
		purpose: "Azure 只读枚举（SSRF 拿到云凭证/token 后的资源面确认）",
		tested: true,
		runtime: "direct",
		path: "E:\\env\\python3106\\Scripts\\az.bat",
		invocation: "<path> account show；<path> webapp list；<path> storage container list",
		hardRules: ["只读枚举（show/list/get 类）；禁任何写/删操作"],
		installHint: "环境依赖：PY310 Scripts 下的 pip 包（azure-cli）；离线料在 tools/05_Cloud/wheels",
	},

	{
		name: "gcloud-ro",
		category: "cloud",
		aliases: ["gcp", "google cloud", "云凭证"],
		purpose: "GCP 只读枚举（SSRF 拿到元数据凭证后的资源面确认）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\04_Misc\\gcloud\\google-cloud-sdk\\bin\\gcloud.cmd",
		invocation: "<path> storage ls gs://<bucket>；<path> compute instances list --project <proj>",
		hardRules: ["只读（ls/list/describe）；禁 create/delete/set 操作", "凭证经 CLOUDSDK_CORE_ACCOUNT/GOOGLE_APPLICATION_CREDENTIALS 注入，勿写配置文件"],
		installHint: "随包内置（tools\\04_Misc\\gcloud），无需安装",
	},
	{
		name: "kubectl-ro",
		category: "cloud",
		aliases: ["k8s", "kubernetes"],
		purpose: "K8s 只读枚举（未授权 kubelet/面板后续确认）",
		tested: true,
		runtime: "direct",
		path: TOOLS_ROOT + "\\04_Misc\\kubectl\\kubectl.exe",
		invocation: "<path> --server=<api地址> --insecure-skip-tls-verify get pods -A",
		hardRules: ["只读（get/list/describe）；禁 apply/delete/exec"],
	},
	// ------------------------------------------------ intranet · 隧道/代理（改良6：横向"成网"，全部扩展位起步）
	{
		name: "chisel",
		category: "intranet",
		aliases: ["隧道", "tunnel", "socks5", "内网穿透", "socks"],
		purpose: "内网隧道：把边缘节点/本机流量经 socks5/TCP 通道转发进内网",
		tested: false,
		runtime: "direct",
		path: TOOLS_ROOT + "\\03_Intranet\\chisel\\chisel.exe",
		invocation: "<path> client <边缘IP>:<port> R:<远程端口>:127.0.0.1:<本地端口>；socks 动态转发加 R:socks",
		hardRules: [
			"红线：仅在任务书/授权范围内使用（redt 围栏条款），任何隧道建立前先 record_fact 说明拓扑与用途",
			"服务端端口必须用已拿到内网主机上的可用端口，禁撞业务端口",
			"隧道建立后必须做 2 次连通性验证（经 socks 代理 curl 内网 IP）才继续",
			"会话结束必须清理隧道进程与端口占用（taskkill/杀进程树），禁遗留常驻进程",
			"chisel 客户端/服务端版本需一致；Windows 优先用官方 exe 而非 go build",
		],
		params: ["-v 版本", "server|client", "R: 远程转发", "R:socks 动态代理"],
		rate: "持久隧道，建立一次即可",
		traps: ["版本不匹配静默失败", "Windows 防火墙需放行自定义端口"],
		installHint: "下载 https://github.com/jpillora/chisel/releases（chisel windows amd64）放 tools/03_Intranet/chisel/",
	},
	{
		name: "frp",
		category: "intranet",
		aliases: ["内网穿透", "frps", "frpc", "隧道"],
		purpose: "内网穿透：frps/frpc 架构把内网服务映射到边缘节点",
		tested: false,
		runtime: "direct",
		path: TOOLS_ROOT + "\\03_Intranet\\frp\\frpc.exe",
		invocation: "<runtime> -c <frpc.toml>（config 由本地模板水合：server_addr/remote_port/type=socks 等）",
		hardRules: [
			"红线：仅任务书/授权范围；frps 只跑在已控制的边缘节点，禁公网裸跑无人值守服务",
			"config 落本地 tmp 目录，会话结束删除并杀进程",
			"remote_port 避开业务端口；type=socks 时本地写死 127.0.0.1 监听",
		],
		params: ["-c 配置文件", "server_addr 服务端", "remote_port 远端端口"],
		traps: ["frp 0.52+ 用 toml 配置，旧 ini 不兼容"],
		installHint: "下载 https://github.com/fatedier/frp/releases（frp windows amd64）放 tools/03_Intranet/frp/",
	},
	{
		name: "proxychains",
		category: "intranet",
		aliases: ["代理链", "socks 代理", "proxychains4"],
		purpose: "把本机命令的流量经 socks 代理链转发进内网（配合 chisel/frp 隧道）",
		tested: false,
		runtime: "python",
		runtimePath: PY310,
		path: TOOLS_ROOT + "\\03_Intranet\\proxychains\\proxychains4.exe",
		invocation: "<path> -f <代理链配置> <命令>（配置：socks5 127.0.0.1 <隧道本地端口>）",
		hardRules: [
			"红线：代理链仅用于任务书授权范围内的内网目标",
			"禁把代理链用于外网大流量（绕审计）；DNS 走 tunnel 模式防泄漏",
			"隧道进程没了代理链立即失效——先穷举工具（nmap/fscan）再起代理，顺序不可逆",
		],
		params: ["-f 配置文件", "-q 安静", "<命令> 目标命令"],
		installHint: "下载 proxychains-windows 构建放 tools/03_Intranet/proxychains/",
	},
	{
		name: "ssh-tunnel",
		category: "intranet",
		aliases: ["SSH 隧道", "ssh 转发", "端口转发", "-L", "-R"],
		purpose: "SSH 端口转发/动态代理（本地 -L / 远程 -R / 动态 -D，需已拿 SSH 凭据或密钥）",
		tested: false,
		runtime: "direct",
		invocation: "ssh -D 127.0.0.1:<本地端口> -N -o StrictHostKeyChecking=no <用户>@<边缘IP>（动态代理）或 -L <本地>:<目标>:<远程端口>",
		hardRules: [
			"红线：仅任务书授权范围；凭据来自已确认的利用/爆破结果，禁公网裸扫",
			"-N 不执行远端命令，防误触发业务动作；-o BatchMode=yes 防交互挂死",
			"会话结束 kill ssh 进程（Windows：taskkill /IM ssh.exe /F 按需）",
		],
		params: ["-L 本地转发", "-R 远程转发", "-D 动态代理", "-N 不执行命令"],
		traps: ["Windows OpenSSH 与 Git Bash ssh 命令行为差异", "多跳需 ProxyJump 而非嵌套 -L"],
		installHint: "系统自带 OpenSSH，无需安装；仅需已被控边缘节点上的 SSH 服务与凭据",
	},
	{
		name: "socat",
		category: "intranet",
		aliases: ["端口转发", "中继", "tcp 转发"],
		purpose: "TCP/UDP 端口转发与中继（不依赖 SSH 的双向盲转发）",
		tested: false,
		runtime: "direct",
		path: TOOLS_ROOT + "\\03_Intranet\\socat\\socat.exe",
		invocation: "<path> TCP-LISTEN:<本地端口>,fork,reuseaddr TCP:<目标>:<目标端口>",
		hardRules: [
			"红线：仅任务书授权范围；fork 模式会持续监听，会话结束必须杀进程",
			"中继端口避开业务端口；转发链每跳 record_fact 记录",
		],
		params: ["TCP-LISTEN: 监听", "fork 多连接", "reuseaddr 端口复用"],
		installHint: "下载 socat windows 构建放 tools/03_Intranet/socat/",
	},
	// ------------------------------------------------ intranet · 提权枚举（改良7：权限提升专用工具）
	{
		name: "linpeas",
		category: "intranet",
		aliases: ["提权", "peass", "linux 枚举", "suid"],
		purpose: "Linux 提权枚举：SUID/环境变量/内核/服务弱权限/凭证检索一键出报告",
		tested: false,
		runtime: "direct",
		path: TOOLS_ROOT + "\\03_Intranet\\linpeas\\linpeas.sh",
		invocation: "bash <path> -a > <输出文件> 2>&1（上传目标后执行）",
		hardRules: [
			"上传仅走已拿到的 RCE/写入通道（bash 是本机执行器，目标侧命令只能经漏洞利用通道）",
			"产物先落目标或回传文件再解析，禁超长终端输出直读",
			"枚举结果逐条 record_fact（版本/SUID/弱权限），不重复跑",
		],
		params: ["-a 全量", "-s 静默", "-e 加速"],
		traps: ["目标无 bash 或受沙箱限制时换静态版", "输出 GBK/超长需先落文件"],
		installHint: "下载 https://github.com/peass-ng/PEASS-ng/releases（linpeas.sh 或 linpeas_linux_amd64）放 tools/03_Intranet/linpeas/",
	},
	{
		name: "winpeas",
		category: "intranet",
		aliases: ["提权", "peass", "windows 枚举"],
		purpose: "Windows 提权枚举：服务弱权限/未防护路径/token 权限/凭据检索一键出报告",
		tested: false,
		runtime: "direct",
		path: TOOLS_ROOT + "\\03_Intranet\\winpeas\\winPEASx64.exe",
		invocation: "<path> quiet cmd fast -outputfile <输出文件>",
		hardRules: [
			"上传仅走已拿到的执行通道；静默模式禁交互挂死",
			"-outputfile 落文件再解析，禁终端超长输出直读",
			"枚举到的高价值项（服务路径/账号权限）record_fact 记录",
		],
		params: ["quiet 静默", "cmd 控制台模式", "fast 快速", "-outputfile 落文件"],
		traps: ["Defender 可能杀掉弱特征版本——用签名 exe 或 python 版", "outputfile 需目标可写目录"],
		installHint: "下载 https://github.com/peass-ng/PEASS-ng/releases（winPEASx64.exe）放 tools/03_Intranet/winpeas/",
	},
	{
		name: "suid-scan",
		category: "intranet",
		aliases: ["提权", "suid", "linux 枚举", "setuid"],
		purpose: "SUID 位文件枚举 + 风险匹配（自定义姿势模板卡，无二进制，Linux 目标侧执行）",
		tested: false,
		runtime: "direct",
		invocation: "find / -perm -4000 -type f 2>/dev/null（目标侧 shell 通道内执行；按目标 OS 取 bash/sh）",
		hardRules: [
			"目标侧命令仅走已拿到的 shell 通道（本机 bash 不是目标机 shell）",
			"SUID 命中与 GTFOBins 已知提权链匹配后才设计利用，禁盲试",
		],
		params: ["-perm -4000 SUID 查找", "-perm -2000 SGID"],
		installHint: "无二进制：姿势模板卡，直接走目标 shell 通道",
	},
];


