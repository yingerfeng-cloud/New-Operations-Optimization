# production-quality CI 修复记录

关联失败运行：https://github.com/yingerfeng-cloud/New-Operations-Optimization/actions/runs/37181693770

失败提交：`921c6a8e56d7439d169d3298ee0a136810696d8e`。该次运行的前端类型检查、构建、单测和后端契约 Job 已通过；失败发生在 Delivery Package Self Check 和 Mock E2E。

## 根因与修改

| 失败节点 | 根因 | 修改文件与保留的检查 |
| --- | --- | --- |
| Delivery Package Self Check | 打包脚本只统计根目录非自身的 `.ps1` 文件，仓库实际交付入口为 `start.sh`、`stop.sh` 和 Finder `.command` 入口 | `package.ps1` 按支持的平台识别完整启动/停止配对，附带现有 Finder 入口；不再将任意两个脚本视为有效配对。保留压缩前和解压后的必需文件检查，并统一排除匹配中的路径分隔符。 |
| browser_acceptance_round | 已发布场景模型的创建入口进入版本模式，旧断言仍期望模板模式 | 对版本 URL、页面标题和源模型名称逐项断言。 |
| demo_cascade_hydro_delivery | Agent 工作台标题是卡片文本，旧断言要求 heading 角色 | 检查确切工作台文本和可用的消息输入框。 |
| p0-contract-closure：周期步长 | 缩短周期需要确认，旧测试未完成确认流程就检查校验消失 | 明确断言确认弹窗出现、点击“截断并切换”、弹窗关闭、周期为 24，并进入提交前检查页。 |
| p0-contract-closure：收敛图 | 图表可访问名称已将 Gap 改为“最优间隙” | 使用当前完整名称，继续检查真实 canvas 和重放期间按钮禁用。 |
| p1-business-experience | 时间标签夹具没有声明自动生成标签，默认手动标签不应被解释成 HH:mm | 夹具显式声明 `label_generation: 'auto'`，打开时间序列分组后检查 HH:mm，同时保留初始状态标签检查。 |
| scenario_to_model_creation | 场景入口模式断言过时；公共 mock 缺少源模型详情，版本草稿无法完整加载 | `fixtures.ts` 为模型列表和 `/api/models/m2` 共用完整源模型。分别覆盖发布模型新版本、场景空白模型、显式后端模板，检查场景、构建方式、参数和变量。 |

前端修改均在上述 E2E 文件及公共测试夹具中；没有修改产品路由、权威编译校验、发布门槛或参数校验来适配旧断言。

## 本地验证

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，生成真实 `dist` |
| 五个受影响的 Mock E2E 文件定向运行 | 19 passed |
| `npm run test:e2e:mock` 默认配置完整运行 | 41 passed，覆盖全部 20 个 Mock spec |
| 两项既有打包排除契约 Python 测试，`-n 0` | 2 passed |
| `scripts/verify_test_matrix.py` | 通过：77 个前端单测文件、20 个 Mock / 4 个 Real spec、109 个后端测试文件、19 张视觉证据及 README |
| `git diff --check` | 通过 |

## Windows 交付包验证

新增 `scripts/verify_delivery_package.ps1`，在隔离临时目录中实际执行 `package.ps1` 并读取 ZIP，而非复刻打包逻辑来生成测试结果。`.github/workflows/ci.yml` 的 Windows Delivery Package Self Check Job 在打包真实仓库之前执行该脚本；任一案例失败即阻止后续交付包产出。

覆盖 8 个案例：POSIX 与 Finder 配对、PowerShell 配对、两平台同时存在；拒绝缺少停止入口、只有两个无关脚本、第二平台入口不完整、Finder 缺少 POSIX 配对以及缺少必需源文件。成功案例还验证必需文件和全部入口进入 ZIP、运行数据和构建缓存被排除、源运行数据保持原值。

最终远端验收以本次修复提交触发的 GitHub Actions 运行及 Windows 脚本输出为准。未将本地 Python 的静态契约检查记录为 PowerShell 实际打包成功。
