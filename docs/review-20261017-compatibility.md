# 2026-10-17 评审修复：兼容与运行说明

本轮保持现有模型版本、组件库、Agent V3 和 JSON 持久化架构。完整验收记录见 `reports/review_20261017_execution.md`。

## 数学模型

- 数组参数按每个轴声明的集合顺序解析，数字业务标签也按集合成员处理。新模型应填写参数的 `dimension`；等价的业务键映射仍可使用。旧的无维度参数仅保留有限的位置索引兼容，不能据此推断任意业务轴。
- 内置梯级水电的时间基准为 900 秒，即 15 分钟、0.25 小时。统一派生电量与水量换算。显式秒、分钟、小时冲突时返回带字段的 422，避免静默覆盖。60 分钟资产须统一设置 3600 秒、60 分钟、1 小时。
- 已保存的自定义旧水电资产不会被批量改写。先导出原资产和输入，再创建新版本，统一根级、语义及组件时间元数据，重新测试发布。历史错误结果保留为历史记录，不将其解释为修正后的答案。
- 动态 `piecewise` 使用严格相邻分段等式，会引入整数变量，因此诊断为 MILP。支持 `binary_segment`、`segment_binary` 和 `sos2`；HiGHS 下 SOS2 使用等价分段二进制表示。不支持的方法明确报错。
- HiGHS 当前适配器开放 LP/MILP；QP/MIQP 返回 `SOLVER_UNSUPPORTED_PROBLEM_TYPE`。连续 NLP 路由到可用的 Ipopt，并保留局部最优提示。未开放 MINLP。
- 模板模型的业务 `model_code` 与其 `template_code` 分开保存。克隆生成新业务标识后，仍由原模板构建器执行；通用公式模型和组件模型继续使用各自构建器。

## 函数资产与可追溯性

函数编辑会生成递增 `revision` 和 `content_hash`，原修订保留。可通过 `GET /api/function-assets/{id}/versions` 及 `/versions/{revision}` 查询。

模型测试保存完整函数依赖快照，发布时检查依赖是否漂移；运行只读取模型固定快照，并在任务上下文保留实际依赖。编辑函数不会改变旧模型和固定模型 ID 的 Skill。要采用新曲线，创建新模型版本、重新测试并发布。

旧自定义已发布模型缺少快照时，调用返回 `MODEL_DEPENDENCIES_UNPINNED`，而不是自动采用最新函数。应从已核实的曲线创建新版本并测试发布。只有 ID、没有历史曲线内容时，不能证明或重建当时数学问题。快照损坏返回 `MODEL_DEPENDENCY_CORRUPT`，测试后曲线变化返回 `MODEL_DEPENDENCY_OUTDATED`。

## 任务与前端

- 任务每次执行具有独立 `attempt_id`。取消后立即保持取消状态；当前适配器不保证立即停止底层求解进程，迟到结果会丢弃。删除后不回写结果，重试产生新代次。重启时未完成任务继续按现有规则标记 `INTERRUPTED`。
- `POST /api/tasks` 支持可选 `idempotency_key`。相同键和相同请求返回原任务，相同键但不同请求返回 409。
- 新增 `POST /api/models/{id}/test-jobs` 返回可轮询任务，成功后才保存该修订的测试证据。旧同步测试端点仍兼容。在线调试和模型编辑页使用异步任务，刷新同一浏览器会话可恢复跟踪；请求结果不确定时沿用提交键，避免重复创建任务。
- 草稿离开时提供继续编辑、保存并离开、放弃并离开；保存失败保持原页。异步保存不会覆盖另一个工作区或清除保存期间的新修改。
- 列表区分加载、错误、空数据、旧缓存；错误时显示重试和最近更新时间。图形行数据支持显式 `x_field`、`y_fields`、`group_field`、`unit/units` 和 `x_label`；兼容推断排除时间、索引和 ID，稳定展示多个测量值。

## 访问令牌、重启与密钥迁移

`OPTIMIZATION_PLATFORM_API_TOKEN` 非空时，combined、platform、agent 入口的数据 API 和报告均要求 `Authorization: Bearer ...`。页面外壳和健康探针保持可访问，浏览器收到 401 后提示输入令牌，令牌仅保存在当前会话。Agent 事件流同样发送认证头。未配置令牌时保持既有本地演示行为。

Docker Compose 已传递令牌和 `OPTIFORGE_CONFIG_SECRET`；官方健康检查会携带令牌。内置模型和模板的显式下线状态随数据持久化，重启不会自动重新上线。

LLM 配置密钥使用 Fernet 认证加密。秘密材料按以下顺序获取：

1. 固定的 `OPTIFORGE_CONFIG_SECRET`；
2. `OPTIFORGE_CONFIG_SECRET_FILE` 指定文件内容；
3. 数据目录旁自动生成的私有 `.optiforge-config-secret` 文件（0600）。

迁移或重建时，备份运行数据及原秘密材料；使用自动文件模式时须同时保留 sidecar 文件。更换 Secret 不会自动重新加密旧数据，先恢复原 Secret 解密再迁移。`.env` 和秘密文件已排除在镜像构建上下文之外。

旧 hostname/user/path 派生的 XOR 配置，仅在原环境仍可解密时迁移到新格式。已经丢失原环境且不能解密时，保留原密文，接口返回 `api_key_recovery_error`，设置页提示恢复材料或重新填写 API Key。未宣称能恢复不可逆丢失的信息。

## 模拟验收复跑

在仓库根目录使用已安装依赖的 Python：

```bash
.venv-mac/bin/python -m tests.review_synthetic_poc --output-dir reports/review_20261017_poc
.venv-mac/bin/python -m pytest -q
.venv-mac/bin/python -m pytest -q -m slow
cd frontend
npm run test:unit
npm run build
```

模拟输入位于 `tests/fixtures/review_20261017_poc.json`，所有值为合成假设。独立验收脚本使用临时运行数据目录，不修改现有业务运行态。浏览器验收配置为 `frontend/playwright.review.config.ts`，需使用隔离测试后端 `tests.review_browser_backend`；该后端只对 `review_slow_*` 测试模型注入 35 秒等待，最终调用真实 HiGHS，不应作为正式服务启动命令。
