# OptiForge R3 独立代理 UI 验收报告

验收日期：2026-10-21，Asia/Shanghai。执行约 17:18—18:37。

本报告由**未参与产品修复的独立测试代理**编写，属于代理验收，不是业务用户、第三方机构或人工第三方验收。唯一操作依据为开始验收时读取的 `docs/user-manual.md`，修订标识 `2026.10.21-R3`。通过浏览器正常界面访问 `http://127.0.0.1:15174`；LLM 关闭，无账号或凭证输入。

没有读取产品源码、测试、旧验收报告或实现说明，没有调用 API、curl、requests、后台运行库，也没有读取浏览器隐藏状态补数据。文件工具仅用于读取主手册、建立本报告及保存本次截图/界面证据。JSON 证据来自界面已呈现的原始返回/测试结果；经济调度复算 JSON 明确标注为界面摘录与纯算术复算。

浏览器新建独立 IAB 页签，全程没有操作用户已有页签。为保留尚未保存的一维页面，另开本代理自己的页签继续二维与组件路径。没有向修复者索取操作指导。期间收到的协调消息仅说明服务重启、修复部署及追加验收范围；产品修复由另一个代理完成，本测试代理只按手册和页面自行复验。

## 1. 结论与适用环境

**最终运行环境中，指定六条教程主链路均通过。开始时的 R3 环境并非一次性通过：发现保存索引错误、发布重开 DSL 展示缺失、测试后保存状态反复变化三个产品问题，均单独记录首次失败和修复后复验。**原始失败不能被后续通过覆盖。

| 验收项 | 首次执行 | 最终环境结论 | 实际证据 |
| --- | --- | --- | --- |
| 8.2 空白一维 | **FAIL**：编译成功但保存 422，须产品修复 | **PASS（修复后独立复验）** | 约束预估 2 条；目标预估 2 项；目标 40，p=[10,20]；发布、按名称重开同 ID |
| 8.3 空白二维 | 录入/编译通过；保存时遇服务重启的 Network Error | **PASS** | 2 条平衡、4 条容量；目标 17，U1=[4,4]、U2=[2,4]；发布、重开同 ID |
| 8.3 故意空集合恢复 | **PASS** | **PASS** | [] 被阻断；只按手册改成 ["U1","U2"] 即可保存和重开 |
| 12.1 自建组件与装配 | **PASS** | **PASS** | JSON 默认值、执行校验、组件发布；不同编码映射；p=[10,10]、目标 20；模型发布重开；审计无重复 |
| 12.2 曲线 r1 | 数值通过；“保存并离开”两次失败 | **PASS（主链完成；保存问题另行修复复验）** | 需求保留，p=[10,20]、fee=[20,60]、目标 40；发布重开固定 r1 |
| 12.2 显式更新 r2 | **PASS** | **PASS** | 候选目标 55、fee=[30,80]；应用后发布 v0.2 并重开 r2；旧固定 ID 与历史仍为 r1/40 |
| 14.4 A–C 完整 Skill / Agent 包、真实 Skill 测试 | **PASS** | **PASS** | 定义 r1 valid；包 draft→enabled；真实调用目标 40；审计 Hash 一致；重开保留 |
| 第 5 章调用已有经济调度模型 | **PASS** | **PASS** | 目标 160300；12 个机组时段出力、平衡、边界与爬坡手算一致 |
| 测试后正常保存→离开→重开修复复验 | 原曲线模型首次为 **FAIL** | **PASS（另建副本复验）** | MODEL-47A07230 测试后“已保存”；正常保存并直接离开，无连续保存错误；列表重开同 ID |

这里的“最终环境 PASS”只指本次已完成的 UI 路径及给定输入，不能表述为最初 R3 环境无缺陷。首次一维路径依赖产品代码修复，未记作靠手册自主恢复成功；修复部署后再独立复验才得到最终 PASS。

## 2. 实际资产与任务编号

