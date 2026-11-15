# PiX-Agent Domain Context

本文件是 PiX 自动化渗透测试系统的**目标架构词表**。v3.0.0 增加了 TaskEnvelope、WorkerPool、WatchdogCeiling、TerminationContract 与 WorkerResult 的离线契约原语，但仍未提供真实 Pi 子会话执行器、取消回收或用户侧 Swarm 工具注册；Planner/Worker 调度等词条仍是目标设计，**不构成 v3.0.0 已交付自主集群承诺**。各项实现状态以对应 ADR 和实际代码为准；下文的强制性措辞描述设计约束，不能视为当前代码已执行的全部门禁。

文档中的域名、IP、账号、凭据占位符、报文与攻防场景均为虚构示例，不代表真实秘密或已完成的实测。

## 统一术语 (Language)

**Planner (主控大脑)**:
负责全域 4D 超图感知、端点台账维护、优先级派发与结案门禁裁决的全局规划会话。严禁直接执行单点发包渗透命令。
_Avoid_: Commander, Master, MainAgent, 调度器 (过于模糊)

**Worker (执行子会话)**:
由 Planner 针对单个端点或特定技术栈动态派生的隔离执行会话。仅在有限生命周期内执行工具探测，产出标准化结论后即销毁。
_Avoid_: Subagent, 士兵, 执行器

**TaskEnvelope (任务信封)**:
Planner 向 Worker 派发的不可变结构化任务凭据，包含目标 URL、已知参数、探测深度配额与阻断边界。
_Avoid_: 任务书 (与 /task 红队任务书混淆), Payload包

**WorkerResult (执行回报)**:
Worker 子会话执行完毕后向 Planner 交付的内存强类型结果对象，必须包含：目标端点 ID、状态机终态、测试动作、原始 HTTP 请求包 (evidenceRequest)、关键响应差分切片 (evidenceResponse) 及提取的新资产。
_Avoid_: 回显, 汇报文本, 执行报告

**worker_submit (强制终结工具)**:
Worker 子会话结束任务时必须调用的终结工具。严禁通过打字聊天结束任务，调用时必须且只能归入四态终结契约之一。
_Avoid_: finish_task, done, 结束命令

**TerminationContract (四态终结契约)**:
Worker 调用 `worker_submit` 时必须严格遵循的四种确定性结局：confirmed (快速退出)、escalating (纵深突破)、bypassing (强阻抗请求升档)、rejected (L4充分证伪)。
_Avoid_: 自主判断, 随意收工

**WatchdogCeiling (物理看门狗硬顶)**:
单 Worker 子会话的物理安全上限（默认 maxTurns ≤ 6 轮，墙钟时间 ≤ 180s），达到硬顶底层强制熔断回收，杜绝意外死循环。
_Avoid_: 超时配置, 轮次上限

**WorkerPool (子会话调度池)**:
内存中维护的 Worker 并发槽位与看门狗生命周期调度器，限制最大并发数与单次会话轮次上限。
_Avoid_: 线程池, 进程池

**ConcurrencyWindow (并发窗口)**:
系统当前动态允许的最大活跃 Worker 槽位数（默认 1~3），受自适应降速算法动态调节。
_Avoid_: 线程数, 最大并发限制

**HostMutex (站点互斥锁)**:
针对同一目标站点域名或 IP 施加的独占锁，确保同一时刻同一站点仅有单 Worker 发包，杜绝目标单点过载与 WAF 频控封禁。
_Avoid_: 锁, 域名锁

**AdaptiveThrottle (自适应降级)**:
当任意 Worker 捕获到 429 限流、WAF 403 阻断或人机验证时，全局并发窗口瞬间收缩至 1 并强制注入冷却等待的自适应流控机制。
_Avoid_: 限速, sleep, 熔断

**SmartTier (旗舰脑档位)**:
模型池中具备高阶逻辑推理与深度变异攻坚能力的旗舰模型配置（如 Claude 3.5 Sonnet / DeepSeek-R1），默认分配给 Planner 及遭遇阻碍的攻坚 Worker。
_Avoid_: 强脑, 主模型

**FastTier (高速脑档位)**:
模型池中具备高速、低时延与廉价 Token 特性的轻量模型配置（如 DeepSeek-V3 / Flash / mini），默认分配给执行基线探针的初级 Worker。
_Avoid_: 弱脑, 从模型

**EscalationPromotion (受挫动态升档)**:
当 FastTier 驱动的 Worker 遭遇 WAF 阻断或连续变异失败达到阈值时，自动将端点任务信封升级指派给 SmartTier 旗舰模型接管攻坚的调度机制。
_Avoid_: 换人, 派将军

**EvidenceHygieneGate (证据脱敏物理闸门)**:
在 evidenceRequest 与 evidenceResponse 入账超图和事实底表前，强制执行的物理流清洗器，自动将 Cookie、Token、API Key 替换为遮蔽标识，并对用户敏感隐私实施实心打码。
_Avoid_: 提示词脱敏, 手动打码

