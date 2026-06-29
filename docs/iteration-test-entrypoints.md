# 迭代测试入口

开发过程中优先运行与改动对应的分组，交付前运行完整前端 gate 和相关后端回归。

## 前端基础 Gate

```powershell
cd frontend
npm run build
npm run test
```

`npm run test` 只运行 `src/tests/unit/`，Playwright E2E 与 Vitest 已隔离。

## 前端 E2E

```powershell
cd frontend
npm run test:e2e
```

Playwright 使用隔离端口 5178，避免与日常 Vite 端口 5173 或本机其他项目冲突。当前场景：

- 模板选择与五步创建
- 组件创建/校验/发布入口
- 通用线性 Builder
- 组件化 Builder
- 光储任务中心
- 梯级水电结果中心

## 公式编辑器与模型创建

```powershell
cd frontend
npx vitest run `
  src/tests/unit/formulaDsl.test.ts `
  src/tests/unit/formulaParser.test.ts `
  src/tests/unit/formulaValidator.test.ts `
  src/tests/unit/compileFormulaToGenericSpec.test.ts `
  src/tests/unit/modelCreationStore.test.ts `
  src/tests/unit/FormulaEditor.test.tsx `
  src/tests/unit/ModelCreationPage.test.tsx
```

对应后端回归：

```powershell
python -m pytest `
  tests/test_formula_backend_taskbook_iteration.py `
  tests/test_model_creation_validation.py `
  tests/test_unified_model_draft.py -q
```

## 模型中心与组件库页面

```powershell
cd frontend
npx vitest run `
  src/tests/unit/ModelCenterPage.test.tsx `
  src/tests/unit/ComponentLibraryPage.test.tsx `
  src/tests/unit/componentDependencyPanel.test.tsx
```

后端组件回归：

```powershell
python -m pytest tests/test_component_library_production.py tests/test_component_builder_e2e.py -q
```

## FastAPI 静态托管

先生成 `frontend/dist`，再运行托管测试：

```powershell
cd frontend
npm run build
cd ..
python -m pytest tests/test_react_frontend_hosting.py -q
```

## 模板、组件与求解验收

```powershell
python -m pytest `
  tests/test_20260605_acceptance_round.py `
  tests/test_model_creation_acceptance_fixes.py::test_cascade_hydro_clone_publish_invoke_sample_success `
  tests/test_pv_storage_v2_acceptance.py `
  tests/test_component_based_hydro_model.py -q
```

该组覆盖 12 个模板的 clone/publish/test 路径、24 个组件 validate、通用 LP、光储 V2 与梯级水电。

## Legacy 前端

只在修改 `prototype.html` 或 `static/js/` 时运行：

```powershell
python -m pytest `
  tests/test_component_builder_frontend_static.py `
  tests/test_unified_formula_editor_acceptance.py -q
```

## Agent

```powershell
python -m pytest tests/test_agent_production_fixes.py tests/test_agent_decoupling_fixes.py -q
```

## 完整交付 Gate

```powershell
cd frontend
npm run build
npm run test
npm run test:e2e
cd ..
python -m pytest -q
git diff --check
```

## React 迁移阶段收口 Gate

阶段十一后，前端迁移相关变更至少按以下顺序自检：

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

`test:phase` 聚合 React 迁移阶段的核心页面测试：`DashboardPage.test.tsx`、`ModelCreationPage.test.tsx`、`Step2SemanticModel.test.tsx`、`Step3MathExpansion.test.tsx`、`Step4RuntimeParams.test.tsx`、`Step5ReviewPublish.test.tsx`、`ModelCenterPage.test.tsx`、`ComponentLibraryPage.test.tsx`、`TaskCenterPage.test.tsx`、`ResultCenterPage.test.tsx`、`AgentWorkbenchPage.test.tsx`。

`python scripts/verify_test_matrix.py` 不替代 Vitest、Playwright 或 pytest；它只检查测试文件、前端脚本和本文档入口是否齐全，适合在 Vite/Vitest 因本机沙箱或 esbuild 子进程权限失败时先做静态收口检查。阶段十一的收口说明见 `docs/frontend-migration-test-closure.md`。

阶段基线与实际通过数量以 `docs/frontend-migration-test-log.md` 为准，不在本文硬编码全量 pytest 数量。
