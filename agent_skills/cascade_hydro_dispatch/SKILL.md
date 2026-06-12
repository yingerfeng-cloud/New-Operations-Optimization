---
name: cascade_hydro_dispatch
description: 指导 Agent 使用梯级水电日前调度 API Skill 生成调度辅助建议。
version: 1.0.0
---

# 使用场景

用户需要梯级水电日前调度、来水过程分析、检修影响校核、负荷跟踪、弃水分析或期末库容控制时，使用本 Skill。

# 不应调用的场景

用户只是询问参数示例、组件含义、需要哪些参数、结果字段解释或平台使用方法时，不调用 API Skill。

# 必填参数

station、units、unit_pmax、availability、power_conversion、local_inflow、load_forecast、volume_min、volume_max、initial_volume、target_terminal_volume、outflow_min、outflow_max、spill_max、edges、initial_upstream_outflow。

# 可选参数

horizon、time、time_volume、time_step_seconds、weights 可由系统建议默认值，但必须经用户确认。

# 默认值确认

来水、负荷、库容边界、检修可用状态和梯级拓扑必须由用户提供或来自已确认的数据源，不得用 sample_value 静默替代。

# 结果解释

解释各电站分时段出力、发电流量、弃水流量、下泄流量、库容过程、负荷偏差、约束触发和人工复核建议。
