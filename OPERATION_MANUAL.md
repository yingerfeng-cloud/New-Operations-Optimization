# 电力优化平台操作手册

## 1. 服务与入口

正式使用 React 前端：

- 开发前端：`http://localhost:5173`
- 生产前端：`http://localhost:8000/`
- FastAPI：`http://localhost:8000/api`
- 健康检查：`http://localhost:8000/api/health`

legacy prototype 前端已下线；`/legacy`、HTML 原型入口 与 `/static/*` 返回 404。日常模型、组件、任务和结果操作均使用 React 前端。

## 2. 环境准备

后端：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

前端：

```powershell
cd frontend
npm install
Copy-Item .env.example .env -ErrorAction SilentlyContinue
```

默认环境配置：

```dotenv
VITE_API_BASE_URL=http://localhost:8000
```

## 3. 启动

### 3.1 脚本启动（推荐）

在仓库根目录执行：

```powershell
.\启动-运筹优化底座.ps1
```

脚本会同时启动 FastAPI `8000` 和 React/Vite `5173`，并写入 PID 文件：

- `logs/.platform-api.pid`
- `logs/.platform-frontend.pid`

停用服务：

```powershell
.\停用-运筹优化底座.ps1
```

Agent 兼容脚本仍可使用：

```powershell
.\启动-Agent工作台.ps1
.\停用-Agent工作台.ps1
```

Agent 工作台入口为 `http://localhost:5173/agents`。旧的 `8090/8091` 端口仅作为停用脚本的兼容清理对象。

生产/后端托管模式：

```powershell
cd frontend
npm run build
cd ..
.\启动-运筹优化底座.ps1 -NoFrontend
```

打开 `http://localhost:8000/`。

### 3.2 手工开发模式

终端 1：

```powershell
$env:PORT='8000'
.\.venv\Scripts\python.exe server.py
```

终端 2：

```powershell
cd frontend
npm run dev
```

启动后打开 `http://localhost:5173`。顶部 API 状态应显示“API 已连接”。

### 3.3 手工生产模式

```powershell
cd frontend
npm run build
cd ..
$env:PORT='8000'
.\.venv\Scripts\python.exe server.py
```

打开 `http://localhost:8000/`。FastAPI 会托管 `frontend/dist`，并保留 `/api`。

### 3.4 健康检查

```powershell
Invoke-RestMethod http://localhost:8000/api/health
```

应至少返回：

- `ok: true`
- `solver: HiGHS`
- `pyomo_installed: true`
- `highspy_installed: true`

## 4. 总览驾驶舱

访问 `/`。页面展示：

- 模型数量
- 组件数量
- 模板数量
- 最近任务
- 求解成功数量与状态统计

所有数据来自真实后端，加载与刷新由 TanStack Query 管理。

## 5. 模型资产中心

访问 `/models`。

支持：

1. 查看模型名称、编码、场景、建模模式、问题类型、状态、求解器和更新时间。
2. 打开详情查看语义、`generic_spec`、`component_spec`、运行参数、校验和测试结果。
3. 发布、测试或复制模型。
4. 点击“从模板克隆”，从 12 个内置模板选择并生成模型资产。
5. 点击“创建模型”进入五步流程。

发布或测试失败时，页面会显示后端返回的统一错误信息。

## 6. 五步模型创建

访问 `/models/create`。

### Step 1：基础信息

填写模型名称、模型编码、业务场景，选择通用线性 Builder 或组件化 Builder。可从模板初始化 ModelDraft。

### Step 2：模型语义

维护集合、参数、变量与组件清单。

时间集合约定：

- `time`：调度时段，长度为 `horizon`
- `time_volume`：状态时点，长度为 `horizon + 1`

### Step 3：数学展开

通用线性 Builder 使用统一公式编辑器维护约束和目标。公式同时保存中文展示、DSL 和结构化 token，并编译为 `generic_spec`。

组件化 Builder 展示组件生成的约束、目标项与依赖关系。

以下情况会阻止发布：

- 公式缺少关系符或目标函数
- 变量乘除变量
- `!=`
- 未线性化的 `abs`、值函数 `min/max`、`piecewise`
- 无法编译的右端表达式

### Step 4：运行参数

参数按运行时、静态、业务台账、系统生成和目标权重分类。支持 JSON 导入、预览与格式校验。

### Step 5：校验发布

检查语义、公式、组件依赖、参数绑定、问题类型和求解器兼容性。校验通过后可发布或测试运行。

