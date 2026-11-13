# Changelog

## 2.9.0（2026-11-13）— 接口状态机端到端离线验收与 CI

- 新增 `acceptance/matrix.test.ts`，覆盖端点状态流转、多源输出水合、实时快照、终端看板、大产物归档、结案门禁、差分复验与命令防护八组离线验收；
- 新增 GitHub Actions 工作流，在 Node.js 22 下执行类型检查、机制验收与已有回归测试；
- 使用失败即抛错的断言，测试产物隔离到临时目录，避免断言失败被 CI 误报为成功；
- 保留已有脱敏路径、单目标凭据分析与桌面进程清理修复；同步版本号、lockfile 与 README 徽标至 `2.9.0`。

## 2.8.1（2026-11-13）— pix-doctor 运行环境与网络驱动健康巡检

- 新增 `scripts/pix-doctor.mjs`，检查 Node.js、Python、Git、Npcap/WinPcap 状态；
- 检查本机 30141/30142 端口占用，并核对核心扩展模块文件是否齐全；
- 针对异常输出修复建议，并返回标准退出码以供自动化部署检查；
- 版本号、lockfile 与 README 徽标同步升级至 `2.8.1`。

## 2.8.0（2026-11-13）— 原生桌面客户端集成 30142 攻击面实时看板

- Electron 桌面客户端启动时在检查 30142 端口后按需拉起 `matrix-server.mjs`，避免重复启动；
- 系统托盘增加攻击面实时进度看板入口，并显示 Web/Matrix 服务状态；
- 退出流程仅终止由桌面客户端启动的子进程，避免宽泛按端口清理误伤其他 PiX 实例；
- `PiX-Web.cmd` 在 Web 服务已运行时检查并补启矩阵服务；停止脚本确认 30141/30142 均释放；
- 版本号、lockfile、README 徽标与 CHANGELOG 同步升级至 `2.8.0`。

## 2.7.1（2026-11-12）— 零依赖 30142 SSE 实时只读资产监控大屏

- 新增 `scripts/matrix-server.mjs`，使用 Node.js 原生 http/fs/path 提供本地 SSE 实时大屏与 `/api/matrix` 只读快照接口；
- `PiX-Web.cmd` 启动流程增加 30142 矩阵服务，显示大屏地址；
- `scripts/stop-pix.mjs` 增加 30142 监听端口与 `matrix-server.mjs` 后台进程清理；
- 服务明确拒绝非 GET/HEAD/OPTIONS 方法，返回 405，保持纯只读遥测；
- HTTP 冒烟测试：GET `/api/matrix` 返回 200；POST `/api/matrix` 返回 405；SSE `/events` 返回 `text/event-stream`。

## 2.7.0（2026-11-12）— JIT 战术同义词路由、查询缓存与结构感知上下文切片

## 2.7.0（2026-11-12）— JIT 战术同义词路由、查询缓存与结构感知上下文切片

- 扩展 ADCS/ESC1、NTLM/PTH、Kerberos/ticket、tunnel、lateral 等战术同义词路由，并提高别名目标匹配权重；
- 增加最多缓存 128 项的内存 LRU 风格检索缓存，重复查询复用结果；
- 调整 Markdown 章节切片：优先保留 SOP、Playbook、代码块与高价值章节，按长度预算裁切；
- 新增针对 alias 路由、章节优先级、长度预算和缓存复用的离线定向测试；
- 发行范围仅包含通用加载器代码和公开测试，不包含本地私有 `skills/xt` 内容；
- 版本号、lockfile 与 README 徽标同步升级至 `2.7.0`。

## 2.6.1（2026-11-11）— 宿主机危险命令与不可信下载执行物理防护

