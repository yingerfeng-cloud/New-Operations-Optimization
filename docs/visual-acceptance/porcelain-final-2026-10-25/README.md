# OptiForge 柔光瓷白正式验收

日期：2026-10-25。使用 `frontend/dist` + 真实 FastAPI + HiGHS；服务监听本地 8110，运行存储独立于项目数据。截图来自正式应用，没有原型工具栏和模拟接口。主页面截图已由用户容器反馈后的补充修复版本重新捕获，历史求解与报告截图保留为上一轮证据。完整结论、测试结果及边界见 [frontend/design-qa.md](../../../frontend/design-qa.md)。

## PC 页面覆盖

视口为 1626 × 876、1280 × 876 CSS px；图像像素与 CSS 像素为 1:1。1280px 下主动展开侧栏，按较小电脑窗口检查。页面处于专家视图。

| 路由 | 截图前缀 |
| --- | --- |
| `/` | home |
| `/scenarios` | scenarios |
| `/models` | models |
| `/models/create?mode=new` | model-create |
| `/tasks` | tasks |
| `/results` | results |
| `/components` | components |
| `/functions` | functions |
| `/services` | services |
| `/skills` | skills |
| `/runtime` | runtime |
| `/settings` | settings |
| `/agents` | agents |

每页各有 `前缀-1626.png` 与 `前缀-1280.png`。`pages.json`、`pages-1280.json` 保存页面测量：唯一顶栏标题、20px 标题字号、正文重复页头数量、标题截断、顶栏间隔、横向溢出与正文初始滚动。26 项检查无失败；当前隔离数据也覆盖无任务、无结果的状态。

## 交互证据

- `template-dialog-official.png`：正式模板选择，单张摘要卡，无外层套框，使用实际元数据。
- `formula-dialog-1626.png`、`formula-dialog-1280.png`：真实模型公式编辑。弹窗居中、操作区在视口内，预览默认 36px，编译提示 38px；两种说明键盘展开后底部操作仍可见。
- `task-runtime-1626.png`：实际任务参数与校验步骤。
- `real-solve-success.png`：实际 HiGHS 任务 `OPT-8C0370F648` 成功。
- `real-result-report.png`、`result-tab-metrics.json`：该任务的报告与六标签指标测量，位置和宽度变化 0px。
- `service-debug-success.png`：已有已发布模型的在线调试任务 `OPT-6B5FC58C51` 成功。
- `interaction-checks.json`：实际操作结果与未执行的发布边界。
- `creation-method-template-1280.png`、`creation-mode-checks.json`：单选组在鼠标和方向键切换时宽度、位置与滚动均保持一致，只有模板模式显示选择器。
- `followup-checks.json`：从已滚动场景页进入建模回到顶部；中文模板搜索与真实载入通过；包含正式资源名及控制台结果。
- `cleanup.json`：原型及临时文件清理清单，统计文件逻辑字节数，不计文件系统压缩、快照及 Git 历史。

## 结论与范围

本轮前端 93 个测试文件 / 526 项通过；后端正式前端托管 2 项通过；生产构建和静态交付检查通过。上一轮默认非 slow 后端集合合计 725 项通过、5 项跳过，保留原始摘要。正式页面的样式与用户认可的柔光瓷白视觉系统保持一致，已检查状态未发现残留的控件重叠、圆角穿出或不可达操作区。

模型正式发布的最终界面确认被自动审批拦截并已取消，没有绕过执行。当前本机没有可用 Ipopt，LLM 关闭，因此未覆盖真实 NLP、外部 LLM 和长时压力测试。这份记录是实际覆盖范围的验收，不承诺穷尽所有业务状态。

补充验收修正了上一轮没有覆盖的跨菜单页头推广、进入建模的滚动位置以及模式切换闪动；当前所有菜单已应用共享标题。旧原型代码与过程证据按用户要求清理；正式实现以 `frontend/src/app/theme.ts`、共享 tokens、组件与页面样式为后续维护依据。

## 首页趋势补充

`home-1626.png`、`home-1280.png` 已更新为顶部摘要、中间绘图区、底部图例的正式布局。`trend-rate-100-30days-1626.png` 覆盖 30 天高位标签；`trend-rate-0-1280.png` 同时覆盖 0% 和长耗时摘要。此组截图使用隔离运行存储中预置的展示验收任务记录，未写入用户数据，也不作为新增真实求解的证明。

`trend-checks.json` 记录两种宽度 × 三个时间范围：摘要溢出为 0，左右卡片上下边缘差为 0px。23 项定向测试及正式构建通过；图例筛选、日期提示和键盘说明均经浏览器检查。完整前后端测试沿用前述上一轮记录，本次未重复执行。

最终复核：随后针对功能提交 `2650483` 补跑完整前端集合，94 个文件 / 547 项全部通过，摘要已追加至 `verification.txt`。主页面矩阵与全部主菜单相符，共享主题和页头不依赖原型开关。动态详情、所有弹窗及异常数据组合未穷尽，范围见 `frontend/design-qa.md`。
