# 前端迁移阶段测试记录

## 阶段 0：后端基线（2026-06-22）

- 命令：`python -m pytest tests/test_frontend_e2e_flow.py tests/test_component_builder_e2e.py tests/test_unified_formula_editor_acceptance.py tests/test_pv_storage_v2_acceptance.py tests/test_component_based_hydro_model.py -q`
- 结果：36 passed，2 个既有 Pydantic protected namespace warning。
- 结论：模板/模型、组件 Builder、公式编辑器后端约束、光储 V2、组件化水电基线正常。

## 阶段 1：前端工程基础（2026-06-22）

- `npm install`：成功，安装 264 个包；npm audit 报告 1 个 low severity。
- `npm run build`：成功，Vite 产出 `frontend/dist`；存在首包约 1 MB 的性能提示，后续阶段用路由懒加载拆包。
- `npm run test`：1 file / 1 test passed。
- 覆盖：Vite + React + TypeScript、Router、TanStack Query、Ant Design、Axios、Zustand 依赖，主布局、API 健康状态、Dashboard 真实查询与统一错误提示。

## 阶段 2：业务中心迁移（2026-06-22）

- `npm run build`：成功；路由页面已拆为独立 chunk。ECharts 报告 chunk 仍有体积提示，不影响功能。
- `npm run test`：4 files / 4 tests passed。
- 覆盖：模型列表/详情/发布/测试/复制/模板克隆；组件列表/详情/编辑/参数绑定/依赖阻断/校验/发布/复制/停用；任务创建/轮询/取消/日志/结果；报告指标/图表/JSON；Agent 基础工作台。
