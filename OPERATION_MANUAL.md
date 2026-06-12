# 电力优化平台操作手册

## 1. 环境说明

项目目录：

```text
C:\Users\45527\Documents\Codex\2026-04-29\copt-500
```

技术栈：

- FastAPI
- Pyomo
- HiGHS
- 前端原型 `prototype.html`

默认服务地址：

```text
平台 API：http://127.0.0.1:8090/api
Agent API：http://127.0.0.1:8091/api
静态前端：http://127.0.0.1:8092
```

## 2. 启动与停止

### 2.1 一键启动完整环境

推荐命令行执行：

```powershell
.\Run.ps1 -Full -Restart
```

启动：

- 平台 API：`http://127.0.0.1:8090/api`
- Agent API：`http://127.0.0.1:8091/api`
- 静态前端：`http://127.0.0.1:8092`

启动成功后会自动打开：

- `prototype.html?apiBase=http://127.0.0.1:8090/api`
- `agent_console.html?apiBase=http://127.0.0.1:8091/api`

首次运行时，脚本会自动创建 `.venv`；依赖缺失时会执行 `pip install -r requirements.txt`。

### 2.2 按需启动

```powershell
# 只启动平台 API 和静态前端
.\Run.ps1 -NoOpenUi

# 更新代码后强制重启，避免复用旧进程
.\Run.ps1 -Restart -NoOpenUi

# 平台 + Agent + 静态前端
.\Run.ps1 -Full -Restart

# 只启动 Agent API
.\Run.ps1 -Mode agent -AgentPort 8091 -NoStaticUi -NoOpenUi

# 只启动后端，不启动静态前端服务
.\Run.ps1 -NoStaticUi -NoOpenUi

# 指定端口
.\Run.ps1 -Port 8093 -UiPort 8094 -Restart

# 只检查依赖，不自动安装
.\Run.ps1 -SkipDependencyInstall
```

手工方式：

```powershell
.venv\Scripts\python.exe server.py
```

启动脚本会预检查 `fastapi`、`uvicorn`、`httpx`、`pyomo` 和 `highspy`。依赖缺失时执行：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 2.3 打开前端

推荐通过静态前端服务访问，避免浏览器文件协议限制：

```text
http://127.0.0.1:8092/prototype.html?apiBase=http%3A%2F%2F127.0.0.1%3A8090%2Fapi
http://127.0.0.1:8092/agent_console.html?apiBase=http%3A%2F%2F127.0.0.1%3A8091%2Fapi
```

也可以直接打开 `prototype.html`。如果直接以文件方式打开，需要确认页面右下角 API Base 指向正在运行的后端。

### 2.4 健康检查

浏览器或接口工具访问：

```text
http://127.0.0.1:8090/api/health
http://127.0.0.1:8091/api/health
```

平台 API 正常返回应包含：

- `ok: true`
- `solver: HiGHS`
- `pyomo_installed: true`
- `highspy_installed: true`
- `component_based_builder`
- `component_registry`
- `cascade_hydro_dispatch`

Agent API 正常返回应包含：

- `ok: true`
- `service: optimization-agent`
- `skill_selection`
- `parameter_extraction`
- `confirm_before_invoke`

如果 `pyomo_installed` 字段没有出现，或能力列表不完整，通常是端口仍运行旧后端进程。执行：

```powershell
.\Run.ps1 -Restart -NoOpenUi
```

### 2.5 停止服务

```powershell
# 停止平台 API 和静态前端
.\Shutdown.ps1

# 停止平台 API、Agent API 和静态前端
.\Shutdown.ps1 -Both

# 停止所有默认端口
.\Shutdown.ps1 -All

# 指定端口停止
.\Shutdown.ps1 -Port 8093 -UiPort 8094
```

`Shutdown.ps1` 默认停止平台 API 和静态前端；只有使用 `-Both`、`-All` 或 `-AgentOnly` 时才会停止 Agent API。

