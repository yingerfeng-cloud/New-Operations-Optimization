# OptiForge 本轮增量修复交付与复测

依据：已完整阅读的《OptiForge 本轮迭代核查与剩余任务》（附件 `OptiForge_Iteration_Verification_46cc8a2_20261021.md`），重点第 6、7、9 节及用户本轮明确要求。原历史 Review 没有全部重做；已生效的逐轴解析、统一时长、严格 PWL、函数选择性更新、草稿恢复、异步测试、V3 审批及测试发布门槛保留。

## 基线与可审查提交

开始时为 `main`，HEAD 与报告基线完全一致：`46cc8a2bd8d2dda6b996f840eebf27ff7162ed91`，没有需要跳过的后续代码提交。工作区原有 `README.md`、`OPERATION_MANUAL.md`、`docs/user-manual.md` 修改及 `.DS_Store` 保留，相关文档、配置和部署运行数据的 hash 在本轮前后相同，未纳入提交。

开发分支：`codex/iteration-dependency-closure`。

| 整理时本地提交 | 对应远端提交（文件树一致） | 范围 |
|---|---|---|
| `ec4264ae6cdb9cd509a45d4f86e3a3763029b914` | `25c9865c18a3edf5c64e1d6eba7f5a6ca6c2bd19` | 第一批：组件固定依赖、选择更新、普通停用与安全撤销、参数维数边界、必跑回归 |
| `cd597f6eae8a87d2624acf5ed5b5d859e4aca60f` | `1fe9c6e4fe4450f8c0d81e72556d3191937e6d63` | 第二批：实际执行环境、重放边界、新旧业务对比、输入/设置一致性、QP/MIQP 声明、依赖审计补丁及复测证据 |

