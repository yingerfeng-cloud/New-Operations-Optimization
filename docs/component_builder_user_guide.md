# 组件化自定义 Builder 使用说明

## 1. 启动服务

推荐使用一键脚本启动完整本地环境：

```powershell
.\Run.ps1 -Full -Restart
```

如果只需要平台 API 和静态前端：

```powershell
.\Run.ps1 -Restart
```

默认地址：

```text
平台 API：http://127.0.0.1:8090/api
Agent API：http://127.0.0.1:8091/api
前端页面：http://127.0.0.1:8092/prototype.html?apiBase=http%3A%2F%2F127.0.0.1%3A8090%2Fapi
```

也可以手工启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.platform_main:app --host 127.0.0.1 --port 8090
```

然后打开：

```text
http://127.0.0.1:8092/prototype.html?apiBase=http%3A%2F%2F127.0.0.1%3A8090%2Fapi
```

如果直接双击打开 `prototype.html`，需要确认页面右下角 API Base 指向正在运行的后端。

停止默认端口服务：

```powershell
.\Shutdown.ps1 -All
```

## 2. 加载梯级水电组件化样例

1. 打开 `prototype.html`。
2. 进入“模型创建”。
3. 点击“加载组件化水电样例”。
4. 页面会切换到“组件化自定义 Builder”模式。
5. 第 3 步会展示组件清单、组件说明、`component_spec` 预览和运行参数 JSON。

## 3. 查看组件说明

组件表格展示：

- 启用状态
- 顺序
- 中文名称
- 英文编码
- 分类
- 依赖组件
- 操作按钮

点击“说明”后，右侧会展示：

- 业务说明
- 数学公式
- 输入参数
- 输出变量 / 约束
- 示例说明
- 常见错误

英文编码保留给开发和排障，例如：

```text
水库水量平衡组件（hydro_reservoir_balance）
梯级传播时滞入库组件（hydro_cascade_inflow_delay）
```

## 4. 启用、禁用和调整组件顺序

在组件表格中：

- 使用复选框启用或禁用组件。
- 使用“上移”“下移”调整组件顺序。
- 点击“生成 Component Spec”后，页面会根据当前启用组件重建 `component_spec.components`。
- 点击“校验组件依赖”可检查启用组件是否缺少依赖。

第一版暂不支持拖拽式编排和拓扑图编辑，但保留了组件顺序、依赖和参数映射的扩展点。

## 5. 编辑运行参数

在“运行参数 JSON”区域编辑参数。

保存模型资产时，平台会优先使用当前页面中的运行参数 JSON，而不是固定样例参数。

梯级水电样例常用参数包括：

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

如果未显式传入 `time` 和 `time_volume`，后端会根据 `horizon` 自动生成：

```text
time = 0...(horizon-1)
time_volume = 0...horizon
```

## 6. 保存和发布模型

1. 在模型创建页完成组件配置和运行参数编辑。
2. 点击“校验组件模型”。
3. 点击“覆盖保存”或“另存为新模型”。
4. 到“模型资产中心”查看模型版本。
5. 发布或试运行模型后，模型可以被任务中心、API 和 Skill 调用。

复制模型时，平台会生成唯一 `model_code`，例如：

```text
cascade_hydro_dispatch_custom_a1b2
```

这样不会抢占内置 Skill：

```text
run_cascade_hydro_dispatch
```

内置 Skill 始终优先指向默认模板模型：

```text
MODEL-POWER-CASCADE-HYDRO-DISPATCH
```

## 7. 调用模型

在“模型资产中心”中点击“调用模型”，页面会跳转到“任务调度中心”，并自动填入模型运行参数。

确认参数后点击“实例化并提交任务”。

成功结果应包含：

- `dispatch_detail`
- `system_curve`
- `station_summary`
- `metrics`
- 中文解释

弃水指标使用体积口径：

```text
total_spill_volume_m3
total_spill_volume_million_m3
station_summary[].spill_volume_m3
station_summary[].spill_volume_million_m3
```

## 8. API 调用示例

```powershell
$params = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/templates/cascade_hydro_dispatch/sample-runtime-parameters"

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8090/api/skills/run_cascade_hydro_dispatch/run" `
  -ContentType "application/json" `
  -Body (@{
    parameters = $params
    options = @{
      mode = "sync"
      explain = $true
      time_limit_seconds = 30
    }
  } | ConvertTo-Json -Depth 20)
```

返回中会包含：

```json
{
  "resolved_model_id": "MODEL-POWER-CASCADE-HYDRO-DISPATCH",
  "resolved_model_code": "cascade_hydro_dispatch"
}
```

## 9. 常见错误

### time_volume 长度错误

现象：

```text
梯级水电模型参数错误：time_volume 长度为 4，但 horizon + 1 为 5。
```

处理：

- 删除 `time_volume` 让后端自动生成；或
- 保证 `time_volume.length = horizon + 1`。

### availability 长度错误

现象：

```text
梯级水电模型参数错误：机组 S1_U2 的 availability 长度为 3，但 horizon 为 4。
```

处理：

- 每台机组的 `availability` 必须覆盖全部调度时段。

### 组件依赖缺失

现象：

```text
水库水量平衡组件 依赖 梯级传播时滞入库组件
```

处理：

- 启用依赖组件；或
- 调整组件顺序，保证派生表达式先于依赖它的组件构建。

### 长时间停留 SOLVING

处理：

1. 查看任务日志。
2. 检查 `time_limit_seconds`。
3. 检查模型规模和约束边界。
4. 放宽明显冲突的水量、下泄或库容约束后重试。
