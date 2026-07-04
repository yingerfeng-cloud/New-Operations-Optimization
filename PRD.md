# 电力业务语义驱动运筹优化平台 PRD

## 1. 产品定位

本平台面向电力生产、调度、交易、燃料、检修等运筹优化场景，提供从业务语义、模型资产、组件化建模、参数校验、Pyomo 求解、结果解释到 Agent/Skill 调用的闭环能力。

当前版本不是通用数学公式编辑器，也不是多商业求解器平台。当前技术路线固定为：

- FastAPI
- Pyomo
- HiGHS
- 单文件前端原型
- 本地文件运行时存储

## 2. 当前迭代目标

本迭代重点是让组件化自定义 Builder 从“后端能力可用”推进到“页面可见、资产可调用、真实链路可跑通”。

验收目标：

1. `component_based` 模型运行时参数不再被通用 dict 校验误判。
2. `/api/optimize/run` 可直接运行 `cascade_hydro_dispatch`。
3. `/api/skills/run_cascade_hydro_dispatch/run` 可同步返回求解结果和中文解释。
4. `/api/models/{model_id}/invoke` 可调用组件化水电模型。
5. React 前端在模型创建页提供组件化 Builder 模式和水电样例加载。
6. 模型资产中心提供“调用模型”入口，并能把模型运行时参数带入任务页。
7. 水电组件校验抛出中文错误。
8. 弃水统计使用体积单位，输出 `total_spill_million_m3` 和 `spill_volume_million_m3`。

## 3. 用户角色

| 角色 | 核心诉求 |
|---|---|
| 调度业务人员 | 选择模型、加载样例、发起求解、查看中文调度解释 |
| 建模工程师 | 沉淀模板、组件、运行参数、校验规则和结果口径 |
| 平台管理员 | 管理模型版本、发布状态、调用记录和任务结果 |
| Agent/集成系统 | 通过 Skill API 或 model invoke 调用优化能力 |
| 演示人员 | 在本地快速启动平台，跑通可见的端到端闭环 |

## 4. 核心闭环

```text
业务场景/模型资产
-> semantic_spec / component_spec
-> RuntimeParameterValidator
-> PyomoModelBuilder
-> ComponentModelBuilder 或 GenericLinearBuilder
-> HiGHSAdapter
-> SolveResultFormatter
-> ResultInterpreter
-> 任务页 / Asset Center / Skill API / Model Invoke
```

## 5. 已实现范围

### 5.1 模型模板

- `unit_commitment_day_ahead`：日前机组组合优化
- `economic_dispatch`：经济负荷分配
- `storage_dispatch`：储能充放电优化
- `renewable_storage_dispatch`：风光储协同优化
- `chp_dispatch`：电热协同优化
- `cascade_hydro_dispatch`：梯级水电日前调度优化

### 5.2 组件化 Builder

组件化 Builder 使用 `build_mode=component_based`，由 `component_spec` 声明集合、变量、组件、目标函数和求解能力。后端通过组件注册表逐个执行 `validate/build`，生成 Pyomo 模型。

第一批组件聚焦梯级水电短期调度：

- 初始库容
- 库容上下限
- 检修可用容量
- 出力-发电流量转换
- 下泄流量平衡
- 下泄流量上下限
- 弃水上限
- 梯级传播时滞入库
- 水库水量平衡
- 负荷跟踪
- 期末库容控制
- 出力平滑

### 5.3 梯级水电模型

`cascade_hydro_dispatch` 覆盖三座梯级电站的日前调度样例，支持：

- 电站、机组、时段、库容时点集合
- 机组检修状态影响可用容量
- 上下游时滞传播
- 区间来水与上游下泄共同形成入库
- 库容递推
- 负荷跟踪
- 弃水惩罚
- 出力平滑
- 期末库容控制

关键运行时参数：

