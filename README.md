# 电力业务语义驱动运筹优化平台内核

本仓库是一个面向电力业务场景的运筹优化平台原型，后端采用 FastAPI + Pyomo + HiGHS，前端以单文件原型 `prototype.html` 和 `agent_console.html` 承载演示、模型创建、资产治理和 Agent 调用流程。

当前版本重点完成了组件化自定义 Builder 与梯级水电调度模型接入，已支持从模型创建、资产中心调用、任务实例化、Skill API 到模型 invoke 的完整链路。

## 技术栈

- 后端框架：FastAPI
- 建模引擎：Pyomo
- 求解器：HiGHS / highspy
- 前端原型：原生 HTML/CSS/JavaScript
- 本地运行：PowerShell 脚本 + Python 虚拟环境

暂不引入 COPT、Gurobi、多求解器路由、数据库持久化和工程化前端构建工具。

## 工程结构

```text
app/
  api/                         API 路由
  builders/                    Pyomo、Generic Linear、组件化 Builder
  model_components/            组件注册表、水电组件、组件运行时校验
  semantic/                    语义校验与运行时参数校验
  services/                    模型、任务、Skill、调用记录等服务
  templates/                   内置电力模型模板
  explain/                     业务结果格式化与解释
  solvers/                     HiGHS 适配器
agent_skills/                  Agent Skill 包
tests/                         自动化测试
prototype.html                 平台原型 UI
agent_console.html             Agent 控制台 UI
server.py                      兼容启动入口
Run.ps1                        本地启动脚本
Shutdown.ps1                   本地停止脚本
```

## 快速启动

首次准备依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

一键启动完整本地环境（平台 API、Agent API、静态前端）：

```powershell
.\Run.ps1 -Full -Restart
```

只启动平台 API 和静态前端服务：

```powershell
.\Run.ps1 -Restart
```

默认端口：

- 平台 API：`http://127.0.0.1:8090/api`
- Agent API：`http://127.0.0.1:8091/api`
- 静态前端：`http://127.0.0.1:8092`

常用启动方式：

```powershell
# 只启动平台 API 和 prototype.html
.\Run.ps1

# 平台 + Agent + 两个前端页面
.\Run.ps1 -Full -Restart

# 等价写法
.\Run.ps1 -Mode both -Restart

# 只启动后端，不启动静态前端服务
.\Run.ps1 -NoStaticUi -NoOpenUi

# 使用临时端口，避免和旧进程冲突
.\Run.ps1 -Port 8093 -UiPort 8092 -Restart
```

启动成功后，脚本会输出并打开类似以下地址：

```text
http://127.0.0.1:8092/prototype.html?apiBase=http%3A%2F%2F127.0.0.1%3A8090%2Fapi
```

停止服务：

```powershell
# 停止平台 API 和静态前端
.\Shutdown.ps1

# 停止平台 API、Agent API 和静态前端
.\Shutdown.ps1 -Both

# 停止所有默认端口
.\Shutdown.ps1 -All
```

`Run.ps1` 会自动创建 `.venv` 并安装缺失依赖。若只希望做启动检查、不自动安装依赖，可加 `-SkipDependencyInstall`。

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8090/api/health
```

`capabilities` 应包含：

```text
component_based_builder
component_registry
cascade_hydro_dispatch
```

如果缺少这些能力，通常说明端口上仍是旧后端进程，请执行：

```powershell
.\Run.ps1 -Restart
```

## 内置模型模板

服务启动时会加载以下模型模板：

- `unit_commitment_day_ahead`：日前机组组合优化
- `economic_dispatch`：经济负荷分配
- `storage_dispatch`：储能充放电优化
- `renewable_storage_dispatch`：风光储协同优化
- `chp_dispatch`：电热协同优化
- `cascade_hydro_dispatch`：梯级水电日前调度优化，组件化 Builder 模型

`cascade_hydro_dispatch` 使用 `build_mode=component_based`，其 `component_spec` 由水电组件注册表构建 Pyomo 模型，覆盖初始库容、库容边界、检修可用容量、出力-流量转换、下泄平衡、弃水边界、梯级时滞入库、水量平衡、负荷跟踪、期末库容控制和出力平滑等组件。

## 核心 API

模板库：

```text
GET  /api/templates
GET  /api/templates/{template_code}
GET  /api/templates/{template_code}/parameter-schema
GET  /api/templates/{template_code}/sample-runtime-parameters
POST /api/templates/{template_code}/clone
```

模型资产：

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

优化任务：

```text
POST /api/optimize/run
GET  /api/optimize/jobs
GET  /api/optimize/jobs/{job_id}
GET  /api/optimize/result/{job_id}
POST /api/tasks/{task_id}/retry
POST /api/tasks/{task_id}/cancel
```

Skill 调用：

```text
GET  /api/skills
POST /api/skills/{skill_name}/analyze-input
POST /api/skills/{skill_name}/run
```

梯级水电 Skill：

```text
POST /api/skills/run_cascade_hydro_dispatch/run
```

## 梯级水电调用示例

```powershell
$params = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8090/api/templates/cascade_hydro_dispatch/sample-runtime-parameters"