- 扩展 Bash/PowerShell 破坏性命令指纹，覆盖磁盘覆写、卷影删除、引导配置破坏及关键目录权限误改；
- 新增 `curl/wget | shell` 与 PowerShell `IEX` 下载执行模式的命令级识别与拦截；
- 测试仅调用防护识别函数，不会实际执行危险命令；
- 版本号、lockfile 与 README 徽标同步升级至 `2.6.1`。

## 2.6.0（2026-11-11）— 38 款武器卡实战参数硬化与授权范围内阻抗处理指引

- 更新 SQLMap 卡：明确单参数、低风险、限速、授权范围与最小化取证约束；
- 更新 NetExec 卡：补充本地账户与哈希参数说明，并强化单轮低频、防账号锁定要求；
- 更新 Impacket 卡：规范哈希认证参数及任务书授权边界；
- 保持工具路径使用仓库相对根目录、系统 PATH 或环境变量，不引入开发机私有绝对路径；
- 版本号、lockfile 与 README 徽标同步升级至 `2.6.0`。

## 2.5.1（2026-11-11）— 标准 targets.csv 与多格式事实底表导出

- 新增 `exportTargetsCsv`，导出 EndpointID、Host、Port、Protocol、Method、URL、Params、Status、测试次数、失败计数、漏洞及时间字段；
- CSV 字段采用标准双引号包裹及双引号转义，便于表格软件和下游流水线解析；
- `/facts csv` 与 `export_facts` 的 `format: "csv"` 均可导出 `pix-targets-<timestamp>.csv`；
- 同步安装器所需模块清单、`package.json`、lockfile、README 徽标与 CHANGELOG 至 `2.5.1`。

## 2.5.0（2026-11-10）— 基于阻断反馈的自适应 Payload 变异生成器

- 新增 `extension/mutator.ts` 五级变异流水线：编码置换、语法混淆、请求头伪造、协议分块及语义等价替代；
- 新增 `mutate_payload` 工具契约，按漏洞类别与最高变异等级生成候选变异向量及请求头建议；
- 与 `verify_finding` 二次差分复验、`bypassing` 状态及 Anti-Sloth/L4 门禁协同；
- 版本号、README 徽标与发行元数据同步升级至 `2.5.0`；
- **适用范围**：仅限已授权安全测试、自建靶场与防御性研究；不得用于未授权目标、破坏性测试或拒绝服务。
- **验收说明**：离线套件 28/30；2 项未通过分别是测试环境缺少本地 sqlmap 工具文件，以及旧套件要求新会话自动继承历史画板（与本版本采用的用户要求“新会话默认纯净”策略冲突）。

## 2.4.0（2026-11-09）— Anti-Sloth 刚性结案门禁与 L4 深度证伪校验

- 新增 `agent_before_settle` Anti-Sloth 门禁：存在未闭环端点时拒绝提前结束，并提示优先端点；
- `update_endpoint` 在状态改为 `rejected` 前执行 L4 证伪检查，少于 3 次测试则拒绝流转；
- 增加 `verifyAntiSlothGate` 与 `verifyL4Falsification` 门禁函数；
- 修复 `tactical-loader.ts` 严格编译结构及未使用导入，统一相关模块类型导入；
- 版本号、README 徽标和发行元数据同步升级至 `2.4.0`。

## 2.3.0（2026-11-09）— 基于接口台账闭环率的实时调度提示词投影

- `rules.ts` 每轮动态计算全局端点闭环率、坐实数、变异中与探针中指标；
- 自动推导 Top 4 待测优先攻坚队列，注入端点编号、方法、URL、参数与连续失败阻抗计数；
- 强制模型优先从台账队列中攻坚，发送探针/变异后立即调用 `update_endpoint` 回写状态机；
- 修复 `tactical-loader.ts` 基线循环闭合问题，并清理严格模式未使用类型导入；
- 版本号、README 徽标与发行元数据同步升级至 `2.3.0`。

## 2.2.1（2026-11-08）— /matrix 终端交互式接口闭环进度总览视图与证据下钻

