# 手册操作问题修复与独立代理验收

> 原报告中的修订标识及结论保持不变。主手册已更新为用户版；含前期教程与修订记录的[R4手册存档](user-manual-r4-archive-2026-10-21.md)另行保留。

> 本页保留R3当时的工程和界面记录。此处的3项遗留测试失败已在后续R4处理中修复，最新状态与证据见 [R4遗留项修复与复验](manual-followup-closure-2026-10-21.md)。

日期：2026-10-21。源码基线：`4d81a3f952af97536918886fd9dc2dfe589e38a5`；修复位于当前工作区，未推送或部署。对应 [R3 手册](user-manual.md)，R2 原始失败记录保留在 [历史验证记录](user-manual-validation-2026-10-21.md)。完整文件指纹见 [源码清单](../reports/manual-repair-20261021/source-manifest.json)。

## 修复内容

| 问题 | 修复后的行为 | 主要源码 |
| --- | --- | --- |
| 组件默认值保存为字符串，比较 VarData 与 str 报错 | 数字、数组、对象按 JSON 保存；空白不设置，0 保留；重新打开仍显示完整 JSON | [ComponentEditor](../frontend/src/features/component-library/ComponentEditor.tsx) |
| 自定义组件目标执行校验通过，模型仍报未实现 | 服务端依据执行校验确认 DSL 目标支持状态，兼容可执行的历史定义；冻结的已发布组件定义不改写 | [组件发布](../app/api/components.py)、[草稿转换](../app/model_draft.py) |
| max_output→capacity_limit 映射未完整进入目标和输入契约 | 模型契约不再重新要求已映射的内部编码；组件目标使用本组件已绑定的运行数据 | [草稿保存](../frontend/src/features/model-creation/utils/saveModelDraftAsset.ts)、[目标构建](../app/model_components/objective_components.py) |
| 界面的变量下界 10 未生效 | 组件构建同时识别规范字段与 UI lowerBound / upperBound，实际求解遵守边界 | [组件模型构建](../app/builders/component_model_builder.py) |
| 通用→组件化后需求约束与费用目标可见却未执行，目标0 | 模型自有启用 DSL 与组件共同进入求解；停用 / 仅预览不进入；无效启用公式必须阻断 | [模型公式桥接](../app/model_formula_bridge.py)、[模型服务](../app/services/model_service.py) |
| time 与 t 重复形成笛卡尔展开，2点预估4条 | 前端区分别名和集合；后端清除旧元数据中未使用的重复维度，同时保留真正的 i,j 双索引 | [引用收集](../frontend/src/features/formula-editor/formulaDsl.ts)、[权威编译](../app/formulas/service.py) |
| 组件审计重复显示约束 / 目标 | 规范字段与旧兼容字段择一读取，不再直接合并同一份内容 | [数学展开](../frontend/src/features/model-creation/steps/Step3MathExpansion.tsx) |
| 本地绿勾被误解为后端通过；失败仅显示422 | 明确提示本地检查仍需后端测试；展示后端字段、期望 / 实际和修复建议、嵌套求解诊断；绑定抽屉说明检查范围 | [测试发布](../frontend/src/features/model-creation/steps/Step5ReviewPublish.tsx)、[请求错误](../frontend/src/api/client.ts)、[绑定抽屉](../frontend/src/features/model-creation/components/ParameterBindingDrawer.tsx) |
| 测试执行定义与发布时再次规范化定义可能不同 | 测试保留实际规范化快照、依赖和原始内容并发检查；发布检查相同执行定义；实际求解诊断字段不误判成结构变化；历史重新上架保留不可变定义 | [任务提交](../app/services/job_service.py)、[模型服务](../app/services/model_service.py)、[时间契约](../app/services/model_time_dimension_service.py) |
| 独立代理新发现：编译 t→time 成功，保存却将 foreach 的 t 当成集合 | 编译后分别保存真实集合和别名；服务端按明确 scope 兼容旧别名元数据；字面坐标不算自由索引，t±1 识别为 t | [公式编辑](../frontend/src/features/formula-editor/FormulaBuilderModal.tsx)、[批量编译](../frontend/src/features/formula-editor/FormulaManagementPanel.tsx)、[集合引用校验](../app/services/model_set_reference_validator.py) |

独立代理还发现已发布通用模型详情缺少原始 DSL 展示；前端现按 `source_formula_id` 关联同一模型冻结的 `formula_artifacts` 表达式，保持原求解定义。见 [模型详情](../frontend/src/features/model-center/ModelAssetPanels.tsx)及 [公式显示](../frontend/src/features/formula-editor/FormulaDisplay.tsx)。已在二维重开界面复验三条原文正常显示。

