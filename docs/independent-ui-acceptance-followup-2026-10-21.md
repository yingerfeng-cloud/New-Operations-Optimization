# OptiForge 遗留项独立 UI 复验报告

日期：2026-10-21。依据：[R4手册存档](user-manual-r4-archive-2026-10-21.md)，2026.10.21-R4。执行者未参与产品实现，通过普通浏览器界面独立操作。

## 结论与范围

本轮完成经济调度结果检查、非 LLM 的真实 Skill 求解解释、水电参数错误与恢复三项复验。版本治理完成既有正式版、历史版和固定 Skill 绑定信息的界面核对；本轮没有重新发布版本，也没有执行升级前后同一模型族的编码路由与旧固定 Skill 对比，不能据此宣布该完整升级旅程通过。

| 项目 | 本轮实际结果 | 判定 |
| --- | --- | --- |
| 经济调度新运行、终止状态、约束摘要及逐条数值 | 新任务目标 160300，optimal，40 条约束和 12 个变量边界检查均零违反，逐条页面数值与独立复算一致 | 已验收 |
| 一维 Skill 真实执行及需求约束解释 | 新调用目标 40，p=[10,20]；两条需求约束具有实际值、上下界、余量、违反量和数值来源，解释正确识别两个触边约束 | 已验收，审计对象的全文核对边界见下文 |
| 水电 availability 缺时点及恢复 | 首次缺具体行定位；补充修复后同一输入定位 [S1_U1]，恢复原值后问题归零并允许继续提交 | 修复后复验通过；首次失败保留 |
| 版本治理 | 同编码 v0.2 正式版本与 v0.1 下线历史均存在；现有 Skill 固定 ID / 修订可核对 | 静态 UI 核对完成；发布切换及编码路由对比执行未验收 |

只使用公开小例和隔离环境 `http://127.0.0.1:15175`。没有读取产品源码、测试、工程报告或运行时存储，没有直接调用 API、curl 或读取浏览器隐藏状态。读取的产品资料仅为 R4 手册。页面展示的原始结果 JSON 属于正常 UI 可见内容。

首次 CUA 浏览器 inventory 为空，IAB 入口不可用；改用原生 Chrome 新标签后成功进入产品。首次原生 Chrome 绑定工具约等待 2067 秒，此为工具等待，不能记为产品加载或求解耗时。后续调用设置有界超时。开始页面显示平台在线、HiGHS 可用、14 个已发布模型和 10 个已有任务。

## 1. 经济调度：本轮新任务与独立复算

按第 5 章从任务中心创建新任务，选择经济调度 v1.0，核对 4 点、60 分钟、HiGHS，以及手册默认输入。没有复用旧任务结果作为本轮求解证据。

| 身份 | 实际值 |
| --- | --- |
| 模型 ID | MODEL-POWER-ECONOMIC-DISPATCH |
| 新任务 ID | OPT-552BE5B50F |
| UI 创建时间 | 2026-10-21 21:54:54 |
| 状态 / 终止状态 | SUCCESS / optimal |
| 目标 / 总成本 | 160300 / 160300 |
| 任务概览 | 已检查 40 条约束，违反 0 条，最大违反量 0；已检查 12 个变量边界，边界违反 0；容差 0.000001 |

实际变量为 U1=[120,120,120,120]、U2=[30,60,45,20]、U3=[10,10,10,10]。独立逐时核算：

| 时点 | 总出力 / 输入负荷 | 费用 |
| --- | --- | --- |
| 0 | 160 / 160 | 120×220+30×260+10×360=37800 |
| 1 | 190 / 190 | 45600 |
| 2 | 175 / 175 | 41700 |
| 3 | 150 / 150 | 35200 |
| 合计 | 四个平衡残差均为 0 | 160300 |

最小/最大出力为 U1 30/120、U2 20/90、U3 10/70。U2 的双侧最小余量为 [10,30,25,0]，U1、U3 均触边。以初始出力 [80,50,30] 为基准，各机组实际相邻增量分别为 U1=[40,0,0,0]、U2=[-20,30,-15,-25]、U3=[-20,0,0,0]；分别满足上/下爬坡限值 80、60、50。

结果报告的“约束检查”五页实际列出 12 条出力边界、4 条负荷平衡、12 条上爬坡及 12 条下爬坡，共 40 条。均有实际值、下界、上界、余量、违反量和检查结果；单侧无界显示“-”。例如 output_bounds[U2,0] 为实际 30、下界 20、上界 90、余量 10、违反 0；power_balance[1] 为实际/下界/上界均 190、余量/违反均 0；ramp_down_limit[U2,3] 为实际 25、上界 60、余量 35、违反 0。数值与独立复算一致。

