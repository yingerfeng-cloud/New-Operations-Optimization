---
name: chp_dispatch
description: 指导 Agent 使用电热协同 API Skill 生成热电联产调度建议。
version: 1.0.0
---

# 使用场景

用户需要热电联产、电热协同、电负荷和热负荷联合出力安排时，使用本 Skill。

# 不应调用的场景

用户只是询问参数示例、需要哪些参数、参数如何填写或结果含义时，不调用 API Skill。

# 必填参数

electric_load、heat_load、fuel_cost、electric_max、heat_max 必须由用户提供。

# 可选参数

electric_min、heat_min 可建议默认值，但必须确认。

# 默认值确认

负荷、燃料成本和最大边界不能用 sample_value 替代；最小边界等技术参数可确认默认值。

# 结果解释

解释电出力、热出力、成本目标、热电可行域边界和人工复核提示。