独立代理在曲线测试后还发现“保存并离开”重复失败、底部未保存状态与实际保存不一致。修复 [工作台保存确认](../frontend/src/features/model-creation/ModelCreationPage.tsx)：相同内容无需再次写服务器时，同样确认保存状态；若当前草稿已有真正的新修改，仍保留未保存标记。新增实际工作台回归；独立代理在 MODEL-47A07230 / OPT-D555E52220 复验通过：测试后“已保存 / 最近测试通过”，正常保存后直接离开，重新打开同ID为试运行，没有连续保存失败。

## 工程回归

测试通过公开 API、真实 Pyomo / HiGHS 完成，不把这些结果当作 UI 独立验收。

- 新增后端回归覆盖数值默认值、全部三个输入映射到不同编码、变量10下界、目标20、曲线目标40及需求约束、测试 / 发布 / 重开 / 再调用、无效公式禁止静默丢弃、旧重复scope、真正双索引及别名保存往返。
- 新增前端回归覆盖真实组件编辑控件的数字 / 数组 / 空白 / 0、自由索引、字面和偏移坐标、参数契约、后端错误展示及编译后保存字段。现有公式编辑测试的编译桩同步模拟后端索引推断，保留原时序与过期响应断言。
- 原失败草稿在临时副本上直接重新测试：组件 MODEL-A67FA232 得到 p=[10,10]、目标20；曲线 MODEL-9985441C 得到 p=[10,20]、fee=[20,60]、目标40；两者均发布成功。见 [旧草稿兼容日志](../reports/manual-repair-20261021/legacy-drafts-regression.log)。原 UI 实例未被后台改写。已发布历史模型保持不可变；需要采用修复后的定义时，通过新版本 / 独立复制、重新编译测试后发布，不能假定旧固定版本被自动改写。

| 检查 | 最终结果 | 证据 |
| --- | --- | --- |
| 后端默认全量 | **721通过，5跳过** | [日志](../reports/manual-repair-20261021/backend-full.log) |
| 前端单元全量 | **89文件、496项全部通过** | [日志](../reports/manual-repair-20261021/frontend-full.log) |
| 前端类型检查 / 生产构建 | 均通过；构建仍有体积提示 | [类型](../reports/manual-repair-20261021/frontend-typecheck.log)、[构建](../reports/manual-repair-20261021/frontend-build.log) |
| 模型发布一致性与合成业务专项 | 16通过，含11个合成业务场景 | [日志](../reports/manual-repair-20261021/backend-final-consistency.log) |
| 别名保存与集合引用专项 | 15通过 | [日志](../reports/manual-repair-20261021/backend-alias-save.log) |
| 扩展组件 / 模板 / Skill / 持久化集成 | **54通过、3项基线已有失败** | [最终日志](../reports/manual-repair-20261021/backend-integration-final.log) |

扩展集成发现的三项失败在未修改基线中同样复现：两条水电参数校验断言期望首条错误为中文，实际首条是通用 length mismatch；一条旧版本切换用例未提供必填运行输入。它们未被删测、跳过或改成通过。[未修改基线对照](../reports/manual-repair-20261021/backend-integration-baseline.log)。本轮修复过扩展检查中新引入的发布诊断兼容问题，合成业务11场景已通过针对性复测。

## 独立代理界面验收

用户明确选择未参与修复的独立测试代理。代理仅获得 R3 主手册与全新隔离环境，使用自己的隐藏浏览器页；不读源码、测试或实现说明，不调用 API，不读写后台运行库，不接受修复者即时 UI 操作指导。允许读取手册引用的公共 JSON / CSV 输入并通过界面填写。这属于代理验收，不能称为真实业务用户或第三方人工验收。

环境：macOS arm64；前端 `http://127.0.0.1:15174`、API `http://127.0.0.1:18041`；Python3.12.14、Pyomo6.10.1、HiGHS1.15.1；LLM关闭，无真实凭证；独立运行目录不覆盖原业务数据。

验收结束后已关闭本次临时服务，隔离运行态及全部证据保留。

六条主教程的独立界面验收已完成。代理记录的完整操作、输入、任务及证据见 [独立代理报告](independent-ui-acceptance-2026-10-21.md)。以下 ID 属于本次隔离运行态。

本次保存45张界面截图与7份界面JSON，文件Hash、案例编号及工程结果集中记录在 [验收证据清单](manual-assets/2026-10-21-repair/verification.json)。截图扩展名已按实际JPEG格式修正，保留原始图片字节。

