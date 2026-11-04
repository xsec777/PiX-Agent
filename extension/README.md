# PiX 扩展本体

PiX 核心扩展层（部署到 `~/.pi/agent/extensions/pix/`，运行时无缝加载）。

- `index.ts` — 入口：生命周期事件钩子 + 交互命令（/mode /auth /task /pix /toolbox /facts）+ 工具注册
- `state.ts` — 4D 超图状态机（节点/边/主机/跳板/凭据/接口台账）+ 原子双写持久化
- `rules.ts` — pent/redt 两模式作战条令 + 4D 超图驱动的阶段自适应注入段 + 未测接口清单
- `pacing.ts` — 动态自适应节奏计算（失败率滑动窗口调速 0.5~2×）
- `guard.ts` — 本机破坏性命令物理拦截（删盘/格式化/关机环境防护）
- `gate.ts` — 读卡门禁 + 600s 确定性超时注入看门狗
- `sensor.ts` — 客观智能传感器（多维阻断模式识别 + 止损/记账提醒 + 战术反向推荐）
- `mirror.ts` — pentrack 落库调用与超图双向镜像同步
- `toolbox.ts` & `toolbox-data.ts` — 38 款实战武器注册表网关（list / howto / search）+ Python 动态探测
- `pivot-router.ts` — 跳板感知透明路由运行时（原生参数优先注入 + 环境变量透传）
- `tactical-loader.ts` — JIT 即时战术装载器（结构感知二级标题智能分块切片）
- `exporter.ts` — Ground Truth 结构化事实快照与数据底表导出器（解耦数据与排版）

安装/更新：仓库根目录执行 `node scripts/install.mjs`。项目总览见[仓库 README](../README.md)。
