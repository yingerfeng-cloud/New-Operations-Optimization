# RV-01 / RV-02 补修与连续流程复验

依据：完整读取《OptiForge_Reverification_ac4fda0_20261021.md》，执行第 5、6、8 节。此次只修两个具体遗漏，保留上一轮已经验收的组件固定依赖、参数逐轴解析、统一时长、严格 PWL、选择性函数更新、草稿恢复、异步测试、V3 和测试发布门槛。

## 版本与交付状态

- 开始分支：`codex/iteration-dependency-closure`；实际 HEAD 与报告相同：`ac4fda070d1b30431051b1365bba7cb9c1c0910c`。重新 fetch 后开发分支无后续变更，main 为 `46cc8a2bd8d2dda6b996f840eebf27ff7162ed91`。
- 修复与连续回归提交：`c242bedc73f293368067e2c8cce14b5964dcdc75`。本报告所在的后续提交只补充文字交付与证据，不改变被测应用源码。
- 整理本报告时，本地复验已完成；本批新的云端 CI、PR 与 main 合并随后执行，最终状态以该 PR 的检查、合并记录及交付消息为准。本文件不预先把尚未发生的云端运行记为成功。合并要求本地复验与新 HEAD 的云端检查通过，RV-01 是阻断项。
- 原交付 `ac4fda0` 已推送且 [历史 CI 39543155675](https://github.com/yingerfeng-cloud/New-Operations-Optimization/actions/runs/39543155675) 五项成功，本次重新查询核实。这是历史记录，未与本批测试累加。原交付文档已补充实际远端提交映射与状态。
- 保留用户原有三份手册修改、未跟踪手册/图片、配置与部署数据。28 个受保护文件的逐文件 hash 在本轮前后相同；原始 hash 清单仅在本地，不公开配置或运行数据。截图与 trace 均留本地，未进入 Git。

## 修复结果

| 事项 | 状态与实际行为 | 涉及文件（均属 c242bed） |
|---|---|---|
| RV-01，合并阻断 | 完成。组件更新发布 v0.2 后，普通新版本 v0.3 清除旧函数/组件更新操作上下文。保存时采用服务端当前候选的权威上下文，草稿/语义/高级编辑镜像不能带回旧标记，也不能删除真实候选的冲突检查。源版本的审计信息保留。 | `app/services/model_version_service.py`、`model_service.py`；`frontend/src/features/model-creation/utils/workspaceMode.ts` |
| RV-02，撤销恢复 | 完成。可信历史清单的完整性读取与执行许可分开。允许查看撤销原因、差异和合法替代修订；替换后对最终有效完整清单重新执行撤销、依赖图、版本、来源、接口及内容检查，合格后才测试/发布。 | `app/services/component_dependencies.py`、`component_update_service.py`；`frontend/src/api/componentUpdates.ts`、`features/model-center/ComponentUpdatesPanel.tsx` |
| 连续回归与必跑 | 完成。新增 7 个 API 合同用例；把“组件更新→应用→普通版本保存/刷新→再次测试发布”串入现有真实浏览器用例，另增“撤销→查看→替换→测试→刷新→应用”。默认全量 pytest 和现有真实浏览器 job 自动执行；交付自检进一步锁定这些用例及入口。 | `tests/test_reverification_component_lifecycle.py`；`frontend/src/tests/e2e/cloud_review_iteration.spec.ts`、`unit/ModelWorkspaceMode.test.ts`；`scripts/verify_test_matrix.py` |

没有删除正式版本冲突判断。真实的另一个版本抢先发布时，旧候选的普通 publish 和 component-updates/apply 都仍返回 `FORMAL_VERSION_CHANGED`；编辑器移除或改写候选控制标记也不能绕过。

没有删除安全撤销执行门禁。旧模型的新任务及历史 current-kernel 重算仍返回 `COMPONENT_REVOKED`。未清除的直接/间接撤销依赖继续拒绝；替换上游但未修正下游依赖关系返回 `COMPONENT_DEPENDENCY_MISSING`。损坏的历史清单无法用于查看或替换，客户端自带清单仍被拒绝。普通停用兼容、其他模型继续使用原绑定以及后续 C3 不改变选定 C2 的既有回归均保留。

撤销后的比较只读取已经保存的旧测试证据，不执行旧组件来补基准。缺少旧证据的遗留夹具显示“无可比旧结果”，仍可安全测试并发布替代修订，不制造改善结论。撤销原因、时间、影响模型与任务记录保留。

## 独立验收定义与本批实际执行

全部业务输入明确为合成数据。两时段需求 `[10,10]`，最小化 `3*x[0]+3*x[1]`；C1 的独立下限为每时段 10 MW，所以最优值为 60；C2 下限为 12 MW，所以最优值为 72。正目标系数、逐点下限与达到下限的解共同证明最优；另核对实际决策和约束残差。函数既有旅程固定输入 10，两条已知直线分别给出 10、20。预期值不调用平台计算函数产生。

| 证据类别 | 本批命令与结果 | 证据路径（仓库根目录起） |
|---|---|---|
| 修复前真实 API/HiGHS 复现 | `python -m pytest -q tests/test_reverification_component_lifecycle.py`，初始两个用例按预期失败：发布误报 FORMAL_VERSION_CHANGED，依赖查看误报 COMPONENT_REVOKED。 | `reports/reverification-20261021/before-fix-api.log` |
| 最终新合同 | 同一文件最终 7 passed；默认全量随后再次包含这 7 项，不累加用例数。ASGI TestClient 调用真实产品 API 和 HiGHS。遗留草稿、缺证据、损坏历史属于明确的存储数据夹具，没有替身求解器。 | `final-new-api-contracts.log` |
| 相关现有 API 回归 | 初验三个组件/追溯测试文件 25 passed；当时新增用例仍为 6 项。此为中间检查，不加到最终全量数字上。 | `focused-api.log` |
| 后端默认全量 | `.venv-mac/bin/python -m pytest -q`，最终 **716 passed / 5 skipped**，133.65s。包含各类现有单测/替身/实际求解，不能把 716 项统称为完整用户旅程。5 项跳过未算通过。 | `backend-full-verified.log` |
| 前端全量 | `npm run test:unit -- --run src/tests/unit/ModelWorkspaceMode.test.ts src/tests/unit/IterationComponentUpdates.test.tsx src/tests/unit/IterationComparison.test.tsx`。脚本本身指定整个 `src/tests/unit`，实际运行 **88 个文件 / 487 passed**，177.75s。 | `frontend-targeted.log`（名称为初验时所取，内容是全量） |
| 类型与构建 | `npm run typecheck`、`npm run build`，均通过。保留 Vite 大 chunk 提示；初始新增测试的 TS 属性访问错误已修正，初始日志仍保留。 | `typecheck-final.log`、`build.log`；初始 `typecheck.log` |
| 真 HTTP/API/Chrome/HiGHS | `OPTIFORGE_REVIEW_URL=http://127.0.0.1:5191 PW_CHANNEL=chrome ./node_modules/.bin/playwright test -c playwright.cloud-review.config.ts cloud_review_iteration.spec.ts --output ../reports/review_20261020_local/reverification/browser-final`，最终 **3 passed**，含 RV-01、RV-02 及原函数更新旅程。首轮亦 3 passed，不重复累计。 | `browser-final.log`；首轮 `browser-initial.log` |
| 实际求解与源码身份 | 最终浏览器产生 10 个任务，通过真实 HTTP GET 读取任务及结果。独立目标序列 `[60,60,72,72,60,72,60,72,10,20]` 全部一致；实际物理量一致，最大约束残差均为 0。10 个任务属于上述 3 条旅程，不是另外 10 个验收用例。 | `live-api-proof.json`、`source-identity.json` |
| 持续检查静态自检 | `python3 scripts/verify_test_matrix.py` → TEST_MATRIX_OK，124 个后端测试文件；保留默认 pytest 与真实浏览器 job 的强制入口。此为静态检查，不代替执行结果。 | `test-matrix.log` |

本表未写完整目录的日志名均位于 `reports/reverification-20261021/`。初始后端全量在受限沙箱中有 2 项端口绑定被操作系统拒绝，另 714 passed / 5 skipped；未改变断言，改用允许本地 socket 的执行环境原样全量重跑，得到最终 716 / 5。初始失败记录在 `backend-full.log`，不隐藏失败或把初始运行称为通过。

最终应用源码 SHA-256 为 `53aad01eab8814297aa6d0d0402d13b3ab02a39d105d4f9f4b5b5b7a0b5bf743`。逐个 Python 文件另与 `c242bed` 的 Git blob 校验一致；10 个实际任务均记录该源码 hash 及提交身份。源码与执行包、求解器/适配器、加载代码 hash 均记录在真实环境清单中。保留用户的 `app/.DS_Store` 会令通用脏状态观察值为 true，未伪造工作区全净状态。

## 兼容与迁移

无新数据库或第二套资产系统，无破坏性批量迁移。新版本清理操作控制标记，组件、函数的确定修订、hash、定义和依赖按原机制继承；发布继续要求当前内容与同一份测试清单一致。

对修复前已保存的普通草稿，只在直接父版本已发布、其保留审计与该草稿的旧上下文完全相同、且旧 source_model_id 不是直接父版本时，才在明确保存时清除可证明的错误继承。不能证明来源时不猜测、不批量删除未知控制信息；可基于当前正式版本新建并测试。真正的更新候选始终保留属于自己的新上下文和冲突门禁。改变有效内容后仍需重新测试，不能使用恢复页面状态或旧 SUCCESS 绕过门槛。

可信清单读取只用于服务端既有修复流程。撤销组件的冻结定义可以读，但执行仍由最终 `validate_manifest` 判断；替换目标仍需组件目录合法授权，未选依赖不擅自追随 latest。旧快照缺失或损坏时不会用当前资产伪造历史。模型下线与正式入口治理保持原状。

## 本地证据与未扩展范围

最终运行态：`/tmp/optiforge-rv-20261021-final/`，隔离 API/Vite 为 18043/5191，复验后已按启动身份关闭。初验独立运行态另存于 `/tmp/optiforge-rv-20261021/`；不改用户部署数据。关闭记录见 `stop-isolated-stack.log`。

本地截图和 trace：`reports/review_20261020_local/reverification/`；最终 RV-01、RV-02 发布页均已实际查看。该目录被 Git 忽略，截图不公开上传。公开交付只有代码与合成文字证据；原附件、手册图片、配置、API Key、用户运行库均不上传。

本批没有执行外部收费 LLM、客户数据、生产部署、严格原环境恢复、一般容量/SLA 或原生 QP/MIQP 开发。锁文件未改变；旧扫描为历史证据，新 HEAD 的 push/PR CI 仍按现有 Node 22.17.0 门槛运行 audit。构建不等于对外部署，合并不等于生产环境已经升级。
