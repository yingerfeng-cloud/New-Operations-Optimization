# 前端迁移阶段测试记录

## 阶段 0：后端基线（2026-06-22）

- 命令：`python -m pytest tests/test_frontend_e2e_flow.py tests/test_component_builder_e2e.py tests/test_pv_storage_v2_acceptance.py tests/test_component_based_hydro_model.py -q`
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

## 阶段 3：模型创建与公式链路（2026-06-22）

- `npm run build`：成功。
- `npm run test`：11 files / 15 tests passed。
- 后端相关回归：28 passed（公式编译、创建校验、统一 ModelDraft）。
- 覆盖：五步创建流程、Zustand 草稿持久化、time/time_volume 规范化、结构化 TokenCanvas、AggregateToken、DSL/display/tokens 同步、引用与自由索引识别、线性校验、最小 LP generic_spec 编译、发布/测试阻断。
- 明确阻断：`!=`、变量乘除变量，以及未线性化的 abs/max/min/piecewise 不会伪装成可发布线性模型。

## 阶段 4：托管与最终验收（2026-06-22）

- `npm run build`：成功。
- `npm run test`：11 files / 15 tests passed。
- `npm run test:e2e`：6 passed（使用隔离端口 5178，避免本机已占用 5173 的其他应用污染结果）。
- FastAPI React/SPA 托管测试：2 passed；legacy 路径已改为 404。
- 后端验收回归：29 passed；覆盖 12 个内置模板的 clone/publish/test 路径、24 个组件 validate、通用线性最小 LP、光储 V2 与梯级水电。
- 实际浏览器生产验收：`http://127.0.0.1:8000/models` 显示“API 已连接”并加载真实模型数据；legacy prototype 入口已下线。
- 已知非阻断项：Vite 对 Ant Design/ECharts vendor chunk 给出大于 500 kB 的性能提示；不影响构建与运行，后续可进一步拆 vendor chunk。
