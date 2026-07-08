# 电力业务语义驱动运筹优化平台

本项目是面向电力优化场景的模型资产与求解平台。后端保留 FastAPI + Pyomo + HiGHS，正式前端为 Vite + React + TypeScript；旧 `HTML 原型入口` / `Agent 控制台入口` / `static/` legacy 前端已下线并删除。

## 技术栈

- 前端：Vite、React、TypeScript、React Router、TanStack Query、Zustand、Ant Design、Axios、ECharts、Vitest、React Testing Library、Playwright
- 后端：FastAPI、Pyomo、HiGHS / highspy
- 数据：本地运行时存储 `data/runtime_store.json`

## 目录结构

```text
frontend/                       React 正式前端
  src/app/                      路由、Provider、主布局
  src/api/                      统一 API Client
  src/pages/                    各业务中心页面
  src/features/                 模型创建、公式编辑器、组件库、模型/任务/结果/Agent 面板
  src/tests/unit/               Vitest / RTL 测试
  src/tests/e2e/                Playwright 测试
scripts/                        交付与测试矩阵校验脚本
app/                            FastAPI 后端
  api/                          API 路由
  builders/                     Pyomo、Generic Linear、组件化 Builder
  model_components/             组件注册表与运行时校验
  services/                     模型、模板、任务、结果、Agent 服务
  templates/                    12 个内置模板
tests/                          后端回归测试
server.py                      后端启动入口
```

## 快速启动

### 1. 安装后端依赖

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 2. 脚本启动（推荐）

Windows PowerShell 下可直接使用仓库根目录脚本启动新版平台：

```powershell
.\启动-运筹优化底座.ps1
```

该脚本会启动：

- FastAPI 后端：`http://127.0.0.1:8000`
- React/Vite 前端：`http://127.0.0.1:5173`

停用服务：

```powershell
.\停用-运筹优化底座.ps1
```

兼容脚本 `.\启动-Agent工作台.ps1` 和 `.\停用-Agent工作台.ps1` 仍可使用；Agent 工作台现在位于 React 前端 `/agents`。

如只需生产/后端托管模式，可先执行 `cd frontend; npm run build`，再运行：

```powershell
.\启动-运筹优化底座.ps1 -NoFrontend
```

### 3. 手工开发环境

终端 1：启动 FastAPI。

```powershell
$env:PORT='8000'
.\.venv\Scripts\python.exe server.py
```

终端 2：启动 Vite。

```powershell
cd frontend
Copy-Item .env.example .env -ErrorAction SilentlyContinue
npm install
npm run dev
```

访问地址：

- React 前端：`http://localhost:5173`
- FastAPI：`http://localhost:8000`
- 健康检查：`http://localhost:8000/api/health`
- Skill 服务中心：`http://localhost:5173/skills`
- Agent 工作台：`http://localhost:5173/agents`

Vite 会把 `/api` 代理到 `http://localhost:8000`。API 地址可通过 `frontend/.env` 的 `VITE_API_BASE_URL` 覆盖。

### 3.1 Skill / Agent 部署模式

默认使用单体模式：

```powershell
$env:SERVICE_MODE='combined'
$env:OPTIMIZATION_PLATFORM_BASE_URL='http://127.0.0.1:8000'
$env:AGENT_PLATFORM_ACCESS_MODE='in_process'
$env:AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK='false'
```

- `combined`：平台与 Agent 在同一个 FastAPI 应用中，Agent 通过 in-process 网关访问 `/api/skills`。
- `platform`：仅暴露平台、模型、任务、结果和 Skill API。
- `agent`：仅暴露 Agent API，需配置 `OPTIMIZATION_PLATFORM_BASE_URL` 指向远端平台。

LLM Key 通过环境变量或安全配置注入；前端和普通 runtime JSON 不返回明文 Key。

### 4. 手工生产模式

```powershell
cd frontend
npm install
npm run build
cd ..
$env:PORT='8000'
.\.venv\Scripts\python.exe server.py
```

FastAPI 自动托管 `frontend/dist`：

- `/`：React 应用
- `/api/*`：后端 API
- `/legacy`、HTML 原型入口、`/static/*`：已下线，返回 404

React 客户端路由支持直接刷新。

## 前端功能

正式前端路由：

| 路由 | 功能 |
| --- | --- |
| `/` | 总览驾驶舱 |
| `/scenarios` | 业务场景库 |
| `/models` | 模型资产中心 |
| `/models/create` | 五步模型创建 |
| `/models/:id` | 模型详情 |
| `/components` | 组件库管理 |
| `/components/:id` | 组件详情与编辑 |
| `/tasks` | 任务调度中心 |
| `/results` | 结果报告库 |
| `/skills` | Skill 服务中心 |
| `/agents` | Agent 工作台 |
| `/services` / `/model-services` | 模型服务接口 |
| `/settings` | 系统配置 |