- 新增 `extension/matrix-view.ts`：ANSI 终端攻击面与接口闭环测试看板；
- 支持 `/matrix` 与 `/ledger` 斜杠命令，动态渲染闭环率、七态彩色徽标与 Top 3 待测优先队列；
- 新增 `/matrix <ep_id>` 单端点深度下钻，呈现完整 `testHistory`、原始请求包与响应差分证据；
- 强化 `tactical-loader.ts` JIT 战术检索、结构感知切片与外部技能目录容错装载；
- 版本号、README 徽标与发行元数据同步升级至 `2.2.1`。

## 2.2.0（2026-11-07）— 原子化实时测试进度镜像总线 (Live Matrix Bus)

- 新增 `extension/live-matrix.ts`，建立状态机与外部观察者之间的实时数据镜像通道；
- 引入 500ms 内存防抖定时器，避免高频侦察/扫描引发频繁磁盘 I/O；
- 实现原子防撕裂快照双写：临时文件写入后原子重命名覆盖 `cwd/pix-live-matrix.json`；
- 聚合输出全站闭环百分比、七态漏洞漏斗指标与当前探测焦点 `currentFocus`；
- 打通 `record_host`、`record_endpoint`、`update_endpoint` 以及 sniffer 自动水合后的实时矩阵广播；
- 版本号、README 徽标与发行元数据同步升级至 `2.2.0`。

## 2.1.1（2026-11-06）— 多源工具输出流端点与参数特征自动水合感知器

- **物理流正则感知管道升级 (Physical Stream Sniffer)**：多源渗透工具物理回显 100% 自动入账
  - Dirsearch 目录爆破：精准提取 200/301/302/403 状态码与相对路径，自动结合命令推导 Base URL 完整拼接
  - Ffuf Web Fuzz：自动提取 Fuzz 成功路径与对应 HTTP 状态码
  - Katana 爬虫：支持动态捕获 `[GET]/[POST]/[PUT]/[DELETE]` 方法与绝对 URL
  - LinkFinder / rg_cli / URLFinder：精准抽取 JS 动态路由与隐藏 API 接口（支持 `/api/v1/...` 等高价值前缀）
  - Nuclei 漏洞扫描：自动匹配 `[vuln-id] [severity]`，识别 critical/high 并流转为 `confirmed` 坐实态，绑定规则指纹
- **静态资源黑名单拦截**：自动剔除 `.png/.jpg/.css/.js/.woff2` 等无渗透价值噪音
- **自动查询参数结构化提取**：解析 URL 查询字符串为 `params[]`，供后续 Fuzz 与状态机反哺调度直接消费

## 2.1.0（2026-11-06）— 端点台账七态流转模型与关键证据链数据结构

- **EndpointStatus 七态流转模型**：`discovered` → `probing` → `bypassing` → `escalating` → `confirmed` / `rejected` / `blocked`
- **EndpointNode 完整因果证据链**：`evidenceRequest` / `evidenceResponse` / `diffSignature` / `failureStreak` / `escalationLevel` / `testHistory`
- **状态管理函数增强**：`updateEndpointStatus` 兼容旧签名并支持实证对象高阶流转；`getPendingEndpointsQueue` 动态优先级队列；`getMatrixMetrics` 闭环率与漏斗聚合
- **index.ts 与 exporter.ts 全面对接**：`update_endpoint` 支持证据链传参与七态标识导出

## 2.0.0（2026-11-02）— PiX-RedTeam: 4D 内网超图 · Sapper 军团架构 · 纯 CLI 武器库融合

基于第一性原理对 PiX-Agent 进行全方位重构，彻底突破 Web 渗透局限，赋予其打穿企业内网与 Active Directory 域环境的完整红队作战能力：