```text
station
horizon
time
time_volume
units
unit_pmax
availability
power_conversion
local_inflow
load_forecast
volume_min
volume_max
initial_volume
target_terminal_volume
outflow_min
outflow_max
spill_max
edges
initial_upstream_outflow
time_step_seconds
weights
```

### 5.4 前端能力

React 前端已支持：

- 模型创建页加载组件化水电样例
- 第 3 步显示“组件化 Builder”
- 展示组件清单、组件说明、样例运行参数和高级 JSON
- 校验组件模型
- 生成组件化模型包
- 模型资产中心展示建模模式、问题类型、组件数量
- 模型资产中心新增“调用模型”
- 调用模型后跳转任务页并填入运行时参数
- `applyRuntimeConfigFromModel` 识别 `math_param`、`code`、`key`、`name`

## 6. API 需求

### 6.1 健康检查

```text
GET /health
GET /api/health
```

平台健康检查必须返回：

- `solver=HiGHS`
- `pyomo_installed=true`
- `highspy_installed=true`
- `component_based_builder`
- `component_registry`
- `cascade_hydro_dispatch`

### 6.2 模板库

```text
GET  /api/templates
GET  /api/templates/{template_code}
GET  /api/templates/{template_code}/parameter-schema
GET  /api/templates/{template_code}/sample-runtime-parameters
POST /api/templates/{template_code}/clone
POST /api/templates/{template_code}/publish
POST /api/templates/{template_code}/unpublish
```

### 6.3 模型资产

```text
GET  /api/models
POST /api/models
GET  /api/models/{model_id}
PUT  /api/models/{model_id}
GET  /api/models/{model_id}/schema
POST /api/models/{model_id}/publish
POST /api/models/{model_id}/offline
POST /api/models/{model_id}/copy
POST /api/models/{model_id}/invoke
```

模型发布规则：

- `generic_linear` 模型必须具备 `semantic_spec` 与 `generic_spec`。
- `component_based` 模型必须具备 `semantic_spec` 与 `component_spec`。
- 发布前必须通过运行时参数校验和模型构建 dry-run。
- 无效模型返回结构化错误，不允许静默发布。

### 6.4 优化任务

```text
POST /api/optimize/run
GET  /api/optimize/jobs
GET  /api/optimize/jobs/{job_id}
GET  /api/optimize/result/{job_id}
POST /api/tasks/{task_id}/retry
POST /api/tasks/{task_id}/cancel
```

`/api/optimize/run` 必须同时支持：

- `model_code`
- `model_id`
- `parameters`
- `runtime_parameters`
- `payload`

对 `component_based` 模型，`runtime_parameters` 应直接进入组件化校验，不走通用维度 dict 误判逻辑。

### 6.5 Skill API

```text
GET  /api/skills
POST /api/skills/{skill_name}/analyze-input
POST /api/skills/{skill_name}/run
```

梯级水电 Skill：

```text
POST /api/skills/run_cascade_hydro_dispatch/run
```

同步调用要求：

- 返回 `status=SUCCESS`
- 返回 `business_result`
- 返回 `metrics.total_spill_million_m3`
- 返回中文解释

## 7. 校验规则

### 7.1 component_based 通用规则

- `component_spec.components` 不能为空。
- `component_spec.variables` 不能为空。
- `sets` 可以由样例运行参数或运行时参数实例化。
- 参数校验错误返回结构化列表。

### 7.2 梯级水电专项规则

错误前缀：

```text
梯级水电模型参数错误：
```

关键规则：

- `station` 不能为空。
- `horizon` 必须为正整数。
- `time` 长度必须等于 `horizon`。
- `time_volume` 长度必须等于 `horizon + 1`。
- 每座电站至少配置一个机组。
- `availability[unit]` 长度必须等于 `horizon`。
- 每座电站必须配置来水、库容边界、初始库容、期末目标库容、出力转换系数、下泄边界和弃水边界。
- `power_conversion` 必须大于 0。
- `volume_min <= initial_volume <= volume_max`。
- `volume_min <= target_terminal_volume <= volume_max`。
- `outflow_min <= outflow_max`。
- `spill_max >= 0`。
- `edges` 中上下游电站必须存在于 `station`。
- 每条时滞边必须具备 `initial_upstream_outflow["up->down"]`。