证据：[01提交预览](manual-assets/2026-10-21-followup/independent/01-economic-submit-ui.json)、[02变量与目标](manual-assets/2026-10-21-followup/independent/02-economic-result-160300.jpg)、[03任务概览](manual-assets/2026-10-21-followup/independent/03-economic-overview.jpg)、[04约束第一页](manual-assets/2026-10-21-followup/independent/04-economic-constraints-p1.jpg)、[08约束第五页](manual-assets/2026-10-21-followup/independent/08-economic-constraints-p5.jpg)。中间05—07页同目录保留。历史任务 OPT-FF2815CF71 仅在列表中出现，未计入本轮新运行。

## 2. 一维 Skill：真实求解、两条数值约束与绑定

在 Skill 服务列表自行找到“独立验收 教程一 时段供电成本 R3”，核对已有定义和 Agent 状态后，按 14.4C 在在线测试输入 `{"demand":[10,20],"cost":[2,3],"delta_t":0.5}` 并运行。

| 身份 | 实际值 |
| --- | --- |
| Skill | run_model_mvhwj971_q40p |
| 固定模型 | MODEL-97B90D47，v0.1 |
| 模型编码 | model_mvhwj971_q40p |
| 定义修订 / 绑定策略 | r1 / fixed |
| 定义 Hash | 7f3e915eee95f9e96d0602b961b5446e35761b54252f17f9a7ab1519ba957fd9 |
| 本轮调用 ID | INV-9E08239D47 |
| 本轮任务 ID | OPT-42E6251653 |
| 返回 | SUCCESS，HiGHS，optimal，objective_value=40，p={0:10,1:20} |

独立复算：10×2×0.5+20×3×0.5=40。两项成本系数为正，p≥需求，所以 p=[10,20] 达到可行下界并取得最小值。p 最小 10、最大 20、总和 30，均与页面一致。

通过 UI 的 EvidencePackage 和原始返回区滚动查看两条实际检查，不以自然语言摘要替代数值：

| 约束 | body / value | lower | upper | margin | violation | status / 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| con_满足时段需求_0_0_1 | 10 | 10 | null | 0 | 0 | binding；solution_evidence.constraints.0 |
| con_满足时段需求_1_0_2 | 20 | 20 | null | 0 | 0 | binding；solution_evidence.constraints.1 |

检查容差为 0.000001。解释显示“检测到 2 个触边约束”，并引用 constraint_checks.0 / .1；本次没有错误提示缺少约束明细。UI 原始返回中的模型证据显示 skill_definition_revision=1、skill_definition_hash 与上述定义一致。**本次未单独展开、逐字段核对整个 explanation_audit 对象**，不把这一全文审计核对写成通过。

关闭测试、重开详情后，调用记录新增 INV-9E08239D47、SUCCESS、2026-10-21 22:03:58；现有 Agent 包仍为 enabled / agent_enabled=true / validation valid。这里只证明既有包启用状态与非 LLM 的真实模型执行；没有配置真实 LLM 凭证，没有执行自然语言对话闭环。

证据：[09固定定义](manual-assets/2026-10-21-followup/independent/09-skill-fixed-definition-r1.jpg)、[10既有Agent状态](manual-assets/2026-10-21-followup/independent/10-skill-agent-existing-enabled.jpg)、[11真实返回](manual-assets/2026-10-21-followup/independent/11-skill-real-test-40.jpg)、[15约束数值](manual-assets/2026-10-21-followup/independent/15-skill-evidence-constraint-tail.jpg)、[18定义修订/Hash](manual-assets/2026-10-21-followup/independent/18-skill-definition-audit-r1.jpg)、[19调用记录](manual-assets/2026-10-21-followup/independent/19-skill-invocation-record.jpg)。12—17的其他滚动截图同目录保留。

## 3. 水电 availability：首次失败与修复后复验

对象为 MODEL-POWER-CASCADE-HYDRO-DISPATCH，界面版本 v1.1、4 点、15 分钟。通过任务向导“高级 JSON 输入”导入下列修改；其它业务参数保留模型默认值：

```json
{"availability":{"S1_U1":[1,1,1],"S1_U2":[1,0,0,1],"S2_U1":[1,1,1,1],"S3_U1":[1,1,1,1],"S3_U2":[1,1,1,1]}}
```