- **4D 内网超图引擎 (`state.ts`)**：
  - 新增主机资产 (`HostNode`: 多网卡/系统/所属域/DC角色/PWNED控制状态/开放端口增量合并)
  - 新增跳板路由 (`PivotSessionNode`: Socks5/FRP/SSH/TUN 隧道与内网可达网段映射)
  - 新增凭据金库 (`CredentialNode`: NTLM Hash/Kerberos/明文/权限范围/已打通目标列表)
  - 自动映射画板拓扑，支持原子防撕裂快照与跨会话知识继承
- **跳板感知透明路由运行时 (`pivot-router.ts`)**：
  - 针对内网目标的命令自动识别路由并注入 `proxychains.conf` 代理链包裹执行，实现零感知透传
- **JIT 即时战术装载器 (`tactical-loader.ts`)**：
  - 支持按需索引外部攻防武器库与资产测绘管线，内置 ADCS/PTH/Kerberos/提权/绕过同义词路由，按需动态检索提取核心 SOP，杜绝 Prompt 上下文爆炸
- **纯 CLI 武器库重构 (`tools/` & `toolbox-data.ts`)**：
  - 剔除 `suid-scan`, `aws-cli`, `az-cli`, `gcloud-ro`, `trivy`, `naabu` 等 6 款鸡肋与冗余工具
  - 引入 5 大红队王牌：**转子女神 (rg_cli.py 纯CLI无头包装)**、**Certipy (ADCS域提权)**、**BloodHound (域拓扑采集)**、**pypykatz (内存密码提取)**、**ligolo-ng (极速TUN穿透)**
  - 38 款武器 100% 具备纯 CLI AI 直接调用能力，物理文件就绪率 100%
- **门禁看门狗与条令净化 (`gate.ts` & `rules.ts`)**：
  - 彻底拔除强制 `howto` 读卡硬门禁与 65% 死代码，释放智能体行动自由度；保留 600s 确定性看门狗超时防挂死
  - 提示词条令全面升级为 4D 超图拓扑驱动的内网作战兵法
- **红队全景交付报告管线 (`report.ts`)**：
  - 一键输出《内网存活与受控主机全景表》、《内网跳板与隧道穿透拓扑》、《脱敏凭据金库与权限流转表》与漏洞攻击链配图
- **TypeScript 严格模式**：全量 TS 模块类型检查 `0` 错误，并通过端到端自动化验收驱动测试。

三轮会话核查（33 失败题逐会话分类）+ 三方审查后实施的全量改良，验收 32/32 · tsc strict 0 error。

- **跑批调度重建（P0，bench-run.mjs）**：
  - 槽位感知调度器 SlotScheduler——平台容器地址池极小（实测 .24/.25/.26），start 撞被占地址即 409；信源 = challenges API 的 container_status，跨 runner 共享仲裁（多实例并行零冲突），start 前准入等待（容量默认 2，`--slot-capacity` 可调）
  - 409 双保险：goal 注入恢复剧本（close→等 30~60s→重试 ×3 轮）+ 会话结束 startOutcome 判定 → pendingRetry 回头重试队列（时间退避 10min×次数，封顶 20min，最多 3 次回头；跨重启从 progress 历史续命）+ 连续 3 题 409 全局冷却 300s
  - 复核式释放 releaseContainer：close→20s→challenges 复核 container_status/地址清空，最多 3 轮；未释放 → zombie 标记 + zombie.log + 调度绕行；防 e3-04 类僵尸槽位毒化后续
  - goal 增补限时节奏（前 5min 侦察 / 单方向 ≤5min 换向 / 剩 5min 收口）
