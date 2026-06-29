# 前端迁移测试体系收口

本文档记录阶段十一后的测试体系边界。历史阶段结果仍以 `docs/frontend-migration-test-log.md` 为准；本文件只维护迁移收口矩阵与当前可执行 gate。

## 前端脚本

```powershell
cd frontend
npm run typecheck
npm run test:unit
npm run test:phase
npm run build
npm run test:e2e
```

- `typecheck`：只运行 TypeScript 项目检查，适合在 Vite/Vitest 受沙箱限制时先做静态验证。
- `test:unit`：运行 `src/tests/unit` 下全部 Vitest/RTL 单测。
- `test:phase`：运行 React 迁移阶段核心页面与闭环测试。
- `build`：执行 `tsc -b && vite build`。
- `test:e2e`：运行 Playwright 场景，固定使用 5178，避免复用 5173 的本地开发服务。

## 测试矩阵

`python scripts/verify_test_matrix.py` 检查以下入口是否齐全：

- 前端单测：Dashboard、模型创建五步、公式编辑器、generic_spec 编译、模型资产中心、组件库、任务中心、结果中心、Agent 工作台。
- 前端 E2E：模板创建、通用线性 Builder、组件化 Builder、组件生命周期、光储任务中心、梯级水电结果中心。
- 后端 pytest：公式后端、模型创建校验、统一草稿、组件库、组件 Builder、React 托管、Agent、模板/组件/求解验收。
- 文档与脚本：`frontend/package.json` 的测试脚本和 `docs/iteration-test-entrypoints.md` 的收口入口。

## 阶段 9-11 收口记录

- 阶段 9：新增 `TaskCenterPage.test.tsx` 与 `ResultCenterPage.test.tsx`，覆盖任务创建、轮询、取消、重试、日志、结果详情、报告指标、图表 mock、变量和 JSON 结果。此前全量 Vitest：20 files / 52 tests passed。
- 阶段 10：新增 `AgentWorkbenchPage.test.tsx`，覆盖 Agent 状态、Skill、会话、分析请求、默认值确认和确认调用。`node node_modules/typescript/bin/tsc -b` 通过。
- 阶段 11：新增 `typecheck`、`test:unit`、`test:phase` 和 `scripts/verify_test_matrix.py`，把迁移阶段测试入口固化。

## 当前环境限制

本次 Codex 沙箱拒绝提权后，Vite/Vitest 在 esbuild 子进程启动阶段报 `spawn EPERM`。因此阶段十一优先使用：

```powershell
python scripts/verify_test_matrix.py
cd frontend
npm run typecheck
```

在本地非沙箱环境或已获执行权限的 CI 中，应继续运行完整 gate：`npm run test:phase`、`npm run build`、`npm run test:e2e`、`python -m pytest -q`。
