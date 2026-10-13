---
name: pix-workflow
description: |
  PiX 渗透作业流程指引（内置兜底技能）：三段状态机（能力/失败/假设）、
  画板、失败强制回读、位置变换、两模式（pent/redt）的协同用法。
  TRIGGER when：开始一次渗透测试任务、用户说"开始测/挖洞/打靶机"、
  不清楚 PiX 的状态工具怎么用时。
  DO NOT trigger：非渗透任务、纯概念问答。
---

# PiX 渗透作业流程

> 本技能是无外部技能包时的兜底流程；若已安装渗透/红队技能包，其规则优先。

## 开工三步
1. `/auth <目标> --source <授权来源>` 登记授权范围（pent 模式注入围栏）
2. 红队任务换 `/mode redt` + `/task <任务书路径>`；SRC/授权渗透用默认 pent
3. 侦察起步：`toolbox({action:'search', task:'子域收集'})` 找工具 → howto 读卡 → 照卡执行

## 过程纪律（每一步）
- 确认能力/发现/失败/假设 → 立即 `record_fact` 入画板并连边（relatedTo + relation）
- 同方向失败 → `record_failure` 计数（≥6 次扩展自动注入强制回读指令）
- 假设证实/证伪 → `update_node(id, status)` 流转（confirmed 联动节奏提速）
- 发现坐实 → `update_node(finding, confirmed)` 进入报告数据源

## 僵局处理
1. 扩展注入的【强制回读】：get_state 读画板 → 沿 similar_to/substitutes 边找可迁移能力 → 位置变换
2. 【元认知反思】触发时：换偏门视角/查历史 CVE/组件差异
3. 仍无进展：export_map 可视化全局，向用户汇报卡点

## 收尾
- `/pix export` 导出画板（思维导图+关系图）
- `/report` 生成渗透报告（含攻击链配图与状态机参与线）