| 用途 | 模型/资产 | 版本/编码 | 真实任务/调用 |
| --- | --- | --- | --- |
| 空白一维 | MODEL-97B90D47 | v0.1；model_mvhwj971_q40p | OPT-9D279A6C0C |
| 空白二维 | MODEL-76794290 | v0.1；model_mvhwr0mp_jtgu | OPT-A39D2C1355 |
| 自建组件 | manual_cap_cost_independent | 1.0.0；独立验收 手册容量与线性费用 | 组件执行校验通过、已发布 |
| 组件装配模型 | MODEL-A64B30D2 | v0.1；model_mvhxd96e_0rvy | OPT-C3D5D7BB59；发布重开后验证 OPT-9814676D02 |
| 曲线资产 | manual_cost_curve_independent | r1→r2；独立验收 手册费用曲线 | r1 Hash 前缀 6aa74f96cc21；r2 前缀 61bd05339e14 |
| 曲线 r1 模型 | MODEL-8FA60674 | v0.1；model_mvhxruag_f609 | OPT-9A70A436E5 |
| 曲线 r2 候选/新正式版 | MODEL-5F61FE23 | v0.2；沿用 model_mvhxruag_f609 | OPT-0472C65401 |
| 旧固定模型历史输入重算 | MODEL-8FA60674 | 固定 r1，当前内核重算 | OPT-EED57DF960 |
| 保存状态修复复验副本 | MODEL-47A07230 | v0.1；model_mvhyq6g0_ct9o | OPT-D555E52220 |
| 一维 Skill | run_model_mvhwj971_q40p | fixed MODEL-97B90D47/v0.1；定义 r1 | INV-AF678C6D0E；OPT-9798E11455 |
| 已有经济调度 | MODEL-POWER-ECONOMIC-DISPATCH | v1.0；economic_dispatch | OPT-FF2815CF71 |

## 3. 各路径操作、数值与发布重开

### 3.1 8.2 空白一维：最终 PASS，首次保存 FAIL

按手册空白创建通用线性模型，命名“独立验收 教程一 时段供电成本 R3”。固定 horizon=2、30 分钟、delta_t=0.5，关闭状态时点；时间成员确认为 [0,1]。

参数为 demand[time]=[10,20]、cost[time]=[2,3]、delta_t=0.5；连续变量 p[time]，边界 0..100 MW。输入以下两式，逐条后端编译、应用，再整体编译：

```text
p[t] >= demand[t]
sum(cost[t] * p[t] * delta_t for t in time)
```

后端提示 t→time；需求式预估 2 条约束/2 个项，目标预估 0 条约束/2 个项。整体显示 `generic_spec 权威编译成功`。第四步按手册导入业务参数，界面时间摘要为 2 点、30 分钟、0.5 小时。系统时间 delta_t 未在普通业务参数表重复列出。

首次应用需求式后保存 422；环境修复恢复后，在保留原页面和原 DSL 的情况下点击“重试保存”成功。未添加 t 集合、未更改公式索引、未后台补值。第五步本地校验后真实任务 OPT-9D279A6C0C 为 SUCCESS；测试界面原始证据为 optimal，任务优化结果 Gap=0.00%，p[0]=10、p[1]=20、目标 40。

独立复算：10×2×0.5=10；20×3×0.5=30；合计 40。两条需求残差为 0，0≤p≤100。

发布成功，关闭详情后从资产列表按名称重开，仍为 MODEL-97B90D47、v0.1、已发布，时间契约不变。重开公式原文首次显示“-”；前端修复后再次从列表重开，需求和目标 DSL 均可正常读取。

证据：[2 条约束](manual-assets/2026-10-21-repair/independent/01-1d-constraint-2.jpg)、[2 项目标](manual-assets/2026-10-21-repair/independent/02-1d-objective-2.jpg)、[首次保存错误](manual-assets/2026-10-21-repair/independent/03-1d-save-set-t-error.jpg)、[真实结果 40](manual-assets/2026-10-21-repair/independent/09-1d-result-40.jpg)、[发布重开](manual-assets/2026-10-21-repair/independent/11-1d-published-reopened.jpg)、[重开 DSL 修复复验](manual-assets/2026-10-21-repair/independent/18-1d-reopened-dsl-restored.jpg)。

