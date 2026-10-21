# OptiForge R4 遗留项修复与复验

日期：2026-10-21，Asia/Shanghai。代码以 `4d81a3f952af97536918886fd9dc2dfe589e38a5` 为基线，叠加R3及本轮修复，保留在当前工作区。准确文件见 [R4源码指纹](../reports/manual-repair-20261021-followup/source-manifest.json)。[R3报告](manual-repair-acceptance-2026-10-21.md)中的首次失败和当时的测试数字保留，不覆盖为通过。

本轮列出的遗留缺陷均已处理，原3项基线失败已清零。结果诊断、Skill约束证据和水电错误恢复已由未参与修复的独立测试代理通过正常界面复验；版本治理的动态切换由真实工程调用验证，界面另核对已有正式 / 历史版本及既有固定绑定信息。

## 本轮处理

| 遗留项 | 原因 | 修复与验证 |
| --- | --- | --- |
| 两项水电参数错误提示测试失败 | 通用输入契约校验提前返回，未使用模型声明的水电中文前缀及机组称谓 | 在原结构化字段、期望与实际值基础上使用声明的业务词汇。例：`梯级水电模型参数错误：机组 S1_U2 的 availability 长度为 3，但 horizon 为 4。` 两个原测试均通过，未放宽错误输入检查 |
| 新版发布后Skill / Agent切换用例提前阻断 | 用例把模型配置当作运行数据，缺少负荷、燃料成本、最大出力 | 明确提交三个运行输入，再测试和发布两版；移除该用例的模拟调用，分别由Skill与Agent平台网关真实求解，断言解析到新模型ID、成功任务及目标3800。旧模型下线及按旧ID查询断言保留；固定绑定规则不改写 |
| 任务概览终止状态 / 约束摘要为“-” | 后端TaskView未传递结果中已有的求解诊断，HiGHS约束残差没有标准摘要 | TaskView输出真实终止条件、问题类型、求解器可用性和约束摘要。根据实际求解模型的solution_evidence生成检查条数、违反条数、最大违反量、变量边界违反及容差 |
| Skill解释层提示缺少明细 | 原始solution_evidence有约束值和边界，解释分析器没有读取 | 任务、API、Skill、Agent共用数值诊断；保留每条约束原始来源、实际值、下 / 上界、余量、违反量及触边 / 满足 / 违反状态；解释证据引用同一份结果 |
| 结果报告无法逐条核对 | 页签仅读取旧业务检查字段 | 标准constraint_checks也能生成“约束检查”页签，表格展示实际值、上下界、余量、违反量和结果 |
| 独立复验新增：前端水电矩阵长度提示未定位机组行 | 本地时间维检查只采样第一行，提示没有行坐标；非首行错误可能被漏过 | 遍历所有时间切片，返回首个错误的实际业务坐标；映射与数组矩阵均支持，数组采用声明的成员顺序，状态时点检查horizon+1。原截图20保留，修复后同输入独立复验另记 |

数值诊断只读取本次求解留下的测量记录。无明细时仍保留缺少证据的提示；部分条目缺数值时记录未完成检查，不生成虚假的“全部通过”。历史记录若包含原始数值，可以在读取时展示对应诊断；不会重算或改写历史求解结果。

前端矩阵行定位见 [时间维检查](../frontend/src/features/time-dimension/index.ts)及 [非首行 / 恢复回归](../frontend/src/tests/unit/TaskCreateContracts.test.ts)。独立代理首次错误提示仍保留在 [截图20](manual-assets/2026-10-21-followup/independent/20-hydro-missing-period-error.jpg)，该阶段不能记为行定位已经通过；修复后由代理用同一输入重新验收，具体行定位和恢复均已通过，见截图23～25。

主要修改：[输入校验](../app/semantic/semantic_validator.py)、[版本切换回归](../tests/test_runtime_persistence_and_active_versions.py)、[统一结果诊断](../app/services/result_diagnostics.py)、[任务接口](../app/schemas/solve.py)、[解释证据](../app/explainers/evidence_builder.py)、[约束分析](../app/explainers/constraint_analyzer.py)、[结果处理](../app/services/result_post_processor.py)、[报告契约](../app/services/result_presentation.py)、[任务概览](../frontend/src/features/task-center/TaskPanels.tsx)、[报告表格](../frontend/src/features/result-center/ResultPanels.tsx)。

## 工程回归

