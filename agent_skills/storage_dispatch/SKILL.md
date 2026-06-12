---
name: storage_dispatch
description: 指导 Agent 使用储能调度 API Skill 生成充放电和 SOC 计划建议。
version: 1.0.0
---

# 使用场景

用户需要储能充放电优化、峰谷套利、SOC 轨迹安排或储能功率边界校核时，使用本 Skill。

# 不应调用的场景

用户只是询问参数示例、需要哪些参数、参数如何填写、结果含义或平台说明时，不调用 API Skill。

# 必填参数

1. electricity_price：各时段电价。
2. storage_capacity：储能容量。
3. charge_power_max：最大充电功率。
4. discharge_power_max：最大放电功率。

# 可选参数

charge_efficiency、discharge_efficiency、initial_soc、soc_min 可建议默认值，但必须由用户确认。

# 默认值确认

核心业务输入必须由用户提供，不能用 sample_value 替代。技术参数默认值确认后才可进入 READY_TO_INVOKE。

# 结果解释

解释充放电时段、SOC 轨迹、收益或成本目标、功率边界和人工复核提示。