### 3.2 8.3 空白二维及空集合恢复：PASS

独立新建“独立验收 教程二 两机组两时段”，同样固定 2 点、30 分钟。故意把 unit 集合成员保留 []、默认规模填 2 后保存，页面明确提示“集合必须包含非空字符串或有限数字成员”。随后只按手册将成员改为 ["U1","U2"]，保存成功；重开编辑集合，成员完整保留，卡片显示 2 项。此恢复无需询问作者或后台动作。

参数 demand[time]=[6,8]；cost[unit]={U1:2,U2:3}；cap[unit,time]={U1:[4,4],U2:[4,6]}；delta_t=0.5。p[unit,time] 连续、边界 0..10 MW。录入手册三式并权威编译，得到 2 条平衡、4 条容量约束，费用目标 4 项。

OPT-A39D2C1355 SUCCESS，目标 17，Gap=0.00%。四坐标实际为 U1,0=4、U1,1=4、U2,0=2、U2,1=4。手算：时段 0 合计 6，费用 (2×4+3×2)×0.5=7；时段 1 合计 8，费用 (2×4+3×4)×0.5=10；合计 17。容量与变量边界满足，U2 两时段各余 2 MW。

发布后从列表重开同 ID；generic_spec 中 time=[0,1]、unit=[U1,U2]、p 索引 [unit,time]、边界 0..10 与三式均保留。

证据：[空成员阻断](manual-assets/2026-10-21-repair/independent/04-2d-empty-set-error.jpg)、[按手册恢复并重开成员](manual-assets/2026-10-21-repair/independent/05-2d-members-recovered.jpg)、[容量展开 4 条](manual-assets/2026-10-21-repair/independent/06-2d-capacity-4.jpg)、[实际结果 17](manual-assets/2026-10-21-repair/independent/10-2d-result-17.jpg)、[发布重开](manual-assets/2026-10-21-repair/independent/14-2d-published-reopened.jpg)、[重开集合/三式](manual-assets/2026-10-21-repair/independent/15-2d-reopened-formulas.jpg)。

### 3.3 12.1 自建组件及不同编码装配：PASS

专家视图新建组件 `manual_cap_cost_independent`，名称/展示名“独立验收 手册容量与线性费用”，1.0.0、基础组件。领域下拉没有手册简写的“通用”，按页面选择“通用建模”；不影响其余操作。

组件声明 time 集合；max_output 的 time 维度通过输入后按 Enter 成为标签，默认值按 JSON 填 [15,25]；unit_cost、period_hours 标量默认值分别填 2、0.5。变量 p 的维度为 time。新增 `p[t] <= max_output[t]` 与最小化 `sum(unit_cost * p[t] * period_hours for t in time)`，后端编译、应用并保存。详情参数接口显示 [15,25]、2、0.5；“执行校验通过”，随后组件发布为 published、可用于新模型。

从一维已发布模型复制独立模型并切换组件化 Builder。选择上述自建组件后，模型最大出力改编码 capacity_limit，默认 [15,25]、time、MW；p 下界改为 10，上界 100。绑定抽屉选择最大出力 (capacity_limit)，运行参数键不再指向 max_output，索引集合 time；“保存并校验”后审计显示 max_output→capacity_limit。unit_cost、period_hours 同名绑定。

停用复制来的需求与线性费用公式，两行参与状态均为 disabled。组件审计只显示 **1 条出力上限、1 个供电费用目标、3 条绑定**，未重复列出兼容公式。第四步按字段填 capacity_limit=[15,25]、unit_cost=2、period_hours=0.5，并逐项 Enter；最终 JSON 预览为数组与数字，没有把这些值包成字符串。

OPT-C3D5D7BB59 SUCCESS / optimal，p=[10,10]、目标 20、Gap=0.00%，测试证据最大约束违反为 0。手算上限裕量 [5,15]，费用 (2×10+2×10)×0.5=20。

