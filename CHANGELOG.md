# Changelog

## 0.8.0（2026-10-13）— 跑批调度重建 + 知识连续性 + 能力补强（改良 v1.1）

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