模型创建流程为：基础信息 → 模型语义 → 数学展开 → 运行参数 → 校验发布。支持通用线性 Builder 和组件化 Builder。

统一公式编辑器使用结构化 token，不以 textarea 作为主要编辑方式。公式同步保存 `display_formula`、`dsl_formula` 与 `tokens`，并识别引用集合、参数、变量和自由索引。通用线性公式必须成功编译为 `generic_spec` 才能发布。

当前会阻止发布的表达式包括：未线性化的 `abs`、值函数 `min/max`、`piecewise`、`!=` 和变量乘除变量。聚合 `sum/min/max` 使用结构化 `AggregateToken`。

## 内置资产

当前内置 12 个模型模板：

- `unit_commitment_day_ahead`
- `economic_dispatch`
- `storage_dispatch`
- `renewable_storage_dispatch`
- `chp_dispatch`
- `cascade_hydro_dispatch`
- `pv_storage_capacity_planning`
- `pv_storage_day_ahead_dispatch`
- `pv_storage_intraday_dispatch`
- `pv_storage_dispatch_v2`
- `pv_storage_day_ahead_dispatch_v2`
- `pv_storage_intraday_dispatch_v2`

组件库包含 24 个内置组件。模板与组件仍由原后端注册表和服务管理，前端改造未重写求解核心。

## 常用 API

```text
GET  /api/templates
GET  /api/templates/{code}
POST /api/templates/{code}/clone

GET  /api/models
POST /api/models
GET  /api/models/{id}
PUT  /api/models/{id}
POST /api/models/{id}/publish
POST /api/models/{id}/test
POST /api/models/{id}/copy

GET  /api/components/catalog
POST /api/components/catalog
GET  /api/components/{id}
PUT  /api/components/{id}
POST /api/components/{id}/validate
POST /api/components/{id}/publish
POST /api/components/{id}/copy-version
POST /api/components/{id}/offline

GET  /api/tasks
POST /api/tasks
GET  /api/tasks/{id}
POST /api/tasks/{id}/cancel
POST /api/tasks/{id}/retry
GET  /api/tasks/{id}/result
GET  /api/results

GET  /api/agent/status
GET  /api/agent/agent-skills
GET  /api/agent/conversations
POST /api/agent/analyze
POST /api/agent/confirm-defaults
POST /api/agent/confirm-invoke
```

## 测试

前端迁移阶段收口：

```powershell
python scripts/verify_test_matrix.py
cd frontend
npm ci
npm run typecheck
npm run test:phase
npm run build
npm run test
npx playwright install chromium
npm run test:e2e
npx playwright show-report
```

Linux CI 环境如缺少系统依赖，先执行：

```bash
cd frontend
npx playwright install --with-deps chromium
npm run test:e2e
```