模型发布后按名称重开同 ID，component_based、组件版本与三条映射保留，模型语义中只有 capacity_limit，没有额外 max_output 模型参数。已发布详情的语义表不直接列变量边界；为核对其执行保留，在重开模型上点“验证运行（状态不变）”，新任务 OPT-9814676D02 仍 p=[10,10]、目标 20、Gap=0.00%，模型保持已发布。此模型需求式已停用，正费用下仍取 10，支持 10 MW 下界在发布后继续生效。

证据：[组件执行校验](manual-assets/2026-10-21-repair/independent/07-component-execution-valid.jpg)、[组件发布](manual-assets/2026-10-21-repair/independent/08-component-published.jpg)、[不同编码绑定](manual-assets/2026-10-21-repair/independent/12-component-binding-different-code.jpg)、[无重复审计](manual-assets/2026-10-21-repair/independent/13-component-audit-no-duplicates.jpg)、[实际结果 20](manual-assets/2026-10-21-repair/independent/17-component-result-20.jpg)、[模型发布重开](manual-assets/2026-10-21-repair/independent/20-component-model-published-reopened.jpg)、[重开绑定](manual-assets/2026-10-21-repair/independent/21-component-reopened-binding.jpg)、[重开后再验证 20](manual-assets/2026-10-21-repair/independent/23-component-reopened-verification-20.jpg)。

原始界面测试摘录：[component-test-ui.json](manual-assets/2026-10-21-repair/independent/component-test-ui.json)。

### 3.4 12.2 曲线 r1、显式 r2、旧模型/历史：PASS

CSV 界面新建 `manual_cost_curve_independent`：一维 MILP 分段 segment_binary，MW→元/h；r1 点为 (0,0)、(10,20)、(20,60)，预览 3 行正确、正常。未上传文件，直接粘贴手册给定 CSV。

从已发布一维模型复制独立模型，切换组件化，增加 fee[time] 连续变量、边界 0..100 元/h；p 上界改为 20、下界 0。选择 `function_mapping_component`，明确核对资产 ID 后绑定 p[t]→fee[t]、time/t、segment_binary。保留需求 `p[t]>=demand[t]` 为 solve_active，原费用式改为 `sum(fee[t] * delta_t for t in time)`，权重 1、最小化；批量权威编译两式通过。运行输入仍为 demand=[10,20]、cost=[2,3]、delta_t=0.5。

r1 真实任务 OPT-9A70A436E5 为 SUCCESS / optimal，p=[10,20]、fee=[20,60]、目标 40、Gap=0.00%、最大违反 0。测试界面原始证据含两条需求 10≤p[0]、20≤p[1]，费用定义为 0.5×fee[0]+0.5×fee[1]，未混入遗留 cost。独立复算 20×0.5+60×0.5=40。

测试后的“保存并离开”异常见第 4 节。正常保存后点击发布成功；列表重开同 MODEL-8FA60674/v0.1，函数更新页显示固定 r1、Hash 前缀 6aa74f96cc21。

接着在函数资产编辑界面仅把 y 改为 0、30、80，保存生成同资产 r2。重开 r1 模型，显示“使用 r1，最新 r2；保留当前”，未自动切换。显式选择 r2 并展开差异，当前/候选点分别为 [[0,0],[10,20],[20,60]] 与 [[0,0],[10,30],[20,80]]。

点击“更新并测试”，真实候选 MODEL-5F61FE23、任务 OPT-0472C65401 SUCCESS。对比表目标 40→55，p 两点 10/20→10/20，fee 20/60→30/80，最大违反 0→0。独立费用 30×0.5+80×0.5=55。核对后“应用更新”，新 ID 发布为同编码 v0.2；列表重开新 ID 固定 r2、Hash 前缀 61bd05339e14。

旧 MODEL-8FA60674 自动成为下线历史 v0.1，重开仍显示固定 r1 与原 Hash；历史 OPT-9A70A436E5 仍为目标 40、p=[10,20]、fee=[20,60]。在该历史任务点击“当前内核按历史输入重算”，新任务 OPT-EED57DF960 SUCCESS，任务概览确认仍使用旧 MODEL-8FA60674，结果仍为 40、p=[10,20]、fee=[20,60]。这是当前内核使用历史输入/冻结依赖重算，**没有宣称原环境严格重放**。