## 7. 统一公式编辑器

公式编辑器以 TokenCanvas 为主：

- 插入变量、参数、集合、常量和运算符
- 插入结构化 `sum/min/max` 聚合块
- 支持外层 foreach 与自由索引识别
- 同步 `display_formula`、`dsl_formula`、`tokens`
- 提供 DSL 与 JSON 调试面板
- 展示引用对象、编译状态和校验错误

示例：

```text
sum(p[u,t] for u in unit) >= load[t]
sum(cost[u] * p[u,t] for u in unit for t in time)
```

## 8. 组件库管理

访问 `/components`。

支持查看、编辑、校验、发布、复制版本和停用组件。详情包含：

- required_sets
- parameters
- variables
- generated_constraints
- generated_objective_terms
- parameter_bindings
- dependencies
- validation_result

依赖面板会列出缺失组件；缺失依赖必须在发布前处理。

## 9. 任务调度中心

访问 `/tasks`。

1. 点击“创建任务”。
2. 选择模型、调度时段与 HiGHS。
3. 提交后列表每 5 秒刷新任务状态。
4. 可查看输入、日志、状态、目标值和结果。
5. PENDING、VALIDATING、BUILDING_MODEL、SOLVING 状态的任务可取消。

## 10. 结果报告库

访问 `/results`。可查看关键指标、变量结果、ECharts 曲线和完整 JSON。

当前导出按钮为预留功能。光储和水电结果的业务指标由后端结果结构决定。

## 11. Agent 工作台

访问 `/agents`。当前页面已接入 Agent 状态、Skill、会话、参数抽取、默认值确认、示例参数和确认调用入口。

Agent 工作台使用 `/api/agent/status`、`/api/agent/agent-skills`、`/api/agent/conversations`、`/api/agent/analyze`、`/api/agent/confirm-defaults` 和 `/api/agent/confirm-invoke`。Agent 后端编排、鉴权和会话持久化仍沿用现有服务实现。平台 Token 不应写入前端代码。

## 12. 常用 API 示例

模板克隆：

```powershell
$model = Invoke-RestMethod -Method Post `
  -Uri http://localhost:8000/api/templates/storage_dispatch/clone
```

模型发布：

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8000/api/models/$($model.id)/publish"
```

组件校验：

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:8000/api/components/power_balance/validate
```

任务列表：

```powershell
Invoke-RestMethod http://localhost:8000/api/tasks
```

Agent 状态：

```powershell
Invoke-RestMethod http://localhost:8000/api/agent/status
```

## 13. 测试与验收

```powershell
python scripts/verify_test_matrix.py
cd frontend
npm run typecheck
npm run test:phase
npm run build
npm run test:e2e
cd ..
python -m pytest -q
```

完整前端单测可运行 `npm run test:unit`。详细分组见 `docs/iteration-test-entrypoints.md`，阶段结果见 `docs/frontend-migration-test-log.md`，测试体系收口见 `docs/frontend-migration-test-closure.md`。

若在受限沙箱中遇到 Vite/Vitest 的 `spawn EPERM`，通常是 esbuild 子进程启动被拦截；先完成 `python scripts/verify_test_matrix.py` 与 `npm run typecheck`，再在本地或 CI 的非受限环境运行完整 gate。

## 14. 常见问题

### API 连接失败

确认 8000 端口运行的是本项目，并检查：

```powershell
Invoke-RestMethod http://localhost:8000/api/health
```

开发环境还需确认 `frontend/.env` 与 Vite proxy 指向同一端口。

### React 路由刷新返回 404

必须先运行 `npm run build`，并通过 `server.py` 启动包含 `app/frontend.py` 挂载逻辑的 FastAPI 应用。

### legacy 页面已下线

旧 `/legacy`、HTML 原型入口 与 `/static/*` 入口已删除，返回 404。请使用 React 前端 `/` 与 `/agents` 等正式路由。

### Pyomo 或 highspy 不可用

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### E2E 打开了错误项目

Playwright 固定使用 5178。不要将其改回 `reuseExistingServer` 的共享 5173，避免复用本机其他 Vite 项目。

## 15. 当前边界

- Monaco Editor 未引入。
- 结果导出尚未接入。
- Agent 工作台已接入真实 Agent API，后端编排仍沿用现有服务。
- 复杂函数在完成可靠线性化前不会进入通用线性求解结构。
- legacy prototype 前端已删除；正式功能和测试只进入 React/Vite 前端。
