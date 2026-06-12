---
name: economic_dispatch
description: 指导 Agent 使用经济调度 API Skill 完成负荷分配和低成本出力优化。
version: 1.0.0
---

# 使用场景

当用户希望进行经济调度、最小发电成本、机组出力分配、负荷在多台机组之间分配时，可使用本 Skill。

# 不应调用的场景

如果用户只是询问参数示例、需要哪些参数、参数怎么填、结果是什么意思或平台怎么使用，不要调用 API Skill，只返回说明或帮助内容。

# 调用前必须收集的参数

1. load_forecast：各时段负荷预测；
2. unit_max_output：各机组最大出力；
3. fuel_cost：各机组燃料成本。

# 可选参数

unit_min_output、ramp_up_limit、ramp_down_limit 可推荐默认值，但必须经用户确认后才能用于调用。

# 调用前确认

在调用 API Skill 前，必须向用户确认已识别参数、使用的默认值、绑定的 API Skill，以及结果仅作为辅助决策建议。

# 结果解释

调用成功后，应解释 objective_value、各机组各时段出力、主要负荷承担机组、边界约束或风险提示，以及是否建议进入方案对比。
