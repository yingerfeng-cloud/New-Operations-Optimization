---
name: unit_commitment_day_ahead
description: 指导 Agent 使用日前机组组合 API Skill 生成机组启停、备用和出力计划建议。
version: 1.0.0
---

# 使用场景

用户需要日前机组组合、机组启停、备用容量校核、日前出力计划或新能源预测参与的机组运行安排时，使用本 Skill。

# 不应调用的场景

用户只是询问参数示例、需要哪些参数、参数如何填写、结果字段含义或平台使用方法时，不调用 API Skill。

# 必填参数

1. load_forecast：日前各时段系统负荷预测。
2. renewable_forecast：日前各时段新能源出力预测。

# 可选参数

initial_unit_status、initial_unit_output 可由系统建议默认值，但必须由用户确认后才能进入调用确认。

# 默认值确认

默认值确认时必须展示默认值来源、作用范围和人工复核提示。未确认默认值不得调用 API Skill。

# 结果解释

解释机组启停、备用约束、出力计划、目标值、边界约束风险，并提示结果仅作为辅助决策建议。
