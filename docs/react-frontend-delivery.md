# React 前端迁移交付说明

本文档是阶段十二交付入口，说明当前 React 前端迁移的完成范围、启动方式、测试 gate 和保留边界。

## 交付范围

- 阶段一到阶段六：完成五步模型创建主流程，包括场景/模板选择、Step2 模型语义、统一公式编辑器、Step3 数学展开、`generic_spec` 编译、Step4 运行参数、Step5 校验发布与测试运行。
- 阶段七：完成组件库迁移，覆盖组件清单、详情、编辑、依赖、参数绑定、校验、发布、复制版本和停用。
- 阶段八：完成模型资产中心迁移，覆盖资产列表、详情、模板克隆、语义、`generic_spec`、组件、运行参数、治理信息和测试结果。
- 阶段九：完成任务调度中心与结果报告中心迁移，覆盖任务创建、轮询、取消、重试、日志、结果详情、报告指标、图表和 JSON 结果。
- 阶段十：完成 Agent 工作台接口对齐，接入 `/api/agent/*` 状态、Skill、会话、分析、默认值确认、示例参数和确认调用。
- 阶段十一：完成测试体系收口，固化 `typecheck`、`test:unit`、`test:phase` 和 `scripts/verify_test_matrix.py`。
- 阶段十二：完成 README、操作手册和交付说明同步。

## 启动入口

开发模式：

```powershell
.\启动-运筹优化底座.ps1
```

访问：

- React 前端：`http://localhost:5173`
- FastAPI：`http://localhost:8000`
- legacy：`http://localhost:8000/legacy`

生产托管模式：

```powershell
cd frontend
npm run build
cd ..
.\启动-运筹优化底座.ps1 -NoFrontend
```

访问 `http://localhost:8000/`。

## 交付测试 Gate

推荐顺序：

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

说明：

- `verify_test_matrix.py` 校验迁移阶段测试入口是否齐全，不替代单测或回归测试。
- `typecheck` 只跑 TypeScript 项目检查，可在 Vite/Vitest 受沙箱限制时先执行。
- `test:phase` 聚合迁移阶段核心页面测试。
- `build` 生成 `frontend/dist`，供 FastAPI 托管。
- `test:e2e` 使用 Playwright 隔离端口 5178。
- `python -m pytest -q` 运行后端默认回归，默认排除 `slow` 标记。

## 当前验证记录

阶段十一到阶段十二在当前 Codex 沙箱内已通过：

- `python scripts/verify_test_matrix.py`
- `npm run typecheck`
- `python -m py_compile scripts/verify_test_matrix.py`
- 文档与脚本范围的 `git diff --check`

当前沙箱中 `npm run test:phase`、`npm run build` 的 Vite/Vitest 部分会在 esbuild 子进程启动时报 `spawn EPERM`。这属于执行环境权限限制；在本地非沙箱环境或 CI 中仍应运行完整 gate。

## 保留边界

- legacy `prototype.html` 与 `agent_console.html` 继续保留，只做兼容和回归用途。
- 求解核心、模板注册表、组件注册表和 Agent 后端编排仍由现有 FastAPI 服务承担，React 前端不重写求解内核。
- Monaco Editor 未引入；当前公式编辑器以结构化 TokenCanvas 为主。
- 结果导出按钮仍为预留能力。
- Ant Design/ECharts vendor chunk 可能出现体积提示，不影响当前构建和运行。