证据：[r1 CSV](manual-assets/2026-10-21-repair/independent/16-curve-r1-import.jpg)、[r1 绑定](manual-assets/2026-10-21-repair/independent/19-curve-r1-binding.jpg)、[r1 实际 40](manual-assets/2026-10-21-repair/independent/24-curve-r1-result-40.jpg)、[r1 发布重开](manual-assets/2026-10-21-repair/independent/25-curve-r1-published-reopened.jpg)、[r1 固定绑定](manual-assets/2026-10-21-repair/independent/26-curve-r1-pinned.jpg)、[最新 r2 但仍 r1](manual-assets/2026-10-21-repair/independent/27-curve-r1-pinned-latest-r2.jpg)、[修订差异](manual-assets/2026-10-21-repair/independent/28-curve-r2-diff.jpg)、[候选实际 55](manual-assets/2026-10-21-repair/independent/29-curve-r2-comparison-55.jpg)、[应用并发布](manual-assets/2026-10-21-repair/independent/30-curve-r2-applied-published.jpg)、[新 ID 重开 r2](manual-assets/2026-10-21-repair/independent/31-curve-r2-reopened-pinned.jpg)、[旧 ID 保留 r1](manual-assets/2026-10-21-repair/independent/32-old-model-still-r1.jpg)、[历史结果仍 40](manual-assets/2026-10-21-repair/independent/33-history-r1-still-40-after-r2.jpg)、[旧固定依赖重算 40](manual-assets/2026-10-21-repair/independent/34-old-fixed-history-recompute-40.jpg)。

界面结果 JSON：[r1 测试](manual-assets/2026-10-21-repair/independent/curve-r1-test-ui.json)、[r2 候选原始返回](manual-assets/2026-10-21-repair/independent/curve-r2-candidate-ui.json)。

### 3.5 14.4 完整 Skill / Agent 包与非 LLM 真实测试：PASS

选择一维发布产生的 `run_model_mvhwj971_q40p`，核对 fixed MODEL-97B90D47/v0.1，enabled。点击“生成完整 Skill”，得到 r1、validation valid、校验分 100、生成方式 deterministic_contract_compiler。

定义 Hash：`7f3e915eee95f9e96d0602b961b5446e35761b54252f17f9a7ab1519ba957fd9`。

generation.source_contract_hash：`bd25c0aedd0829c9002bf244bad24c3df144f4d62c34f0ff82fc7fd87d16d6ed`。

输入 Schema 为 demand[time]、cost[time]、delta_t 标量，输出为 p[time]；参数采集问题也逐一对应三者，没有 cap、U1 或另一个教程的参数。

“Agent 绑定→生成 Agent 包”后 has_agent_package=true、agent_enabled=false、status=draft、validation valid，页面明确提示已生成但尚未启用。点击“启用 Agent”，变为 agent_enabled=true、status=enabled，列表显示已绑定。语义质量分 61/100 仅记诊断值，没有当作对话覆盖率。

在线测试显式填入 {demand:[10,20],cost:[2,3],delta_t:0.5}。真实调用 INV-AF678C6D0E / OPT-9798E11455，resolved_model_id=MODEL-97B90D47，SUCCESS、optimal、目标 40，原始 p={0:10,1:20}，摘要 min=10、max=20、sum=30。explanation_audit.definition_source=persisted_skill、revision=1，Hash 与刚生成定义完全一致；LLM enabled=false、attempted=false。

解释层提示“结果未返回可核验的约束检查明细”，保留此限制。原始 solution_evidence 含两条需求残差 0；仍按手册独立计算 p-demand=[0,0] 和费用 40，没有把解释文本当作完整约束校验结论。