- **409 自主恢复剧本（P2，extension/tsecbench.ts + rules.ts）**：errorHint 重写（409=地址池冲突非任务结束，恢复剧本明确化，不再"告知用户+勿重试"）；评测纪律增补【评测无人值守条款】（跑批自救，3 轮无效才记录阻塞）
- **画板 cwd 级持久化（P3，extension/state.ts + index.ts）**：persist 双写 cwd/pix-state.json（原子写）；全新会话 session_start 读回【历史画板·上次会话进展】摘要注入 section（不并入 state 本体，防并发误继承）；bench-run 超时重跑注入最新 pix-snapshots 快照（防重复侦察）
- **时间预算感知（P4）**：get_state 暴露 elapsedMin；评测长会话剩余 <5min 注入【收口冲刺】段（`PIX_TIME_BUDGET_MIN` 可调）；pacing 收口强制 0.5× 提速
- **工具面补强（审查项）**：新增 8 张工具卡——隧道/代理 5（chisel/frp/proxychains/ssh-tunnel/socat）+ 提权枚举 3（linpeas/winpeas/suid-scan），全部扩展位起步（合规红线首条）；REDT_EXTRA 内网横向 playbook（fscan→netexec pass-the-hash→chisel socks5 隧道→逐跳留证）；【提权 playbook】条件注入（具备 RCE 能力才注入，省 token）
- **路径配置化（审查项）**：toolbox-data 路径配置链 = 环境变量 → 扩展目录 pix-config.json（install 写入）→ 默认；跨机分发零手工
- **验收自动化（审查项）**：scripts/ci-acceptance.mjs 一键（一致性检查→自动部署→验收→退出码）；run-acceptance 新增 v1.1 断言（历史画板读回 / 无人值守条款 / 收口冲刺 / elapsedMin）31→32 项
- 文档口径同步：README/extension README/tools README/index 欢迎语 31→39 卡、验收 32/32
- **深度审查 v2 修复（D1-D7，第二轮）**：B1 409 回头重试 attempts 计数失效（独立 retryCount Map + rec.attempts 持久化，上限 3 真正生效）；B2 releaseContainer 快速路径（已释放题 0 等待，成功题不再净 +20s）；A1 tsecbench 错误透传服务端 message 原文（截断 300）；D4 收口条件公共化 isTimeRushActive（rules/pacing 共用，普通会话不泄漏提速）；D5 mirror vuln_add 跳过条件收紧 + goal 授权登记范围正则（无范围 goal 不污染 auth）；D6 waitForSlot 任务结束立即抛错不空等 + idle 等待改最近到期 capped 3min；D7 失效注释纠偏

## 0.7.0（2026-10-13）— 移除画板可视化 UI（用户拍板：画板是给 AI 梳理思维的，AI 自己知道就行）

- **整体下线画板 UI 三件套**：删除 extension/board-server.ts（:30146 数据端+画板页）、
  scripts/pix-board.mjs（独立入口）、patch-piweb 画板按钮注入（改为纯剥除模式，幂等
  清理历史注入的 v1/v2/v3 marker 块）；pix-web.cmd 不再拉起画板服务；install FILES 收敛
- **保留**：state.ts 图谱模型（record_fact/capability/failure/update_node 四类节点——
  AI 思维工具本体）、/pix export 文本导出、agent_end 自动快照、boardOverlay/
  mergeBoardEdits 数据模型（老会话 JSONL 里 pix-board-edit 条目的读回兼容，不再有新
  条目产生）、报告/镜像等全部 agent 侧能力
- 迁移：git tag `board-v3` 锚定可视化时代的完整实现（2a72976），需要时可复活
- 验收 31/31 · section 6/6 · sensor 16/16 · 门禁 10/10 · 正则 7/7 · tsc 0 error；
  真机复验：画板按钮/host 全消失、30146 已死、推理菜单补丁无回归

## 0.6.0（2026-10-13）— 画板 v3：excalidraw 内核 · 会话 1:1 · 内嵌主区 · 双向同步

以 excalidraw-0.18.1 源码调研为基座（坐标变换/手势状态机/Canvas RAF/嵌入契约四件套
移植，roughjs/React/协作栈不抄），按用户四条硬需求整体重做画板：