## 8. 结果口径

梯级水电结果应包含：

- 分电站分时段出力
- 发电流量
- 弃水流量
- 下泄流量
- 库容起止值
- 入库估算
- 负荷偏差
- 期末库容偏差
- 出力平滑偏差

弃水统计口径：

```text
弃水体积 = q_spill(m3/s) * time_step_seconds / 1_000_000
单位 = 百万立方米
```

全局指标：

```text
metrics.total_spill_million_m3
```

分电站指标：

```text
station_summary[].spill_volume_million_m3
```

旧口径 `total_spill_m3s_sum` 不再作为主指标使用。

## 9. 前端验收标准

模型创建页：

1. 存在“加载组件化水电样例”按钮。
2. 点击后当前场景切换为梯级水电日前调度。
3. 第 3 步标题显示“组件化 Builder”。
4. 组件清单显示 12 个水电组件。
5. 样例运行参数中包含 `time_volume`。
6. “校验组件模型”对有效样例通过。

资产中心：

1. 水电模型显示为“组件化自定义 Builder”。
2. 组件清单列显示“12 个组件”。
3. 每个可调用模型都有“调用模型”按钮。
4. 点击水电模型“调用模型”后跳转任务调度中心。
5. 任务页自动填入 `time_volume` 等英文运行参数 key。
6. 点击“实例化并提交任务”后任务成功。

## 10. 启动与部署要求

默认本地端口：

| 服务 | 端口 | 地址 |
|---|---:|---|
| 平台 API | 8090 | `http://127.0.0.1:8090/api` |
| Agent API | 8091 | `http://127.0.0.1:8091/api` |
| 静态前端 | 8092 | `http://127.0.0.1:8092` |

启动脚本要求：

- 默认启动平台 API 和静态前端。
- `-Mode both` 同时启动平台和 Agent。
- `-Restart` 停止目标端口上的旧进程后重启。
- 启动后检查 `/api/health`。
- 平台能力缺少组件化 Builder 或梯级水电模板时，提示使用 `-Restart` 清理旧进程。
- 默认通过 React/Vite 或 FastAPI 托管入口打开页面，不再依赖 `file://`。

停止脚本要求：

- 默认停止平台 API 和静态前端。
- `-Both` 停止平台 API、Agent API 和静态前端。
- `-All` 停止全部默认端口。
- 支持 `-AgentOnly` 和 `-UiOnly`。

## 11. 自动化测试

专项测试：

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_component_based_hydro_model.py -q
```

全量回归：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

当前验收基线：

```text
114 passed
```

专项测试必须覆盖：

- `RuntimeParameterValidator` 接受 `time_volume` list。
- `/api/optimize/run` 梯级水电完整链路。
- `/api/skills/run_cascade_hydro_dispatch/run` 完整链路。
- `/api/models/{id}/invoke` 完整链路。
- 水电中文校验错误。
- 弃水体积单位。

## 12. 暂不实现范围

- 真实 EMS/SCADA/BMS/交易系统接入
- 数据库存储
- 用户权限、审批流和审计日志
- WebSocket 实时推送
- 生产级并发队列
- COPT/Gurobi 适配
- Excel/PDF 原生报告
- 工程化前端拆分

## 13. 后续规划

1. 将组件化 Builder 扩展到储能、火电、风光储、检修排程等场景。
2. 将 `component_spec` 可视化编辑从 JSON 扩展为组件拖拽/参数表单。
3. 增加组件级单元测试和组件依赖拓扑校验。
4. 引入持久化模型库和任务库。
5. 引入更完整的业务权限、审批和版本治理。
6. 增加真实外部数据接口适配层。
