# 架构决策记录

这些 ADR 记录目标架构的设计选择。“已采纳”表示设计决策，不表示功能已完整实现。v3.0.0 增加 Swarm 离线契约原语，但仍没有真实 Pi 子会话执行器、取消回收或用户侧 Swarm 工具；Worker 调度、终结集成与自动熔断保持规划状态，各项实现状态以代码核对为准。

| ADR | v3.1.0 实现状态 |
|---|---|
| [0001 主从会话隔离派发](0001-planner-worker-session-spawning.md) | 目标设计；无真实 Worker 执行器 |
| [0002 SDK 内存级子会话](0002-in-process-subsession-runtime.md) | 目标设计；无真实子会话 |
| [0003 双档模型调度](0003-dual-tier-model-scheduling-and-escalation.md) | 未实现 |
| [0004 自适应并发池](0004-adaptive-throttled-worker-pool.md) | WorkerPool + 同进程 Host 字符串锁；无自动调度 |
| [0005 Worker 四态终结契约](0005-worker-state-driven-termination-contract.md) | 离线契约原语；未接入工具 |
| [0006 证据脱敏闸门](0006-deterministic-evidence-hygiene-gate.md) | 未实现统一闸门 |
| [0007 事实迁移](0007-in-context-fact-learning-over-pattern-engine.md) | 部分实现 |
| [0008 完全匹配去重](0008-exact-match-endpoint-deduplication.md) | 核心去重已实现，完整资产保全部分实现 |
| [0009 账号防锁定门禁](0009-account-lockout-policy-probing-and-safety-buffer.md) | 本地策略及计数已实现；无真实策略探测和发包拦截 |
| [0010 授权隧道与清账](0010-taskbook-authorized-ephemeral-tunneling-and-cleanup.md) | 未实现 |
| [0011 混合报告流水线](0011-hybrid-reporting-pipeline-and-ground-truth-isolation.md) | 部分实现 |
| [0012 只读遥测看板](0012-unidirectional-passive-telemetry-dashboard.md) | 只读 HTTP 通道已实现 |

参见[机制白皮书](../matrix-architecture.md)与[领域术语](../../CONTEXT.md)。
