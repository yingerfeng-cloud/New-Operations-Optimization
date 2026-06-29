# Engineering Map

本文件是后续迭代的代码入口索引。正式前端位于 `frontend/`；`prototype.html` 和 `static/js/` 仅作为 legacy 维护。

## React 应用框架

- 入口：`frontend/src/main.tsx`、`frontend/src/App.tsx`
- 路由：`frontend/src/app/router.tsx`
- Provider：`frontend/src/app/providers.tsx`
- 主布局：`frontend/src/app/layout/`
- 全局样式：`frontend/src/styles.css`
- Vite 配置：`frontend/vite.config.ts`

页面使用路由级懒加载。新增正式页面时，应在 `frontend/src/pages/` 建立独立目录，并在 `router.tsx` 注册，避免把业务页面堆入 `App.tsx`。

## 前端 API 层

- Axios Client 与统一错误处理：`frontend/src/api/client.ts`
- 模板：`frontend/src/api/templates.ts`
- 模型：`frontend/src/api/models.ts`
- 组件：`frontend/src/api/components.ts`
- 任务：`frontend/src/api/tasks.ts`
- 结果：`frontend/src/api/results.ts`
- Agent：`frontend/src/api/agents.ts`

服务端状态由 TanStack Query 管理。Mutation 成功后应失效相关 query key，避免页面维护重复缓存。

## 模型创建与公式

- 五步页面：`frontend/src/features/model-creation/ModelCreationPage.tsx`
- 步骤组件：`frontend/src/features/model-creation/steps/`
- Zustand 草稿：`frontend/src/features/model-creation/stores/modelCreationStore.ts`
- 草稿规范化与校验：`frontend/src/features/model-creation/utils/`
- generic_spec 编译：`frontend/src/features/model-creation/utils/compileFormulaToGenericSpec.ts`
- 公式编辑器：`frontend/src/features/formula-editor/`

后端对应入口：

- ModelDraft：`app/model_draft.py`
- 后端公式编译：`app/generic_formula_compiler.py`
- 问题类型诊断：`app/problem_type_diagnosis.py`
- 模型服务：`app/services/model_service.py`
- 模型 API：`app/api/models.py`

修改公式编译时，必须同时运行前端 DSL/Parser/Validator/Compiler 测试和后端 GenericLinearBuilder 回归。

## 组件库

前端：

- 页面：`frontend/src/pages/ComponentLibrary/ComponentLibraryPage.tsx`
- 编辑器与产品化面板：`frontend/src/features/component-library/`

后端：

- API：`app/api/components.py`
- 动态公式组件：`app/model_components/formula_components.py`
- 内置注册表：`app/model_components/registry.py`
- 运行时存储：`app/storage/memory_store.py`

关键不变量：缺失依赖必须阻止发布；只包含组件 ID 的草稿必须在诊断、构建和发布前解析为完整组件定义。

## Pyomo 构建与求解

- 构建分发：`app/builders/pyomo_builder.py`
- 通用线性 Builder：`app/builders/generic_linear_builder.py`
- 组件化 Builder：`app/builders/component_model_builder.py`
- 目标编译：`app/model_components/objective_components.py`
- HiGHS 适配器：`app/solvers/highs_adapter.py`
- 参数校验：`app/semantic/semantic_validator.py`

前端改造不应绕过或复制这些核心逻辑。

## 模板、任务与结果

- 模板注册：`app/templates/power_templates.py`
- 模板服务：`app/services/template_service.py`
- 任务服务：`app/services/job_service.py`
- 结果服务：`app/services/result_service.py`
- 业务解释：`app/explain/result_formatter.py`
- React 页面：`frontend/src/pages/ModelCenter/`、`TaskCenter/`、`ResultCenter/`

## 静态托管与 legacy

- React/legacy 挂载：`app/frontend.py`
- 应用工厂：`app/main.py`、`app/platform_main.py`
- legacy 页面：`prototype.html`、`agent_console.html`
- legacy 模块：`static/js/`

生产构建存在时，FastAPI 在 `/` 提供 React SPA，并在 `/legacy`、`/prototype.html` 提供旧页面。

## Agent

- React 页面：`frontend/src/pages/AgentWorkbench/AgentWorkbenchPage.tsx`
- Orchestrator：`app/agent/orchestrator.py`
- Skill 路由：`app/agent/skill_router.py`
- 参数抽取：`app/agent/parameter_extractor.py`
- 平台 Client：`app/agent/platform_client.py`

当前只完成页面迁移，Agent 后端不属于本次前端工程化重构范围。

## 测试入口

- 前端单元测试：`frontend/src/tests/unit/`
- Playwright：`frontend/src/tests/e2e/`
- FastAPI React 托管：`tests/test_react_frontend_hosting.py`
- 后端测试：`tests/`
- 阶段结果：`docs/frontend-migration-test-log.md`

具体命令见 `docs/iteration-test-entrypoints.md`。