## 3. 前端一键演示

前端右下角会出现“电力优化闭环演示”浮层。

### 3.0 前端联调入口与 API 地址

前端浮层顶部提供 API 地址输入框，默认会按以下优先级解析：

1. 页面 URL 参数 `apiBase`，例如：

```text
prototype.html?apiBase=http://127.0.0.1:8090/api
```

2. 浏览器本地配置 `power-or-api-base`。
3. 如果页面通过 HTTP 服务打开，自动使用当前域名下的 `/api`。
4. 如果直接以文件方式打开，默认使用：

```text
http://127.0.0.1:8090/api
```

如后端端口发生变化，可直接在浮层 API 地址输入框中修改，页面会保存到浏览器本地配置。

### 3.1 储能充放电优化演示

操作步骤：

1. 打开 `prototype.html`。
2. 在右下角“电力优化闭环演示”浮层中选择“储能充放电优化”。
3. 业务目标可填写：

```text
最大化峰谷套利收益
```

4. 点击“一键演示”。
5. 查看以下内容：
   - 预测输入
   - 核心指标
   - 图表数据
   - 中文解释
   - 建议动作
6. 点击“导出报告”。
7. 页面会显示报告文件路径。

预期结果：

- 可看到 `electricity_price`
- 可看到 `initial_soc`
- 可看到充放电计划
- 可看到 SOC 曲线数据
- 可看到收益测算 `profit`
- 中文解释应说明“低价充电、高价放电”

### 3.2 日前机组组合优化演示

操作步骤：

1. 打开 `prototype.html`。
2. 在右下角浮层中选择“日前机组组合优化”。
3. 业务目标可填写：

```text
根据明日负荷预测生成机组启停和备用计划
```

4. 点击“一键演示”。
5. 查看以下内容：
   - 负荷预测
   - 新能源预测
   - 机组初始状态
   - 总成本
   - 备用裕度
   - 中文解释
6. 点击“导出报告”。

预期结果：

- 可看到 `load_forecast`
- 可看到 `renewable_forecast`
- 可看到机组启停计划
- 可看到出力计划
- 可看到总成本 `total_cost`
- 可看到备用裕度 `reserve_slack`

## 4. 通过 API 演示

以下示例可在 PowerShell 中执行。

### 4.1 场景闭环演示接口

储能优化：

