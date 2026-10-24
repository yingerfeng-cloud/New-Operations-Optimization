# OptiForge 柔光瓷白正式验收

日期：2026-10-25。使用 `frontend/dist` + 真实 FastAPI + HiGHS；服务监听本地 8110，运行存储独立于项目数据。截图来自正式应用，没有原型工具栏和模拟接口。完整结论、测试结果及边界见 [frontend/design-qa.md](../../../frontend/design-qa.md)。

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

每页各有 `前缀-1626.png` 与 `前缀-1280.png`。`pages.json`、`pages-1280.json` 保存页面测量：字体、统计标题字号、外层圆角裁切、顶栏及内容溢出、原型工具栏缺席。首页包含真实测试产生后的任务，其他基础截图也覆盖无任务、无结果等初始状态。

## 交互证据

- `template-dialog-official.png`：正式模板选择，单张摘要卡，无外层套框，使用实际元数据。
- `formula-dialog-1626.png`、`formula-dialog-1280.png`：真实模型公式编辑。弹窗居中、操作区在视口内，预览默认 36px，编译提示 38px；两种说明键盘展开后底部操作仍可见。
- `task-runtime-1626.png`：实际任务参数与校验步骤。
- `real-solve-success.png`：实际 HiGHS 任务 `OPT-8C0370F648` 成功。
- `real-result-report.png`、`result-tab-metrics.json`：该任务的报告与六标签指标测量，位置和宽度变化 0px。
- `service-debug-success.png`：已有已发布模型的在线调试任务 `OPT-6B5FC58C51` 成功。
- `interaction-checks.json`：实际操作结果与未执行的发布边界。
- `cleanup.json`：原型及临时文件清理清单，统计文件逻辑字节数，不计文件系统压缩、快照及 Git 历史。

## 结论与范围

前端 91 个测试文件 / 511 项通过；后端默认非 slow 集合合计 725 项通过、5 项跳过（两项 socket 用例解除本地沙箱绑定限制后重跑通过）；生产构建通过。正式页面的样式与用户认可的柔光瓷白视觉系统保持一致，已检查状态未发现残留的控件重叠、圆角穿出或不可达操作区。

模型正式发布的最终界面确认被自动审批拦截并已取消，没有绕过执行。当前本机没有可用 Ipopt，LLM 关闭，因此未覆盖真实 NLP、外部 LLM 和长时压力测试。这份记录是实际覆盖范围的验收，不承诺穷尽所有业务状态。

旧原型代码与过程证据按用户要求清理；正式实现以 `frontend/src/app/theme.ts`、共享 tokens、组件与页面样式为后续维护依据。