$task = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8090/api/optimize/run" `
  -ContentType "application/json" `
  -Body (@{
    model_code = "cascade_hydro_dispatch"
    runtime_parameters = $params
    time_limit_seconds = 30
  } | ConvertTo-Json -Depth 20)

$task
```

结果指标中弃水使用体积单位：

```text
total_spill_million_m3
spill_volume_million_m3
```

## 前端验证路径

详细操作说明见 [组件化自定义 Builder 使用说明](docs/component_builder_user_guide.md)。

平台 UI：

1. 打开 `prototype.html`。
2. 进入“模型创建”。
3. 点击“加载组件化水电样例”。
4. 第 3 步应显示“组件化 Builder”和 12 个水电组件。
5. 进入“模型资产中心”，点击水电模型的“调用模型”。
6. 任务页应自动填入 `time_volume` 等英文运行时参数 key。
7. 点击“实例化并提交任务”，任务应成功完成。

Agent UI：

1. 使用 `.\Run.ps1 -Mode both -Restart`。
2. 打开 `agent_console.html`。
3. 调用 `run_cascade_hydro_dispatch` 或输入梯级水电调度目标。

## 测试

专项测试：

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_component_based_hydro_model.py -q
```

全量回归：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

前端脚本语法检查：

```powershell
$raw = Get-Content prototype.html -Raw -Encoding UTF8
$script = [regex]::Match($raw, '<script>([\s\S]*)</script>').Groups[1].Value
Set-Content -Path __prototype_check.js -Value $script -Encoding UTF8
node --check __prototype_check.js
Remove-Item -LiteralPath __prototype_check.js -Force
```

当前已验证：`114 passed`。

## 运行时数据

默认运行时数据保存在：

```text
data/runtime_store.json
```

报告导出目录：

```text
reports/
```

日志目录：

```text
logs/
```

## React 正式前端

正式前端位于 `frontend/`，使用 Vite、React、TypeScript、React Router、TanStack Query、Zustand、Ant Design、Axios 和 ECharts。原 `prototype.html` 保留为 legacy 入口。

开发环境：

```powershell
# 终端 1：FastAPI API
$env:PORT='8000'
python server.py

# 终端 2：Vite UI
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

前端地址为 `http://localhost:5173`，后端为 `http://localhost:8000`，Vite 将 `/api` 代理到后端。

生产构建与测试：

```powershell
cd frontend
npm run build
npm run test
npm run test:e2e
cd ..
$env:PORT='8000'
python server.py
```

构建后 FastAPI 自动托管：

- `/`：React 应用，客户端路由支持直接刷新。
- `/api/*`：原 FastAPI API。
- `/legacy`、`/prototype.html`：原生 JS legacy 页面。
- `/static/*`：legacy CSS/JS。

阶段测试记录见 `docs/frontend-migration-test-log.md`。本次未改写 FastAPI、Pyomo、HiGHS、模型模板、组件注册表或求解器核心。

当前明确边界：Monaco Editor 是可选项，本版未引入；结果导出按钮仅预留；Agent 仅迁移页面；`abs`、值函数 `min/max`、`piecewise`、`!=` 和变量乘除变量在完成线性化前会阻止通用线性模型发布。聚合 `sum/min/max` 以结构化 AggregateToken 保存。