```powershell
$body = @{
  scenario = "storage_dispatch"
  use_sample_data = $true
  business_goal = "最大化峰谷套利收益"
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/demo/run" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

日前机组组合：

```powershell
$body = @{
  scenario = "unit_commitment_day_ahead"
  use_sample_data = $true
  business_goal = "根据明日负荷预测生成机组启停和备用计划"
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/demo/run" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

返回字段说明：

- `forecast_inputs`：预测模拟服务输出
- `solve_result`：完整求解结果
- `business_summary`：中文业务解释
- `suggested_actions`：建议动作
- `warnings`：风险提示
- `job_status`：任务状态

### 4.2 智能体调用接口

储能自然语言目标：

```powershell
$body = @{
  business_goal = "在满足SOC约束下最大化峰谷套利收益"
  runtime_parameters = @{}
  explain = $true
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/agent/optimize" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

机组组合自然语言目标：

```powershell
$body = @{
  business_goal = "根据明日负荷预测生成机组启停和备用计划"
  runtime_parameters = @{}
  explain = $true
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/agent/optimize" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

返回字段说明：

- `matched_scenario`：自动匹配到的模型模板
- `forecast_inputs`：自动注入的预测输入
- `business_result`：业务化结果
- `summary`：中文摘要
- `suggested_actions`：建议动作
- `warnings`：风险提示

## 5. 模板库操作

### 5.1 查询模板列表

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/templates"
```

内置模板：

- `unit_commitment_day_ahead`
- `economic_dispatch`
- `storage_dispatch`
- `renewable_storage_dispatch`
- `chp_dispatch`

### 5.2 查询模板详情

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/templates/storage_dispatch"
```

### 5.3 查询参数填报说明

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/templates/storage_dispatch/parameter-schema"
```

### 5.4 查询示例运行参数

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/templates/storage_dispatch/sample-runtime-parameters"
```

### 5.5 复制模板为模型资产

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/templates/storage_dispatch/clone" `
  -Method Post
```

### 5.6 自定义空白模型创建与发布

前端入口：

1. 打开 `prototype.html`。
2. 进入左侧菜单“模型创建”。
3. 点击“新建空白模型”。
4. 按 5 步向导填写：
   - 基本信息；
   - 模型语义；
   - 图形化公式；
   - 数据契约；
   - 校验发布。

最小可发布模型需要包含：

- 至少 1 个集合，例如 `unit`、`time`；
- 至少 1 个运行参数，例如 `fuel_cost[unit]`；
- 至少 1 个决策变量，例如 `unit_output[unit,time]`；
- 至少 1 个目标函数项；
- `semantic_spec` 与 `generic_spec` 引用一致。

重要规则：

- 空模型可以保存为草稿，但不能发布。
- 发布前会执行语义一致性校验。
- 发布前会执行 GenericLinearBuilder dry-run 构建。
- 变量名禁止使用 `x`、`y`、`z`。
- POST 创建模型时，如果 ID 已存在会返回 409。
- 如果 Pyomo 未安装，发布前 dry-run 会返回结构化依赖错误。

后端发布失败示例返回：

```json
{
  "detail": {
    "message": "模型校验失败",
    "errors": [
      {
        "field": "generic_spec.objective.terms",
        "error": "objective terms are required before publish"
      }
    ]
  }
}
```

## 6. 手工提交优化任务

### 6.1 提交储能优化任务

```powershell
$params = Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/templates/storage_dispatch/sample-runtime-parameters"

$body = @{
  model_code = "storage_dispatch"
  horizon = $params.horizon
  parameters = $params
  time_limit_seconds = 30
} | ConvertTo-Json -Depth 20

$task = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/optimize/run" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $body

$task
```

### 6.2 查询任务状态

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/optimize/jobs/$($task.id)"
```

### 6.3 查询任务结果

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/optimize/result/$($task.id)"
```

### 6.4 查询任务追踪信息

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/jobs/$($task.id)/trace"
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/jobs/$($task.id)/logs"
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/jobs/$($task.id)/metrics"
```

## 7. 报告导出

### 7.1 从 demo 结果导出报告

```powershell
$demoBody = @{
  scenario = "storage_dispatch"
  use_sample_data = $true
  business_goal = "最大化峰谷套利收益"
} | ConvertTo-Json -Depth 10

$demo = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/demo/run" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $demoBody

$reportBody = @{
  scenario = $demo.scenario
  forecast_inputs = $demo.forecast_inputs
  solve_result = $demo.solve_result
  business_summary = $demo.business_summary
  warnings = $demo.warnings
  format = "html"
} | ConvertTo-Json -Depth 30

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/reports/export" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $reportBody
```

返回：

- `file_path`：报告文件路径
- `download_url`：浏览器下载路径

报告默认生成到：

```text
reports/
```

## 8. 滚动优化

示例：

```powershell
$body = @{
  model_template_code = "economic_dispatch"
  horizon = 2
  step_size = 1
  rounds = 2
  runtime_parameters = @{
    load_forecast = @(160, 190, 175)
    unit = @("U1", "U2", "U3")
  }
} | ConvertTo-Json -Depth 20

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/rolling/run" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

查询历史：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/rolling/{rolling_job_id}/history"
```

## 9. 自动化测试

运行全部测试：

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'
```

预期：

```text
OK
```

当前测试覆盖：

- 五类模板求解
- 参数校验
- 不可行诊断
- 智能体调用
- 储能闭环演示
- 机组组合闭环演示
- 报告导出
- 模型创建/发布校验
- 重复模型 ID 冲突
- 自定义模型 dry-run 发布检查

## 10. 常见问题

### 10.1 健康检查失败

处理：

1. 确认服务是否启动。
2. 执行：

```powershell
.\Shutdown.ps1
.\Run.ps1 -NoOpenUi
```

3. 再访问：

```text
http://127.0.0.1:8090/api/health
```

### 10.2 端口 8090 被占用

执行：

```powershell
.\Shutdown.ps1
```

再重新启动。

### 10.3 `pyomo_installed` 或 `highspy_installed` 为 false

安装依赖：

```powershell
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

如果依赖已安装但页面仍显示异常，通常是后端旧进程未重启：

```powershell
.\Run.ps1 -Restart -NoOpenUi
```

### 10.4 报告无法打开

检查 `reports/` 目录是否存在。服务启动时会自动创建该目录；也可手工创建：

```powershell
New-Item -ItemType Directory -Force reports
```

### 10.5 中文显示异常

PowerShell 控制台可能显示乱码，但浏览器和报告文件使用 UTF-8。建议用浏览器查看接口响应或报告文件。

## 11. 前端联调测试清单

### 11.1 启动命令

后端启动：

```powershell
.\Run.ps1 -NoOpenUi
```

或：

```powershell
.venv\Scripts\python.exe server.py
```

前端启动：

```powershell
.\Run.ps1
```

也可以直接打开：

```text
C:\Users\45527\Documents\Codex\2026-04-29\copt-500\prototype.html
```

健康检查：

```text
http://127.0.0.1:8090/api/health
```

### 11.2 页面地址

推荐访问：

```text
file:///C:/Users/45527/Documents/Codex/2026-04-29/copt-500/prototype.html
```

如果需要指定后端地址：

```text
file:///C:/Users/45527/Documents/Codex/2026-04-29/copt-500/prototype.html?apiBase=http://127.0.0.1:8090/api
```

### 11.3 storage_dispatch 联调步骤

1. 启动后端并确认 `/api/health` 正常。
2. 打开前端页面。
3. 在右下角“电力优化闭环演示”浮层中选择“储能充放电优化”。
4. 点击“加载模板”，确认模板列表可加载。
5. 点击“一键演示”。
6. 确认页面展示：
   - 预测输入；
   - 充放电计划；
   - SOC 变化；
   - 收益测算；
   - 中文解释；
   - 风险提示或建议动作。
7. 点击“导出报告”，确认出现报告路径或下载链接。
8. 刷新页面后重复执行，确认页面仍可使用。

### 11.4 unit_commitment_day_ahead 联调步骤

1. 启动后端并确认 `/api/health` 正常。
2. 打开前端页面。
3. 在右下角“电力优化闭环演示”浮层中选择“日前机组组合优化”。
4. 点击“一键演示”。
5. 确认页面展示：
   - 负荷预测；
   - 新能源预测；
   - 机组初始状态；
   - 机组启停计划；
   - 出力计划；
   - 总成本；
   - 备用裕度；
   - 中文解释。
6. 点击“导出报告”，确认报告导出成功。
7. 刷新页面后重复执行，确认页面仍可使用。

### 11.5 已修复问题清单

- 前端 API baseURL 已统一到 `apiFetch`，支持 URL 参数、本地配置和默认值。
- 演示浮层支持修改并保存 API 地址，减少端口硬编码影响。
- API 请求增加超时、JSON/text 兼容解析和友好错误提示。
- 结果页增加 Error Boundary，单个组件异常不会导致白屏。
- 演示按钮增加 loading 和 disabled 状态，避免重复提交。
- 请求失败后会恢复按钮状态并展示错误信息。
- 空结果、缺失字段、空图表数据均降级展示，不再直接崩溃。
- `storage_dispatch` 结果展示已覆盖充放电计划、SOC 曲线、收益测算、中文解释和风险提示。
- `unit_commitment_day_ahead` 结果展示已覆盖启停计划、出力计划、总成本、备用裕度和中文解释。
- 报告导出按钮调用 `/api/reports/export`，成功后展示文件路径和下载链接。
- 任务状态识别补齐 `VALIDATING`、`BUILDING_MODEL`、`SOLVING`、`FORMATTING_RESULT`、`INFEASIBLE`、`TIMEOUT`、`CANCELLED`。
- 后端闭环演示等待逻辑已放宽，避免求解任务仍在运行时提前读取结果。
- 智能体和 demo 场景匹配优先使用显式 `scenario`，避免业务目标文本误匹配模板。

### 11.6 仍存在问题清单

- `prototype.html` 仍是单文件前端原型，未拆分为工程化前端模块；本阶段为稳定性修复，未引入构建工具。
- 历史页面中仍存在部分旧版静态文案编码异常，但右下角闭环演示浮层和新增结果展示链路可正常使用。
- 当前前端为轮询/同步演示模式，尚未接入 WebSocket 或 SSE 进度推送。
- 报告导出当前以 HTML 和 Word 可打开的 `.doc` 形式为主，尚未实现原生 PDF/Excel 导出。

### 11.7 验证命令

前端脚本语法检查：

```powershell
$raw = Get-Content prototype.html -Raw -Encoding UTF8
$script = [regex]::Match($raw, '<script>([\s\S]*)</script>').Groups[1].Value
Set-Content -Path __prototype_check.js -Value $script -Encoding UTF8
node --check __prototype_check.js
Remove-Item -LiteralPath __prototype_check.js -Force
```

后端自动化测试：

```powershell
python -m unittest discover -s tests -p 'test_*.py'
```

预期结果：

```text
Ran 23 tests
OK
```

## 12. 演示推荐话术

储能场景：

```text
平台首先通过预测模拟服务生成电价、负荷、新能源和初始SOC数据；
随后自动匹配储能充放电优化模板；
Pyomo 构建 MILP 模型并调用 HiGHS 求解；
结果输出低价充电、高价放电的计划、SOC 曲线、收益测算和约束校核；
最后可一键导出报告。
```

机组组合场景：

```text
平台根据负荷预测、新能源预测和机组初始状态，自动匹配日前机组组合模板；
模型决定每台机组在各时段的启停、启动和出力；
结果给出总成本、燃料成本、启停成本和备用裕度；
业务解释说明高峰负荷下的机组在线安排和备用风险。
```
## Agent / Platform Decoupled Deployment

### Start Modes

```powershell
.\Run.ps1 -Full -Restart
.\Run.ps1 -Mode combined -Port 8090
.\Run.ps1 -Mode platform -Port 8090
.\Run.ps1 -Mode agent -Port 8091
.\Run.ps1 -Mode both -Port 8090 -AgentPort 8091
.\Shutdown.ps1 -Both
```

### Platform Token

Set `OPTIMIZATION_PLATFORM_API_TOKEN` on both sides when token protection is required:

```powershell
$env:OPTIMIZATION_PLATFORM_API_TOKEN="your-token"
$env:OPTIMIZATION_PLATFORM_BASE_URL="http://127.0.0.1:8090"
```

The token is read only on the server side and is sent by the Agent as a Bearer token. Do not put it in frontend code.

### Agent Flow

1. Open `prototype.html`.
2. Go to `Agent 对话调用`.
3. Select an enabled Skill, for example `run_economic_dispatch`.
4. Enter: `帮我跑一下 U1、U2 三个时段经济调度，负荷100、120、90，U1最大80成本10，U2最大100成本20`.
5. Click `分析参数`.
6. Confirm the extracted parameters and click `确认调用`.
7. Review the business explanation and advisory-only safety note.

### Persistence

Runtime invocation logs, Skill lifecycle state, and Agent conversations are persisted to:

```text
data/runtime_store.json
```

Override with:

```powershell
$env:RUNTIME_STORE_PATH="data/runtime_store.json"
```