调用记录增加 INV-AF678C6D0E SUCCESS。关闭、重开该 Skill 后，基础绑定仍是 MODEL-97B90D47，定义仍 r1/相同 Hash，Agent 仍 enabled/valid。

证据：[定义 r1 valid](manual-assets/2026-10-21-repair/independent/35-skill-definition-r1-valid.jpg)、[包待启用/valid](manual-assets/2026-10-21-repair/independent/36-agent-package-draft-valid.jpg)、[启用成功](manual-assets/2026-10-21-repair/independent/37-agent-package-enabled.jpg)、[真实调用/40/原始变量](manual-assets/2026-10-21-repair/independent/40-skill-real-test-40.jpg)、[调用记录](manual-assets/2026-10-21-repair/independent/41-skill-invocation-record.jpg)、[重开仍启用](manual-assets/2026-10-21-repair/independent/42-skill-agent-reopened-enabled.jpg)。

界面 JSON：[SkillDefinition](manual-assets/2026-10-21-repair/independent/skill-definition-ui.json)、[真实 Skill 原始返回](manual-assets/2026-10-21-repair/independent/skill-test-result-ui.json)。

### 3.6 第 5 章已有经济调度：PASS

任务中心创建任务，选择“经济调度 · v1.0”，MODEL-POWER-ECONOMIC-DISPATCH。保留 4 点、60 分钟、HiGHS；高级 JSON 完整粘贴手册业务输入，导入合并，检查页显示 8 项有效业务参数与正确最终预览后提交。

OPT-FF2815CF71 SUCCESS，目标/总成本 160300，Gap=0.00%；技术日志明确 `HiGHS termination_condition=optimal`。任务概览的“终止状态”“约束违反摘要”显示“-”，故用技术日志确认 optimal，并自行复算约束，未宣称任务概览已显示完整检查。

| 时段 | U1 | U2 | U3 | 总出力/需求 | 费用 |
| --- | ---: | ---: | ---: | --- | ---: |
| 0 | 120 | 30 | 10 | 160/160 | 37800 |
| 1 | 120 | 60 | 10 | 190/190 | 45600 |
| 2 | 120 | 45 | 10 | 175/175 | 41700 |
| 3 | 120 | 20 | 10 | 150/150 | 35200 |
| 合计 | — | — | — | 平衡残差全 0 | **160300** |

费用按各机组燃料成本 [220,260,360] 逐时计算。U1 始终 120 上限，U3 始终 10 下限，U2 在 20..90。初始 [80,50,30]→首段变化 [40,-20,-20]，分别满足上下爬坡限值 [80,60,50]；后续 U1/U3 不变、U2 变化 [30,-15,-25]，均满足。不存在把半小时教程的 delta_t=0.5 混入此一小时经济调度的情况。

证据：[最终提交预览](manual-assets/2026-10-21-repair/independent/43-economic-submit-preview.jpg)、[12 个实际变量/160300](manual-assets/2026-10-21-repair/independent/44-economic-result-160300.jpg)、[optimal 技术日志](manual-assets/2026-10-21-repair/independent/45-economic-optimal-log.jpg)。[界面提交 JSON](manual-assets/2026-10-21-repair/independent/economic-dispatch-request-ui.json)、[界面结果摘录与纯算术复算 JSON](manual-assets/2026-10-21-repair/independent/economic-result-transcribed-ui.json)。

## 4. 停住、恢复与修复后复验记录