独立核对：模型要求每行 4 点；仅 S1_U1 为 3 点，恰少 1 点，其余四行均为 4 点。

首次“问题 1”提示为“机组可用状态（availability）时间维长度应为 4，当前为 3”，具有中文参数和长度信息，但**缺少具体 S1_U1 行定位**。[截图20](manual-assets/2026-10-21-followup/independent/20-hydro-missing-period-error.jpg)保留这一首次失败。按“前往处理”及该参数“恢复原值”后，问题归零、S1_U1 T4=1，进入“参数检查通过，可以提交求解”，见 [21恢复](manual-assets/2026-10-21-followup/independent/21-hydro-restored-valid.jpg)及 [22提交检查](manual-assets/2026-10-21-followup/independent/22-hydro-restored-submit-check.jpg)。

作者随后通知修复就绪；未提供产品操作指导。执行者重新打开同模型，使用完全相同缺点输入独立复验。此时提示为“机组可用状态（availability）[S1_U1]时间维长度应为 4，当前为 3”，同时具有具体机组、中文参数及实际/期望长度。[截图23](manual-assets/2026-10-21-followup/independent/23-hydro-row-error-after-fix.jpg)保留修复后结果。

再次按“前往处理”及“恢复原值”，看到问题 0、S1_U1 T4=1，再次进入 31 项有效业务参数、4 点、HiGHS、“参数检查通过，可以提交求解”。见 [24恢复](manual-assets/2026-10-21-followup/independent/24-hydro-row-restored-after-fix.jpg)及 [25提交检查](manual-assets/2026-10-21-followup/independent/25-hydro-valid-submit-after-fix.jpg)。之后取消向导；**未提交水电新任务，未验收本轮水电求解数值**。

## 4. 版本治理：既有资产的核对及未验收边界

按第 7、14 章从模型资产列表筛选“独立验收 教程五 曲线费用”，实际看到同一编码下两条资产：

| 稳定编码 | 模型 ID | 版本 / 状态 | 实际 UI 观察 |
| --- | --- | --- | --- |
| model_mvhxruag_f609 | MODEL-5F61FE23 | v0.2 / published | 正式服务；详情显示当前 model_id，说明 model_code 解析到当前活动已发布版本 |
| model_mvhxruag_f609 | MODEL-8FA60674 | v0.1 / offline | 已下线、未开放调用；详情说明仅作为历史基线保留 |

现有固定 Skill 的证据来自第 2 项：run_model_mvhwj971_q40p 的完整定义明确固定 MODEL-97B90D47 / v0.1，r1、Hash 和实际返回 ID 一致。它与曲线模型属于不同模型族；**不能把这两组独立观察拼成“同一模型升级后旧固定 Skill 保持绑定”的完整执行证明**。

本轮完成的是：当前正式版/旧历史版身份与状态核对，以及现有固定定义/实际执行 ID 核对。模型服务手册明确在线调试固定当前 model_id，外部 API 示例才采用 model_code；在禁止直接 API 调用且不重做发布的范围内，本轮没有验证按编码实际执行路由，也没有重新发布新版本、恢复旧版本或新建固定 Skill。完整发布切换和同族旧固定 Skill 对比执行保持未验收。

证据：[26同编码正式/下线两行](manual-assets/2026-10-21-followup/independent/26-existing-curve-family-versions.jpg)、[27当前正式版](manual-assets/2026-10-21-followup/independent/27-existing-formal-v02.jpg)、[28旧历史版](manual-assets/2026-10-21-followup/independent/28-existing-historical-v01.jpg)；09、18、19为上文已链接的现有固定Skill绑定、修订和执行记录。

## 证据位置与最终边界

所有本轮截图与 AX 界面 JSON 位于 `docs/manual-assets/2026-10-21-followup/independent/`。截图由原生 Chrome 截取，实际 JPEG 使用 `.jpg`；界面 JSON 为可见 AX 状态，长 JSON 数值另有滚动截图。

上轮工程结果、首次失败报告及源码没有读取或重新判定；本报告只给本轮实际观察结论。首次水电行定位问题与修复后通过明确分开。未验收范围包括真实 LLM 对话、完整 explanation_audit 全文、重新发布切换、按编码真实调用、同族旧固定 Skill 升级对比以及水电真实求解。本轮未进行删除、部署、外发或生产操作。测试结束关闭本轮新建的 Chrome 标签，保留用户其它标签。
