---
name: renewable_storage_dispatch
description: 指导 Agent 使用风光储协同 API Skill 生成新能源消纳和储能配合建议。
version: 1.0.0
---

# 使用场景

用户需要风光储协同、新能源消纳、弃风弃光控制、储能配合或并网约束分析时，使用本 Skill。

# 不应调用的场景

用户只是询问参数示例、需要哪些参数、参数如何填写或结果含义时，不调用 API Skill。

# 必填参数

renewable_forecast、load_forecast、electricity_price、storage_capacity、grid_export_limit 必须由用户提供。

# 可选参数

charge_power_max、discharge_power_max、initial_soc 可建议默认值，但必须确认。

# 默认值确认

不得用示例新能源预测、负荷、电价或并网容量替代用户输入。默认建议仅限技术参数。

# 结果解释

解释新能源利用量、弃电、储能充放电、并网边界和风险提示。