**MinimumProofPrinciple (数据面实证最小化原则)**:
证明数据泄露或越权风险时，仅允许保留总量统计 (COUNT(*)) 与前 3 行脱敏真实样本 (LIMIT 3)，超过部分在物理流层机械截断的刚性红线。
_Avoid_: 全量脱库, 尽量少拖

**RedactedHeader (脱敏凭据头)**:
保留原始请求头键名与参数结构、但将敏感凭据值替换为 `[REDACTED_TOKEN]` 的标准化报文头部。
_Avoid_: 删除Header, 空Header

**EndpointLedger (端点台账)**:
全量 Web/API 接口资产的确定性七态状态机数据库，严格要求 100% 闭环流转，禁止跳步或抽样测试。
_Avoid_: 接口列表, 资产清单

**ExactMatchDeduplication (完全匹配去重)**:
仅当 HTTP 方法与完整 URL 字符串完全逐字一致时才执行幂等去重的机制。代码层严禁执行破坏性的正则路径泛化，杜绝误吞隐藏业务接口。
_Avoid_: 模糊去重, 智能合并

**RawAssetPreservation (现场资产保全原则)**:
扫描器与爬虫输出的原生字符与路径结构在入账阶段完整保全、不做不可逆裁剪的刚性原则。
_Avoid_: 预先剪枝, 路径清洗

**PolicyProbing (前置密码策略探针)**:
在发起任何批量域凭据喷洒前强制执行的安全探测动作，通过匿名/已有协议查询域控真实的 Account Lockout Threshold 基线。
_Avoid_: 直接开喷, 盲猜策略

**LockoutSafetyBuffer (防锁号安全缓冲门禁)**:
针对单域账号最大允许试错次数硬性锁定为 max(1, LockoutThreshold - 2) 的物理限制机制。无法探测到策略时自动降级为单次尝试 (1次)。
_Avoid_: 暴力破解限制, 最大密码重试

**AuthorizedTunneling (显式授权隧道门禁)**:
仅当在任务书中显式包含允许建立隧道明文标识时，底层才准许放行 chisel、frp 等穿透工具的刚性门禁。
_Avoid_: 自由建隧道, 后门

**CleanupRegistry (注销清账清单)**:
全局超图中强制维护的临时文件路径、进程 PID 与绑定端口注册表，用于在会话收官时执行逆向彻底清理。
_Avoid_: 临时清单, 退出清单

**CleanupWatchdog (清账看门狗)**:
会话终结或主动退出时强制执行的看门狗，核验并杀死所有登记进程、删除临时配置，确保目标环境零遗留。
_Avoid_: 进程清理器

**LiveMatrix (实时看板)**:
基于 500ms 防抖总线向用户与系统外部投射的高可观测性动态攻防状态大屏。
_Avoid_: Dashboard, 监控页

**PassiveTelemetryDashboard (单向只读遥测看板)**:
30142 端口对外暴露的纯只读 SSE 实时推流监控大屏，严禁提供任何修改底层超图状态机的 HTTP API，杜绝外部网络侧的非受控状态注入。
_Avoid_: 控制台, 交互看板

**TerminalCommandAuthority (终端唯一控制权原则)**:
所有安全熔断、目标授权 (/auth)、模式切换 (/mode) 与任务干预一律收敛于主控终端 CLI 会话的刚性架构原则。
_Avoid_: 网页控制, 分散授权

**HybridReportingPipeline (双模混合报告流水线)**:
将报告严格划分为数据面 (80% 物理代码只读组装) 与管理面 (20% 受控 LLM 撰写摘要与加固建议) 的流水线机制，在根绝漏洞捏造的同时保持专业咨询表达。
_Avoid_: 模型自由写报告, 静态硬编码报告

**DataPlaneIsolation (数据面物理隔离)**:
漏洞清单、复现证据、原始报文与超图数据完全由本地模板引擎只读拼装、大模型无权篡改字符的隔离机制。
_Avoid_: 提示词防伪

**ExecutiveSummary (管理层执行摘要)**:
收官阶段由受控 LLM 基于已锁定的客观统计指标单次生成的面向 C-Level 高管的宏观安全态势研判与战略整改章节。
_Avoid_: 总结, 结论

## 关系与拓扑 (Relationships)

- 一个 **Planner** 在生命周期内管理唯一的 **EndpointLedger**
- 一个 **Planner** 依据 **EndpointLedger** 的未测队列，通过 **WorkerPool** 按需动态派生若干串行或并行的 **Worker**
- 每个 **Worker** 消费一份不可变的 **TaskEnvelope**，并在终结时向 **EndpointLedger** 交付确定的 **WorkerResult** 回写状态机
- 收官时通过 **HybridReportingPipeline** 消费 **EndpointLedger**，以 **DataPlaneIsolation** 保证原始证据不可篡改并输出最终交付物