| 检查 | 本轮结果 | 日志 |
| --- | --- | --- |
| 原3项失败 + 新诊断专项 | 7项通过 | [专项](../reports/manual-repair-20261021-followup/focused-backend.log) |
| 后端默认全量 | 725通过，5跳过，0失败 | [全量](../reports/manual-repair-20261021-followup/backend-full.log) |
| 组件水电 / 组件端到端 / 持久化版本 / 模型Skill四组集成 | 42通过，0失败，含原3项失败 | [集成](../reports/manual-repair-20261021-followup/backend-integration.log) |
| 市场交易模板扩展集成 | 14通过，0失败 | [模板](../reports/manual-repair-20261021-followup/market-templates-integration.log) |
| 光储V2组件执行校验 | 1通过，0失败；以上扩展集成合计57通过 | [光储组件](../reports/manual-repair-20261021-followup/pv-storage-components-integration.log) |
| 前端相关界面专项 | 3文件、12项通过 | [专项](../reports/manual-repair-20261021-followup/focused-frontend.log) |
| 前端默认全量 | 行定位修复后90文件、502项全部通过 | [最终全量](../reports/manual-repair-20261021-followup/frontend-full-complete.log) |
| 矩阵行定位、导入和时间契约专项 | 47项全部通过，覆盖非首行映射 / 数组、恢复及三维状态序列 | [行定位](../reports/manual-repair-20261021-followup/time-axis-row-fix.log) |
| 前端类型检查 / 生产构建 | 均通过；行定位修复后重建通过，保留已有分包体积提示 | [类型](../reports/manual-repair-20261021-followup/typecheck.log)、[最终构建](../reports/manual-repair-20261021-followup/frontend-build-final.log) |

前端首轮全量为498通过、1项异步编译断言超时，见 [首轮日志](../reports/manual-repair-20261021-followup/frontend-full.log)。该公式编辑文件单独复测18项通过。对相关回归补充等待完整异步编译提交，保留索引保存字段断言；不放宽或删除功能断言。

归档核对：[工程结果汇总](../reports/manual-repair-20261021-followup/engineering-verification.json)、[截图及界面JSON指纹](manual-assets/2026-10-21-followup/verification.json)、[手册链接与示例检查](../reports/manual-repair-20261021-followup/documentation-checks.json)。47个源码及测试文件与最终回归时的指纹一致。

## 独立界面复验

未参与修复的独立测试代理仅依据 [R4主手册存档](user-manual-r4-archive-2026-10-21.md)正常操作UI；不读源码、工程报告或测试，不使用直接API或后台补值。隔离环境前端15175、API18042，数据为上轮公开验收态的完整副本，原R3实例保留。LLM关闭。

旧代理及新代理的内置浏览器均无可用控制实例；新代理改用正常Chrome新页签进入平台。浏览器工具能力问题单独记录，不算产品步骤失败。详细独立操作结论见 [R4代理验收报告](independent-ui-acceptance-followup-2026-10-21.md)。

复验范围：已有经济调度新任务及诊断 / 报告、一维Skill真实求解及约束证据、水电错误输入恢复、模型新版本与固定绑定规则。

| 独立UI项目 | 结果与实际范围 | 证据 |
| --- | --- | --- |
| 新经济调度任务及结果检查 | 通过。OPT-552BE5B50F，目标160300、optimal；40条约束0违反，12变量边界0违反；逐条报告已查看 | [任务概览](manual-assets/2026-10-21-followup/independent/03-economic-overview.jpg)、[约束报告](manual-assets/2026-10-21-followup/independent/04-economic-constraints-p1.jpg) |
| 一维Skill真实调用及解释明细 | 通过。INV-9E08239D47 / OPT-42E6251653，固定MODEL-97B90D47，目标40、p=10/20；两条需求body/lower分别10/10、20/20，违反及余量0、binding，来源为本次solution_evidence | [真实调用](manual-assets/2026-10-21-followup/independent/11-skill-real-test-40.jpg)、[约束证据](manual-assets/2026-10-21-followup/independent/15-skill-evidence-constraint-tail.jpg) |
| 水电长度错误及恢复 | 修复后通过。MODEL-POWER-CASCADE-HYDRO-DISPATCH，4点；同错误输入现在定位[S1_U1]、期望4 / 实际3；恢复后问题0，检查通过可提交，未提交水电任务 | [具体行定位](manual-assets/2026-10-21-followup/independent/23-hydro-row-error-after-fix.jpg)、[恢复](manual-assets/2026-10-21-followup/independent/25-hydro-valid-submit-after-fix.jpg) |
| 已有正式 / 历史版本及固定绑定信息 | 信息核对通过。同编码model_mvhxruag_f609的MODEL-5F61FE23 v0.2为正式服务，MODEL-8FA60674 v0.1为历史下线；现有固定Skill仍绑定MODEL-97B90D47 v0.1并已真实调用。未重新发布，也未在升级的同一模型族新增旧固定Skill来验收动态切换 | [正式v0.2](manual-assets/2026-10-21-followup/independent/27-existing-formal-v02.jpg)、[历史v0.1](manual-assets/2026-10-21-followup/independent/28-existing-historical-v01.jpg)、[既有Skill绑定](manual-assets/2026-10-21-followup/independent/09-skill-fixed-definition-r1.jpg) |

以上为独立测试代理验收，不是业务用户或第三方人工验收。按编码调用切到新正式版的动态执行，由本轮版本发布集成用例真实求解验证；独立UI的版本信息核对不能替代该执行证据。

复验结束后，前端15175与API18042临时服务已停止，隔离运行态及截图继续保留。清理与端口检查见 [环境记录](../reports/manual-repair-20261021-followup/environment-cleanup.json)。

## 范围

本轮针对已发现的遗留缺陷及失败用例。真实LLM对话需要可用凭证和部署配置；Windows、Docker、Ipopt及严格原环境重放仍不属于本轮已验收能力。固定旧模型的Skill不能因为新正式版发布就被自动改成新绑定。