| 教程 | 独立 UI 结果 | 资产 / 任务 | 主要证据 |
| --- | --- | --- | --- |
| 已有经济调度模型 | 目标160300；U1=[120,120,120,120]、U2=[30,60,45,20]、U3=[10,10,10,10]；平衡残差0，边界及爬坡复算通过 | MODEL-POWER-ECONOMIC-DISPATCH v1.0 / OPT-FF2815CF71 | [结果](manual-assets/2026-10-21-repair/independent/44-economic-result-160300.jpg)、[最优日志](manual-assets/2026-10-21-repair/independent/45-economic-optimal-log.jpg) |
| 空白一维 | 展开2条 / 2项；p=[10,20]、目标40；发布及同ID重开通过 | MODEL-97B90D47 / OPT-9D279A6C0C | [结果](manual-assets/2026-10-21-repair/independent/09-1d-result-40.jpg)、[重开](manual-assets/2026-10-21-repair/independent/11-1d-published-reopened.jpg) |
| 空白二维 | 容量展开4条；p(U1)=[4,4]、p(U2)=[2,4]、目标17；空集合错误恢复及发布重开通过 | MODEL-76794290 / OPT-A39D2C1355 | [结果](manual-assets/2026-10-21-repair/independent/10-2d-result-17.jpg)、[恢复](manual-assets/2026-10-21-repair/independent/05-2d-members-recovered.jpg) |
| 组件发布与装配 | JSON默认值组件执行校验 / 发布通过；max_output→capacity_limit；p=[10,10]、目标20、违反0；审计无重复，发布重开后再验证仍20 | MODEL-A64B30D2 / OPT-C3D5D7BB59；重开验证 OPT-9814676D02 | [结果](manual-assets/2026-10-21-repair/independent/17-component-result-20.jpg)、[重开绑定](manual-assets/2026-10-21-repair/independent/21-component-reopened-binding.jpg) |
| 曲线与修订更新 | r1 p=[10,20]、fee=[20,60]、目标40；明确更新r2后fee=[30,80]、目标55、违反0，应用并重开v0.2通过 | MODEL-8FA60674 / OPT-9A70A436E5 → MODEL-5F61FE23 / OPT-0472C65401 | [40→55比较](manual-assets/2026-10-21-repair/independent/29-curve-r2-comparison-55.jpg)、[r2重开](manual-assets/2026-10-21-repair/independent/31-curve-r2-reopened-pinned.jpg) |
| Skill / Agent包 | 完整Skill定义r1 valid；Agent包启用 / 重开通过；直接Skill真实调用目标40、p=10/20；解释审计修订 / Hash一致 | run_model_mvhwj971_q40p；INV-AF678C6D0E / OPT-9798E11455 | [真实调用](manual-assets/2026-10-21-repair/independent/40-skill-real-test-40.jpg)、[启用重开](manual-assets/2026-10-21-repair/independent/42-skill-agent-reopened-enabled.jpg) |

曲线旧v0.1为历史下线，仍保留r1及原Hash，原任务仍为40。[历史截图](manual-assets/2026-10-21-repair/independent/33-history-r1-still-40-after-r2.jpg)。代理从旧冻结依赖进行当前内核历史输入重算，`OPT-EED57DF960` 仍得到40；此项不能称为严格原执行环境重放。[重算截图](manual-assets/2026-10-21-repair/independent/34-old-fixed-history-recompute-40.jpg)。Skill的真实调用不依赖LLM，本次审计 `LLM.enabled=false`、`attempted=false`，因此不代表真实LLM对话通过。

代理首次发现的索引保存阻断保留 [失败截图](manual-assets/2026-10-21-repair/independent/03-1d-save-set-t-error.jpg)，修复后自行完成一维 / 二维保存、测试、发布。详情原始DSL缺失修复后，代理在 [一维](manual-assets/2026-10-21-repair/independent/18-1d-reopened-dsl-restored.jpg)和 [二维](manual-assets/2026-10-21-repair/independent/15-2d-reopened-formulas.jpg)重开确认表达式。测试后保存故障保留 [首次截图](manual-assets/2026-10-21-repair/independent/22-curve-post-test-save-race.jpg)，修复后代理另建 MODEL-47A07230，完成测试、正常保存、直接离开和同ID重开。[已保存状态](manual-assets/2026-10-21-repair/independent/38-save-retest-after-success-saved.jpg)、[重开](manual-assets/2026-10-21-repair/independent/39-save-retest-reopened-trial.jpg)。原始失败记录均保留。

## 边界

真实 LLM 多轮对话、Windows / Docker、Ipopt、严格原执行环境重放不属于本轮验收。历史已经丢失的资产不能由本次修复凭空恢复。独立代理通过也不替代生产业务人员的调度结果审批。