- **内嵌主内容区（禁新页/弹窗/全屏）**：patch-piweb v3——「画板」按钮 toggle，向对话
  主列 .chat-content append absolute host（iframe→30146 数据端），顶部工具栏与侧栏
  全程可见；Esc 关闭；URL ?session= 400ms 跟随（侧栏切会话画板自动换）；v1/v2 注入块
  自动剥除迁移
- **画板=未归档会话 1:1**：board-server v3——uuid 维度扫描（文件名解析），读
  pi-web-session-state.json 过滤 archivedAt；归档→列表消失+画板只读（POST 409）；
  删除→会话文件没了画板自然没了；空 state 会话有空态画板（计数=未归档会话数）
- **画布编辑同步回 Agent**：POST /api/board/edit → 追加 pix-board-edit 条目进会话
  JSONL（11 种 op：便签 add/edit/move/del、笔画、节点偏移、node.status、用户连线、
  overlay.sync）；扩展 before_agent_start/session_start 按 boardEditWatermark 水位线
  幂等合并（state.ts mergeBoardEdits）——便签文字全文注入 section【用户画板改动】，
  状态标记直写节点（用户=最高权限审计员），视觉层（笔画/偏移/连线）不进报告
- **Canvas 内核（excalidraw 移植）**：视口三元组+鼠标锚点缩放（滚轮=缩放，空处拖=平移）、
  pointer 手势状态机（window 级 move/up，10px/zoom 点击/拖拽阈值）、RAF 全量重绘、
  YJ tidy-tree 基准布局+用户偏移叠加、>8 子女折叠双击展开；局部工具条（选择/便签/
  画笔/连线/适应视图/自动布局/缩放%）+ 节点抽屉（详情+✓确认/✗否证同步按钮）；
  5s 签名轮询（手势中/队列非空跳过）；**浅色主题与 pi-web 统一**