本项目的 `playwright.config.ts` 默认使用 Playwright 托管 Chromium，不写死本机 Chrome。需要指定本机 Chrome 时可设置 `PW_CHANNEL=chrome`；如系统已有 Chromium（例如 `/usr/bin/chromium`），也可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` 指定可执行文件。

E2E 会输出 `frontend/playwright-report` 和 `frontend/test-results`，其中包含 HTML 报告、trace 与 screenshot。查看报告：

```powershell
cd frontend
npx playwright show-report
```

`real_backend_smoke.spec.ts` 会启动并调用真实 FastAPI 后端，依赖 Python 后端环境、Pyomo 与 HiGHS/highspy 可用；如果求解依赖缺失，用例接受后端错误在页面可见，但真实求解闭环需要完整安装这些依赖。

前端全量单测：

```powershell
cd frontend
npm run test:unit
```

后端回归：

```powershell
python -m pytest -q
```

分组测试命令见 [迭代测试入口](docs/iteration-test-entrypoints.md)，阶段验收结果见 [前端迁移测试记录](docs/frontend-migration-test-log.md)，测试体系收口见 [前端迁移测试体系收口](docs/frontend-migration-test-closure.md)。

当前 Codex 沙箱中 Vite/Vitest 可能因 esbuild 子进程启动报 `spawn EPERM`。遇到该限制时，先以 `python scripts/verify_test_matrix.py` 与 `npm run typecheck` 完成静态收口；在本地或 CI 的非受限环境继续运行 `npm run test:phase`、`npm run build`、`npm run test:e2e` 和 `python -m pytest -q`。

## 交付说明

React 前端迁移已按阶段拆分交付，覆盖五步模型创建、统一公式编辑器、`generic_spec` 编译闭环、运行参数、校验发布、组件库、模型资产中心、任务调度中心、结果报告中心、Agent 工作台接口对齐和测试体系收口。

交付包不得包含 `frontend/node_modules`、`frontend/dist`、`frontend/playwright-report`、`frontend/test-results`、`frontend/tsconfig*.tsbuildinfo`、`logs/`、`artifacts/`、`.agents/`、`.claude/`、`.codex/`、`__pycache__/` 等本地依赖、构建缓存和运行产物。解压后进入 `frontend` 执行 `npm ci` 安装依赖；不要提交或打包 `node_modules`。

交付入口见 [React 前端迁移交付说明](docs/react-frontend-delivery.md)。正式功能只使用 `frontend/`；旧 `HTML 原型入口`、`Agent 控制台入口` 与 `static/` 已删除。

## 已知边界

- Monaco Editor 为可选项，当前未引入。
- 结果导出按钮当前仅预留。
- Agent 工作台已对齐 `/api/agent/*` 状态、Skill、会话、分析、默认值确认和调用确认接口；后端 Agent 编排仍沿用现有服务实现。
- Ant Design/ECharts vendor chunk 存在构建体积提示，不影响构建和运行。
- legacy prototype 前端已彻底下线；新增和回归前端能力只进入 `frontend/` 的 React/Vite 测试体系。

详细操作见 [操作手册](OPERATION_MANUAL.md)，代码入口见 [Engineering Map](docs/engineering-map.md)。

## NLP / Ipopt 运行

连续变量 NLP 使用 Pyomo + Ipopt；LP/MILP 仍使用 HiGHS。原生环境不强制安装 Ipopt，但缺失时 NLP 会明确报错或阻断发布。

```powershell
python scripts/check_nlp_solver.py || true
```

Docker Compose 是包含 Ipopt executable 的标准交付环境：

```powershell
docker compose build
docker compose up -d
docker compose exec backend python scripts/check_nlp_solver.py
docker compose exec backend bash scripts/run_nlp_tests.sh
```

原生运行默认使用 `data/` 与 `localhost:8000`；Docker 默认使用 `docker-data/` 与 `localhost:18000`。更多说明见 [NLP Solver Support](docs/nlp-solver.md) 和 [Deployment](docs/deployment.md)。
# P4 产品化演示说明

平台定位：本仓库是面向电力与能源调度场景的运筹优化平台演示版，当前以 React 前端、FastAPI 后端、Pyomo 建模和可路由求解器为核心。

当前标杆模型清单：

- `cascade_hydro_dispatch`：梯级水电日前调度优化模型，MILP / HiGHS。
- `cascade_hydro_dispatch_v1`：梯级水电调度 PWL 标杆模型，MILP / HiGHS / 1D+2D PWL。
- `nonlinear_hydro_power_demo`：非线性水电出力 NLP 演示模型，NLP / Ipopt / `power = k * flow * head`。

当前求解能力边界：

当前求解能力：HiGHS + Ipopt。

- LP / MILP：使用 HiGHS。
- 1D PWL：`piecewise_1d`，用于一维曲线映射。
- 2D PWL：`piecewise_2d + triangulated_milp_exact`，用于二维曲面 MILP 线性化。
- McCormick：用于双线性松弛线性化。
- NLP：已接入 Ipopt 真实求解，适用于连续变量非线性模型。
- MINLP_RESERVED：不作为生产级能力开放；含整数变量的非线性模型建议改用 PWL 或 McCormick 线性化。

演示入口：

- 首页 Dashboard：查看平台能力矩阵、HiGHS/Ipopt 状态、梯级水电与 NLP 标杆入口。
- 模型资产中心：查看 `cascade_hydro_dispatch`、`cascade_hydro_dispatch_v1`、`nonlinear_hydro_power_demo` 的演示说明。
- 函数资产中心：查看水位库容曲线、尾水位流量曲线、水电出力二维曲面。
- 模型服务接口：使用样例参数在线调试水电或 NLP 模型。
- 结果中心：查看水电结果解释和 NLP / Ipopt 结果解释。

启动与测试：

- 原生环境：启动后端后进入 `frontend` 运行 `npm run dev`。
- Docker Compose：`docker compose up --build`，用于标准化 Python / Pyomo / 求解器环境。
- 后端验收：`python -m compileall -q app tests`，`python -m pytest -q`。
- 前端验收：`cd frontend && npm ci && npm run typecheck && npm run build && npm run test:unit`。
- NLP 专项：`python scripts/check_nlp_solver.py`，`python -m pytest tests/test_nlp_environment.py tests/test_nlp_adapter.py tests/test_nonlinear_hydro_power_demo.py -q -s`。

Ipopt 环境说明：`/api/solvers/status` 会返回 Ipopt 可用性、路径和版本；不可用时平台显示明确提示，不会伪造 NLP 求解成功。
