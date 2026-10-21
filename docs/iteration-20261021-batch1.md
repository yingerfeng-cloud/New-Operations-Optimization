# 2026-10-21 增量第一批：组件固定依赖、参数维数与持续检查

基线为 `46cc8a2bd8d2dda6b996f840eebf27ff7162ed91`，开发分支 `codex/iteration-dependency-closure`。完整阅读附件《OptiForge 本轮迭代核查与剩余任务》，按照第 6、7、9 节实施；附件中的源码观测不冒充 HTTP/真实求解复现。

## 行为变化

- R-COMP-01：模型具体版本和任务保存服务端生成的组件清单，包括规范化定义、家族/修订/版本/hash、每个实例的配置及参数绑定。依赖图必须完整、无环、无冲突，函数仍使用原有确定修订清单。运行读取固定清单，不从目录更新公式；普通停用不破坏合法旧绑定。
- 已发布组件继续不可原位修改，复制版本保留家族并生成新修订。模型页增加“组件更新与修订”：查看差异、选择具体修订、更新并测试、应用更新，复用已有模型版本、异步任务、幂等提交及测试发布门槛。未选择的组件和函数保持不变。
- `/api/components/{id}/revocation-impact` 返回模型/任务影响范围及 hash；`/revoke` 要求明确原因和匹配的影响确认。安全撤销与普通停用分开，返回 `COMPONENT_REVOKED`，模型下线与正式服务治理照常生效。
- 客户端不能写入组件清单；inline definition 必须与可信组件定义匹配。已保存清单的 hash/实例/图被破坏时明确拒绝。没有可信旧组件内容，不从今天的目录补历史。
- R-PARAM-01：有轴的标量数值参数在轴数到达后拒绝额外容器，保留逐轴顺序和业务键规则。显式 `coordinate_type=array/dict` 可声明复合坐标；无轴曲线保持原有格式。水电机组清单与拓扑参数补显式复合声明。
- R-CI-01：push/PR 后端从固定 121 项改为完整默认回归；新增真实 API/HiGHS/浏览器 job。外部收费 LLM、Docker、标记 slow 的专项继续独立执行，未运行不计通过。

## 本轮实际执行

全部使用临时运行态与合成模型，未修改部署数据。ASGI 接口测试调用真实路由与 HiGHS；浏览器连接独立 uvicorn/Vite 服务，没有 mock 求解。合成供给约束 `output[t] >= factor*demand[t]`，两期 demand=10、正成本 3，因此 factor=1/1.2/1.5 的独立下界及可行解分别证明目标为 60/72/90。另检验组件更新仍继承未选择的函数 r1，目标 24；不因函数库 r2 的斜率改变而变成 96。

| 命令/范围 | 实际结果 | 证据 |
|---|---|---|
| `.venv-mac/bin/python -m pytest -q` | 696 passed，5 skipped | `reports/iteration-20261021/batch1-backend-final.log` |
| 第一批参数/组件、既有 Review/恢复/数学合同 | 32 passed | `batch1-focused.log` |
| `npx vitest run ...IterationComponentUpdates.test.tsx ...ReviewFunctionUpdates.test.tsx` | 4 passed | `batch1-frontend-targeted.log` |
| `npm run build`（含 TypeScript） | 通过；保留既有 chunk 大小提示 | `batch1-build.log` |
| `OPTIFORGE_REVIEW_URL=http://127.0.0.1:5181 npx playwright test -c playwright.cloud-review.config.ts cloud_review_iteration.spec.ts` | 1 passed；响应真正送达后端后丢弃，刷新使用同一标识恢复，服务端仅一个候选 | `batch1-browser.log` |

初次回归失败记录保留在同目录：数值维数边界新增后暴露合法复合结构，需要显式声明；函数用例的旧公式别名使预期目标不一致，已同步有效表达式并增加基线目标断言。两项已有端口测试在沙箱内报 `Operation not permitted`，在允许绑定临时端口的运行环境完整重跑通过，没有删除或跳过断言。

## 兼容与迁移

新增字段为空时不改变旧资产的内容 hash。未包含组件的旧模型继续使用原有路径。旧发布组件模型/任务没有服务端可信清单时返回 `COMPONENT_HISTORY_UNPINNED` / `TASK_HISTORY_UNREPLAYABLE`，原结果保留；明确创建当前版本并测试，或从可核实备份恢复，不能静默追认客户端快照。复制已固定版本可继承旧依赖，包括已普通停用组件；无继承关系的新绑定仍受目录发布状态约束。

用户原有 README、操作手册、用户手册、配置、部署运行数据和 `.DS_Store` 均保留。截图/浏览器跟踪仅在本地。第一批没有新增 QP/MIQP 求解器，没有推送、合并或部署。R-COMP-02 的环境记录及 R-UX-01 的业务对比在第二批完成；仅有固定定义不代表旧 Python 实现已被恢复。