- **质量闸门**：内联 JS 一律字符串拼接（禁反引号/${）+ check-board 单元 new Function
  语法闸门；uuid 正则校验防路径穿越；单批 edits≤200/条≤64KB
- 验收 31/31 · 单元：board 31/31 · section 注入链 6/6 · sensor 16/16 · 门禁 10/10 ·
  正则 7/7 · tsc 0 error；真机 E2E 四条需求活体闭环（含 stub 会话发消息实证
  水位线合并+section 注入+pi 对 pix-board-edit 条目零兼容问题）

## 0.5.0（2026-10-12 晚）— 画板可视化 + 归档滚动清理

- **画板可视化**：工具栏「工具」右侧新增「画板」按钮（patch-piweb 注入，MutationObserver
  幂等防 React 重挂）→ 单页画板 :30146——会话切换栏 + 双 Mermaid 图（思维导图/关系图，
  leads_to 攻击链加粗，>40 节点折叠防卡）+ 节点/失败方向明细表 + 态势行 + 10s 轮询
  自动刷新。数据 = 会话 JSONL 的 pix-state 条目全量扫描（覆盖全部历史会话）；
  mermaid v12 vendored（extension/vendor，MIT，离线可用）
- **服务形态**：独立进程 scripts/pix-board.mjs 为主入口（pix-web.cmd 一并拉起——pi-web
  懒加载扩展，全新启动时按钮会扑空）；扩展内 startBoardServer 保留作会话内兜底
  （EADDRINUSE 幂等让位）；PIX_BOARD_PORT 可换端口
- **归档滚动清理（keep-100）**：sessions-prune.mjs——按 archivedAt 倒序保留最新 100，
  超额删 JSONL+双向清簿记（原子写+revision 递增），只碰归档绝不触碰活跃会话，
  dry-run 默认/--exec 才删/清单落 prune-log.txt；bench-run 每题收尾自动挂载；
  一次性清理 91 个归档（用户拍板，19.3MB，实锤 F10 僵尸 runner 曾空烧到 c-03）
- 验收 31/31 · 单元：prune 12/12 · 画板 11/11 · 门禁 10/10 · 传感器 16/16 · 正则 7/7

## 0.4.0（2026-10-12）— 工具内置化 + 纪律机制化改造

三轮跑批复盘（F1-F12）+ 平行系统联动审计（N1-N5）+ 源码深查（T1-T11）全量落地，验收 31/31。

- **工具内置化（用户拍板：整包囊括所有工具）**：30 工具+全量字典树+nuclei-templates+
  radare2/gcloud/kubectl 物理内置仓库 `tools/`（29 目录 2.1GB，文件数+字节逐一核对，
  本机工具源目录零改动）；卡路径 TOOLS_ROOT 化（PIX_TOOLS_ROOT/PIX_PY310 逃生口保留）；
  **删除一键安装全套**（setup-tools/setup/pack-tools/覆盖层 ~/.pix/tools.json）——项目即整包
- **读卡门禁（机制保证）**：gate.ts——bash/powershell 命令命中注册表工具但本会话未
  howto → 拦截并指示读卡（跑批实测遵从率 0.6% 的对症药）；token=卡名+可执行名+脚本名，
  防误伤单元断言 10/10；**600s 默认超时注入**（pi bash 无默认超时=F1 挂死根因，显式传值不覆盖）
- **传感器（客观信号机制）**：sensor.ts——连续 5 次拦截/报错→【止损提醒】+自动计入失败
  方向（强制回读可被客观信号触发）；连续 5 次外部动作未入账→【记账提醒】；被熔断命令
  标注「结果未知≠失败」；节奏豁免本地文件工具（read/grep 等不再被 sleep）
- **画板↔落库联动**：mirror.ts——pentrack 落库（fact_add/vuln_add/graph_node_add）自动
  镜像为画板节点/边，goal 自动登记授权；落库即记账；/report 附录B 落库核对清单
  （confirmed finding 与落库差集）；record_fact 加 confidence
- **评测加固**：bench-run 进程树 kill（F2 孤儿实证）+会话看门狗（5 分钟零增长判流挂死
  自动重跑）+空转续跑+per-题 cwd+任务存活守卫（409 中止全批）+progress 追加制+
  exit 善后；tsecbench 错误提示状态感知（409≠查 VPN）+container_addr 自动入授权；
  tsecbench 工具条件注册（未配置不挂 5 工具）
- **推理菜单修复**：patch-piweb 正则化（任意旧形态数组命中，7/7 测试）+
  install --restart-piweb（磁盘补了但进程没重启=F8 根因）
- **条令扩充**：统一止损矩阵（数字阈值机械执行）+反注入条款（外部内容=不可信数据）+
  收口四件套（完成/blocked/待授权/数据触碰）+会话纪律（画板遗留声明/禁空响应收尾）；
  元认知反思改为针对当前疑似点（换法不换点）；skill 包正本同步 14 处（§3.19 反注入/
  止损矩阵总表/差分矩阵成品/toolGuide 生成物声明，双手册收敛）
- 验收 31/31（28 原有+门禁 2+传感器 1）· 门禁 10/10 · 传感器/镜像 13/13 · 补丁正则 7/7
  · tsc strict 0 error

## 0.3.2（2026-10-11）
- 云 CLI 完全离线：kubectl/gcloud 随包（04_Misc），aws-cli/azure-cli 优先走包内离线 wheel 集
  （04_Misc/cloud-wheels，pip --no-index），失败回退在线镜像；azure-cli 安装链路 pip 化
  （官方 MSI 非管理员必 1603）
- 随包布局收口：kubectl/gcloud 进 pack-manifest，EHole 补回 finger.json 指纹库，sqlmap 清单
  排除临时产物；工具路径全量对齐规范目录（无版本号目录）
- 转子女神唯一入口切换 rg_batch.py wrapper（自动清代理/喂 URL/超时树杀/产物校验，禁裸调 exe）；
  stdin-pipe 运行时类型连渲染分支一并清除
- bench 跑批健壮性：challenges API 非数组返回明报退出，单题复核防御
- 条令工程纪律加固（跑批 e1-02 实践反馈）：字典/词表一律随包 wordlists 禁全盘搜寻；
  明确 bash=本机 shell 非目标机，目标机命令执行只能走漏洞利用通道
- 深度核查收口：THIRD_PARTY_NOTICES 上游勘误（URLFinder→pingc0y、crt.sh→az7rb）并补云 CLI
  随包许可（kubectl/gcloud/wheel 集）；nuclei 卡模板数改防漂移口径；README 画板节点补 [N]发现；
  .gitattributes 行尾规范；bench-run 模型选择参数化
- 验收 28/28 · tsc strict 全量类型检查通过

## 0.3.1（2026-10-11）
- 工具箱完全体：30 张工具卡全部 tested:true（radare2/capa/yara-x/trivy/strings-bin/netexec/
  katana/waybackurls/impacket/云 CLI 实测转正，新增 gcloud-ro 凑齐 30）
- 工具卡路径统一为 zip 分发布局，workdir 同步规范化；本机原始路径走 ~/.pix/tools.json 覆盖层
  （27 条，含 python 系 workdir 覆盖）
- setup-tools.mjs 一键装覆盖全部 30 工具（24 随包 + pip/官方渠道在线装 + rotor-goddess 手动提示）；
  修复 ehole 探测文件名、fscan 优选 nolocal、capa --version 探测、yara-x yr.exe 探测
- 包内完全体：全量字典树 206MB（wordlists/）、radare2（glob 匹配修复进包）、binutils 三件套+依赖
  DLL、masscan 自编译版进包；pack-tools.mjs matchList 支持 ** glob
- pi-web 推理级别补丁默认化：install.mjs 默认执行，推理级别菜单出厂固定 auto/low/medium/high
- masscan Windows 无官方二进制 → mingw32-make 源码自编译 1.3.2（npcap-sdk + winpthread 补丁）
- 验收 28/28

## 0.3.0（2026-10-11）
- TSecBench 接入：/tsecbench 配置命令 + challenges/start/hint/submit/close 五工具
  （start 返回的 container_addr 即唯一授权范围；hint 扣分提醒写进工具说明）
- 评测跑批器：scripts/bench-run.mjs（每题独立 RPC 会话，单题 40 分钟帽，超时自动释放）
  + scripts/bench-score.mjs（分系列成绩单）；实靶 e1-01/02/03 满分 750/23000
- 工具包分发：scripts/pack-tools.mjs 一键打包（368MB zip 实测）+ setup-tools.mjs 扫描登记；
  工具卡路径规范化为 zip 分发布局，本机原始路径走 ~/.pix/tools.json 覆盖层
- 授权测试记录开篇：e1-01 / e1-02（SQL 注入 WAF 差分）完整攻击叙事
- 验收 28/28

## 0.2.0（2026-10-10）
- M2 工具箱：toolbox 网关（list/howto/search 三入口）+ 内嵌注册表（18 实测 CLI + 12 扩展位）+ ~/.pix/tools.json 用户扩展
- M3 画板：update_node 状态流转（hypothesis confirmed 联动节奏窗口）+ /pix export 双 Mermaid 图落盘
- M4 报告：/report 快照→渲染→落盘管线（执行摘要/逐漏洞/攻击链配图/状态机参与线/失败史）
- 工具纪律写入两模式条令；验收 25/25

## 0.1.0（2026-10-10）
- M1 底座重构：pent/redt 两模式条令、失败回读阈值 6、节奏基准 pent=2s/redt=1s、
  本机危险命令分级拦截、v1(pentest-state)自动迁移、/auth 授权登记、/task 任务书、
  appendEntry 画板状态 + boardSummary 注入；验收 18/18