| 编号/阶段 | 手册步骤及已填数据 | 实际反馈 | 仅凭手册能否恢复 | 处理及最终状态 |
| --- | --- | --- | --- | --- |
| I-01 首次一维保存 | 8.2 C；time=[0,1]；p[t]>=demand[t]；编译提示 t→time；整体编译成功 | 保存 422：`model_draft.formulas[0].foreach` 引用了不存在集合 t；`set_reference_not_found` | **不能**。重新编译、正常保存仍失败，没有应按手册添加 t 集合的理由 | 保留页面/截图上报，原步骤 **FAIL**；另一代理修复并重启环境后，原样“重试保存”成功，继而完成测试/发布/重开。不是作者操作指导，也没有后台补资产值 |
| E-01 服务重启 | 8.3 运行数据阶段；三式及二维输入已录入 | 自动保存 Network Error | 只需等待已通知的服务恢复 | 保留自有页签；环境恢复后点“重试保存”成功。与产品校验错误分开记录 |
| I-02 重开原始 DSL | 8.2 E.5；已发布同 ID 的 generic_spec 页 | compile_valid，但约束和目标“原始 DSL”均为“-” | **不能**从该展示自行补回原文；数值和版本仍可核对 | 上报展示缺陷；前端修复后从列表重开一维与二维，原文正常，截图 18/15。首次展示 **FAIL**，修复复验 **PASS** |
| I-03 曲线测试后保存状态 | 12.2 C；r1 测试已 SUCCESS/40；未手动修改输入 | 页面长期“待自动保存”；离开弹“当前草稿尚未保存”；连续两次“保存并离开”均报“保存期间有新的修改，请再次保存或继续编辑” | 普通离开路径 **不能**在两次合理重试后恢复；页面有其他入口可继续主链 | 选“继续编辑”→正常保存草稿显示已保存→发布成功，但当时底部仍待自动保存。该原保存离开路径记 **FAIL**，不能因发布成功掩盖 |
| I-03R 保存修复后新副本 | 从旧 r1 曲线模型复制独立副本，命名“独立验收 曲线保存复验”；沿用已确认输入和固定 r1 | MODEL-47A07230 / OPT-D555E52220 SUCCESS 后，顶部及底部均“已保存”“最近测试通过” | **可以**，按正常界面无需临时绕行 | 正常“保存草稿”→直接点模型资产离开，无保存错误或重复提示→按名称重开同 ID 试运行。修复复验 **PASS**；截图 38/39 |
| U-01 测试代理首次定位失误 | 第一个空白模型创建时，虚拟选项未实际选中业务场景就保存 | MODEL-E7CCC04E 保存为无场景草稿，“下一步”提示业务场景必填；保存后的场景栏只读 | 本代理重新按实际可点击选项建立完整模型可继续 | 留存原草稿未删除，主验收使用 MODEL-97B90D47。此项是代理操作定位失误，不算手册教程通过证据，也未用后台纠正 |

I-03 证据：[首次连续保存失败](manual-assets/2026-10-21-repair/independent/22-curve-post-test-save-race.jpg)、[修复后测试完成为已保存](manual-assets/2026-10-21-repair/independent/38-save-retest-after-success-saved.jpg)、[正常离开后重开同副本](manual-assets/2026-10-21-repair/independent/39-save-retest-reopened-trial.jpg)。

## 5. 保留的边界

- **14.4 D 真实 LLM 对话：BLOCKED（环境前置条件不具备，且委托明确不在范围）。**没有填凭证、没有发送模拟对话，没有把包启用或直接 Skill 成功当作多轮参数收集、默认值确认及执行确认的对话闭环通过。
- 第 8.4 状态递推为可选练习，按本次范围决定未执行，不作 PASS 判定。
- Windows、Docker、Ipopt、NLP、重启迁移、严格原环境历史重放均未验收。
- 任务概览部分终止状态/约束摘要为“-”；Skill 解释层声明缺少可核验约束明细。已分别使用可见技术日志、原始测试证据与小例手算核对，不扩大为“全部业务约束已由页面证明”。
- 组件模型已发布详情不直接列出变量边界；本报告用发布前明确输入及发布重开后的同 ID 再验证结果核对边界生效，没有声称只读表直接显示了下界字段。
- 所有创建、修改、测试、发布、修订应用均经正常 UI。报告未删除遗留草稿、测试任务或候选；当前正式曲线入口是 v0.2/r2，旧固定 ID 为下线历史 r1。

全部本次截图位于 [independent 证据目录](manual-assets/2026-10-21-repair/independent/)，文件名 `01-...jpg` 至 `45-...jpg`。结论以本报告列出的实际 ID、任务、数值和 UI 证据为准，不沿用手册中的作者样例编号。
