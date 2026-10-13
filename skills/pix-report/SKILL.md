---
name: pix-report
description: |
  PiX 报告口径：/report 生成前后如何保证据质量。
  TRIGGER when：用户要求写报告/交付/总结漏洞时。
---

# PiX 报告口径

- 数据源只有画板：报告前确认每个 finding 都有 detail（复现/证据）与 tags
- finding 用 update_node 置 confirmed 才算坐实；open 状态在报告中标注"待复测"
- 证据引用：detail 里写请求/响应关键片段或文件路径，禁"理论可拖"表述
- 敏感数据脱敏后再交付（报告中密码/内网段按需打码）
- /report 输出后人工过一遍执行摘要再交付
