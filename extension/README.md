# PiX 扩展本体

Pi 扩展（部署到 `~/.pi/agent/extensions/pix/`，jiti 免编译加载）。

- `index.ts` — 入口：事件钩子（session_start / agent_end / before_agent_start / tool_execution_start / tool_call）+ 命令（/mode /auth /task /pix /toolbox /report）+ 工具注册
- `state.ts` — 画板状态模型 + appendEntry 持久化/读回（含 v1 pentest-state 迁移）
- `rules.ts` — pent/redt 两模式条令 + 条件注入段（授权/任务书/回读/反思）
- `pacing.ts` — 节奏自适应（失败率滑窗系数）
- `guard.ts` — 本机危险命令黑名单（环境防护）
- `gate.ts` — 读卡门禁（bash/ps 命中注册表工具但未 howto → 拦） + bash 默认超时注入
- `sensor.ts` — 止损观察器（连续拦截/报错 → 强制回读）+ 记账提醒
- `mirror.ts` — 落库调用 → 画板镜像（提案即镜像，不依赖 MCP 连通）
- `toolbox-data.ts` — 工具注册表内嵌数据（31 实测 + 7 扩展位：隧道/代理 5、提权枚举 3，转子女神已剔除）
- `toolbox.ts` — toolbox 网关（list / howto / search 三入口 + 可用性探测；howto 记账供读卡门禁 gate.ts 判定）
- `report.ts` — /report 报告管线（快照→渲染→落盘）

安装/更新：仓库根目录 `node scripts/install.mjs`。项目总览见[仓库 README](../README.md)。