发布状态更新（2026-10-21）：上述批次已发布到远端开发分支，原交付 HEAD 为 `ac4fda070d1b30431051b1365bba7cb9c1c0910c`。通过 GitHub 连接发布时作者/时间元数据使提交编号变化，逐批文件树已核对一致；历史运行记录中的原本地身份不改写。[该 HEAD 的云端 CI](https://github.com/yingerfeng-cloud/New-Operations-Optimization/actions/runs/39543155675) 已完成且五个 job 全部成功。这是上一轮历史云端记录，与下文当时执行的本地测试分开。RV-01/RV-02 后续修复、复测及合并交付见 [复验补修说明](reverification-20261021-delivery.md)。本报告原先“仅本地、云端尚未触发”的陈述已过时；实际部署不由推送或合并自动认定。

可审查差异：

```bash
git diff 46cc8a2bd8d2dda6b996f840eebf27ff7162ed91..1fe9c6e -- app frontend tests scripts .github docs
git show --stat 25c9865
git show --stat 1fe9c6e
```

## 逐项状态、实际行为与代码

| 任务 | 状态 | 实际行为 | 主要文件 / 提交 |
|---|---|---|---|
| R-COMP-01 | 完成本批闭环 | 服务端生成固定组件清单，包含身份/家族/修订/版本/hash、规范化定义、实例配置与参数绑定；完整图与函数清单共同参与内容身份。普通停用不破坏合法旧绑定；客户端快照、缺失/循环/冲突/损坏被拒。 | `app/services/component_dependencies.py`、`component_update_service.py`、`app/api/components.py`、`app/services/model_service.py`、`job_service.py`、`app/builders/component_model_builder.py`；第一批 |
| 组件更新用户旅程 | 完成 | 模型页查看差异、选择修订、更新并测试、应用更新；复用既有版本与异步候选，响应丢失/刷新续接复用同一标识。仅更新所选组件，其他组件、函数修订不变。 | `frontend/src/features/model-center/ComponentUpdatesPanel.tsx`、`frontend/src/api/componentUpdates.ts`、模型中心；第一批及第二批对比接入 |
| 安全撤销与正式服务治理 | 完成 | 两步 API 查看影响范围并用 hash 确认，必须有明确原因；撤销返回 `COMPONENT_REVOKED`。已下线模型的普通服务继续拒绝，历史输入重算不会重新开放正式入口。 | `app/api/components.py`、组件清单验证、组件页撤销原因及状态；两批 |
| R-PARAM-01 | 完成 | 一维数值允许标量坐标数组/业务键映射，拒绝 `[[10],[20]]` 等额外容器；覆盖多维、缺轴、多轴、错误键、非法数值。复合坐标需显式声明，机组清单与拓扑保留合法结构。同步测试、异步测试、运行与 Agent 共用检查。 | `app/parameter_input_contract.py`、水电参数声明、模型测试入口；第一批与第二批入口一致性 |
| R-CI-01 | 完成配置及本地验证 | push/PR 从固定 121 项改为默认后端全量，包含本轮与既有 Review 合同；新增真实 API/HiGHS/浏览器 job 和详细依赖扫描。收费 LLM、长时与平台 Docker 专项独立。 | `.github/workflows/ci.yml`、`scripts/verify_test_matrix.py`、`scripts/audit_frontend_dependencies.mjs`；两批 |
| R-COMP-02 | 完成本批记录与边界 | 每次执行记录实际 Git/source/已加载 code object、编译器、内置实现、包/二进制/适配器和实际选项。无法可信取得的镜像 digest 为 unknown。严格原环境恢复未建设，明确拒绝；当前内核按历史输入计算创建新任务并保留原结果。 | `app/services/execution_environment.py`、`app/jobs/job_runner.py`、任务 API/历史操作/输入面板；第二批 |
| R-UX-01 | 完成 | 函数和组件更新展示声明指标、决策、单位、约束边界/约束值/违反量的原新表格；源输入及设置冻结。不同口径、缺历史证据或未知单位不制造收益结论，应用仍受当前内容与测试 hash 限制。 | `app/services/solution_evidence.py`、`update_comparison.py`、`UpdateComparisonPanel.tsx`、两个更新面板；第二批 |
| 第 7.4 节依赖扫描 | 完成 | 当前锁文件详细扫描确认两个 high 依赖包；只修补 Vite 与 follow-redirects，两种 Node 22 复扫均为零。保存时间、版本、锁 hash、全部 JSON 和影响判断。 | `frontend/package.json`、`package-lock.json`、审计脚本；第二批 |
| QP/MIQP | 声明统一完成；原生能力未开放 | 界面、接口、推荐与文档不再把类型识别当成已接通求解。未增加后端、未四舍五入连续解、未用 PWL 冒充原生能力。连续凸 QP 与 MIQP 的独立后续方案已列出。 | 求解路由/状态/公式与问题诊断、配置/发布/进度页面、`docs/solver-capabilities.md`、`docs/nlp-solver.md`；第二批 |

## 最小充分验收与独立数值依据

1. A、B 同用 C1，仅 A 更新 C2，目标分别为 A 新版 72、B 60；对应每期决策 12 与 10。供给下限、两期负荷和正单位成本直接给出独立下界，并实际满足全部约束，证明这个合成例的最优值。C3 为每期 15、目标 90。
2. C2 在真实异步队列中等待时发布 C3 并普通停用 C2，候选仍使用已经固定的 C2，测试、发布得到 72。没有模拟成功状态或替换求解器。
3. 测试后主动改 C2→C3，旧证据被清除，应用被 `MODEL_NOT_TESTED` 拒绝；重测后为 90。失败候选不切换正式版本。
4. 旧绑定普通停用后执行、真实排队取消后的失败重试及历史输入重算保留原定义；安全撤销由显式原因/影响确认触发，旧绑定返回可识别诊断。
5. 客户端伪造清单、inline 修改、实例/快照损坏、循环、缺依赖、同家族冲突及缺可信历史分别受阻；缺历史不补成今天的资产。
6. 仅更新组件保留未选择的函数 r1，实际目标 24，而不是读取函数库新斜率得到的 96；既有 F/G 选择更新、固定 ID/Skill、正式入口、重试/重放/最新重算合同也在本轮回归。
7. 一维与多维参数的 schema、Agent 共享分析、同步/异步测试及任务提交均检查维数。非法额外轴在实际 API 返回 422，未创建求解任务；合法业务键映射得到独立目标 90。
8. 同输入/设置下实际对比供给决策 10→12 MW、声明电量指标 20→24 MWh、约束下界 10→12、零违反量。无可比结果、单位/定义/设置/输入变化时不给改善差值。函数页面核对固定输入 10 的结果 10→20，而非只检查 SUCCESS。
9. 实际清单的编译器、适配器文件与已加载代码 hash 对照本机真实文件/code object；版本对照安装包，实际选项包括同步测试的 17 秒设置。浏览器显示未知镜像与原环境不可用边界。

上述场景全部是明确合成输入，不是客户数据。期望值由约束下界、代数和业务不变量定义，没有调用被修复的函数生成。

## 本轮新执行的验证

证据目录：`reports/iteration-20261021/`。以下数量有重叠，不能相加。历史 685/482、旧 CI run 与此前 LLM 记录未充作本轮新执行。

| 范围与实际命令 | 结果 | 原始证据 |
|---|---|---|
| 第一批 `.venv-mac/bin/python -m pytest -q` | 696 passed、5 skipped | `batch1-backend-final.log` |
| 第二批完整默认 `.venv-mac/bin/python -m pytest -q` | 709 passed、5 skipped | `final-backend-verified.log` |
| 最后决策坐标显示修正后，指定组件/参数/追溯/对比与既有规则/恢复合同 | 51 passed | `final-acceptance-contracts.log` |
| Node 24.19.0：`npm ci`、`npm run build`、`npm run test:unit` | 构建通过，88 files / 485 passed | `batch2-npm-ci.log`、`batch2-build.log`、`batch2-frontend-full.log` |
| Node 22.17.0 Linux arm64 容器，独立源码副本：同样 ci/build/test:unit | 485 passed | `node22-receipt.json`、`node22-unit.log`、`source-hashes.json` |
| 最终 `npm run typecheck` 及相关 5 个页面单元文件 | 类型通过，25 passed | `final-typecheck.log`、`final-frontend-targeted.log` |
| `OPTIFORGE_REVIEW_URL=http://127.0.0.1:5181 npx playwright test -c playwright.cloud-review.config.ts cloud_review_iteration.spec.ts` | 2 passed，真实 HTTP / HiGHS / 浏览器 | `final-browser-verified.log`、`live-acceptance.json` |
| Node 22.23.2、22.17.0：`npm audit --json --package-lock-only`；本机新审计脚本 | 修补后均为 0 | `audit-after*.json`、`audit-ci-node22*.json`、`audit-local-node24/` |
| `.venv-mac/bin/python scripts/verify_test_matrix.py` | 通过，检查全量回归、必需合同与 live/browser/审计配置 | `final-test-matrix.log` |

ASGI API 与实际 HiGHS 回归是真实应用调用，不是联网公网部署；浏览器连接实际 uvicorn/Vite，没有 mock 求解。纯比较逻辑及页面单元含针对缺证据、单位冲突、过期 hash 的替身测试，与真实求解和浏览器证据分开。7 条最终 HTTP 任务的实际环境均匹配最终应用源码 hash：`b3a5dba6b18b1afa8d6fe373e5b88823da6529255296296afef5f125b9c2b6a3`。

`manifest.json` 给出附件 hash、源代码身份、命令范围、扫描锁 hash 及证据文件 SHA-256。测试执行时 HEAD 与 dirty 状态如实记录；没有用未来提交号回填旧任务。

初次失败和警告原样保留，详见两份批次说明。同步入口统一校验后，旧生命周期用例缺业务必填值；现显式提供已有合成输入，保留全部断言并增加 3800 独立答案。曾有一轮浏览器断言早于真实异步任务完成，该任务 17 秒后实际成功；现在先等待终态，再检查独立结果、约束和页面，原 UI 断言及总测试预算不变。构建 chunk 提示、框架警告、5 个 skipped 未隐藏，也未计为通过。

## 兼容、迁移与运行边界

- 组件清单由服务端生成。客户端读取快照不获得写入或伪造历史的资格；旧版本的 hash 校验不能替代合法来源。
- 新字段为空时保留旧内容身份。旧非组件模型继续原路径；旧发布组件模型/历史任务缺可信清单时保留结果并明确不可重放。需要从可核实备份恢复，或明确创建当前版本、选择合法依赖、重新测试发布；不把当前目录追认成历史。回退旧程序前应保留独立备份，避免旧序列化器丢失新增字段。
- 普通停用限制新增选用；合法旧绑定仍须遵守模型下线与安全撤销。新模型无继承关系时不能凭客户端 inline 引用已停用组件。安全撤销 API 需要影响确认和原因，旧结果保留。
- 发布复用同一完整清单的测试证据，库更新不使旧绑定自动失效；主动改变有效依赖必须重测。单位/维度/参数接口/能力变化需完整模型编辑和兼容测试。
- 固定 JSON 不保存旧 Python/求解器。运行清单记录实际实现；本批未建设多版本环境恢复平台，因此严格原环境重放明确不可用。当前内核重新计算创建新任务，旧结果、来源和每次实际环境保留。
- 旧业务结果没有完整证据时只显示不可比。同步与异步测试使用相同输入门槛，显式记录实际设置，不能使用旧成功状态绕过新内容检查。
- Vite 与 follow-redirects 只做补丁更新。详细公告、静态可达性证据、时间和锁文件 hash 在 `docs/iteration-20261021-dependency-impact.md`，没有将扫描摘要称为生产漏洞利用证明。

## 本地证据与未验证范围

两张最终截图及之前失败 trace 保存在 `reports/review_20261020_local/iteration/`，未进入 Git。临时合成运行态在 `/tmp/optiforge-iteration-20261021-final/`，历史调试运行态另行保留；本轮 API/Vite 已停止，18033/5181 端口已关闭。用户原有部署实例与数据未操作。

本轮没有新执行：外部收费 LLM、客户真实数据验收、完整平台 Docker 镜像交付、原环境恢复、一般容量/长期稳定性或目标性能、生产部署、Windows 产品运行认证。Node 容器测试不等于完整平台 Docker 验收；静态检查不等于攻击验证。本轮没有新增原生 QP/MIQP，后续方案仅列明范围和独立验收，不能标为已经实现。

进一步资料：[第一批说明](iteration-20261021-batch1.md)、[第二批说明](iteration-20261021-batch2.md)、[依赖扫描与影响](iteration-20261021-dependency-impact.md)、[求解能力矩阵及后续方案](solver-capabilities.md)。
