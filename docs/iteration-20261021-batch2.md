# 2026-10-21 增量第二批：执行追溯、业务对比与能力边界

承接第一批 `ec4264a`，继续基于附件第 6、7、9 节。本批没有新增原生 QP/MIQP 后端，也没有推送、合并或部署。

## 实际行为

R-COMP-02：每次真实执行记录平台 Git HEAD 与产品源码修改状态、磁盘源码 hash、实际已加载 Python code object hash、编译器文件指纹、内置组件类/模块、Python/系统/包版本、实际 HiGHS 二进制或 Ipopt 可执行文件指纹、适配器及请求/实际下发设置。未取得的信息标为 unknown。HiGHS 的 presolve 没有被适配器显式设置，清单如实记录 solver default，不把请求布尔值冒充实际生效选项；Ipopt 记录适配器实际采用的容差默认与选项映射。没有引入旧镜像恢复平台，当前进程无法可信取得的 image digest 明确未知。

`POST /api/tasks/{id}/replay` 支持明确的 `mode=current_kernel/original_environment`。默认兼容路径创建新的当前内核计算任务，冻结定义/输入保持不变，保留来源与原结果；页面名称改为“当前内核按历史输入重算”。请求原环境重放时返回 `ORIGINAL_ENVIRONMENT_UNAVAILABLE`，不以相同 hash 假装恢复旧镜像。失败重试在原 attempt 归档实际环境后，另行记录本次实际环境。原模型下线与普通调用限制保持。

R-UX-01：组件与函数更新共用“新旧业务结果对比”。服务端冻结源测试的输入、设置与业务证据，候选重用这些输入和设置。表格展示模型声明指标、实际决策的坐标/单位/数值/差值，以及约束的原新边界、约束值和违反量。输入或求解设置不同、单位未知或指标定义变化时禁止推导改善；无旧证据明确说明，无旧物理量不会用当前计算伪造。加权目标差值不自动解释为经济收益。页面仍检查候选模型、内容 hash 和测试凭据，恢复不能绕过门槛。

同步 `/test` 也复用现有运行准备阶段的参数检查，执行并记录实际 solver_config，清除过时异步测试任务标识。原有生命周期回归之前仅提交 horizon，依赖同步路径偷偷补示例；现明确提供同一组既有合成负荷/成本/容量，保留全部不可变/发布门槛断言并增加独立目标 3800 的检查，没有放宽生产入口。

QP/MIQP：移除虚假的 HiGHS 推荐，保留问题识别；正式路由（含显式 Ipopt）继续拒绝原生 QP/MIQP。统一状态 API 支持矩阵、公式诊断、配置页、模型发布页、进度文字及 NLP 文档。独立后续范围及验收见 `docs/solver-capabilities.md`，本批未实现该后续方案。

依赖扫描：Node 22.23.2 与 CI 精确 Node 22.17.0 均实际执行。原锁文件扫描为两个 high 依赖包；审查后只更新 Vite 7.3.5→7.3.7、follow-redirects 1.16.0→1.16.1，没有升级主版本，没有运行 audit fix --force。两种 Node 22 复扫均为零。详细时间、锁 hash、JSON、影响判断见 `docs/iteration-20261021-dependency-impact.md` 和 `reports/iteration-20261021/`。CI 新增同一审计脚本，扫描不可用会失败并保留证据，高危/严重项阻断；不会把 npm ci 摘要当详细分析。

## 本批实际执行与证据等级

| 类型 | 命令/结果 | 证据 |
|---|---|---|
| 本轮后端完整默认回归，真实 ASGI 路由及 HiGHS | `.venv-mac/bin/python -m pytest -q`，709 passed、5 skipped | `final-backend-verified.log` |
| 最后坐标显示修正后的关键合同 | 组件、参数、追溯/对比、既有 I-01/I-03/恢复，51 passed | `final-acceptance-contracts.log` |
| 本轮 Node 24 前端完整默认单元 | `npm run test:unit`，88 files、485 passed | `batch2-frontend-full.log` |
| CI 精确 Node 22.17.0，Linux arm64 独立容器 | npm ci、npm run build、npm run test:unit；485 passed | `node22-receipt.json`、`node22-unit.log`、`source-hashes.json` |
| 最终页面与类型回归 | 25 passed；最终 TypeScript 通过 | `final-frontend-targeted.log`、`final-typecheck.log` |
| 真实浏览器、HTTP、异步任务、真实 HiGHS | 两条完整浏览器流程，2 passed | `final-browser-verified.log`、`live-acceptance.json` |
| 静态交付/持续检查 | verify_test_matrix.py 通过 | `final-test-matrix.log` |
| 外部注册表核查 | npm audit 完整 JSON 与锁 hash，0 项 | `audit-*-node22*.json`、`audit-after*.json` |

所有上表证据均为本轮新执行，不与旧报告的 685/482 或历史 CI run 相加。ASGI API 测试不是公网部署测试；浏览器连接独立 uvicorn/Vite 实例，没有 mock 求解。对比纯函数/页面单元含明确替身，只证明单位/输入不一致、缺证据、过期凭据等分支；真实数值由实际 API 和 HiGHS 验证。

独立答案：两期供给下限为 10、单位正成本 3，原版本目标 60；C2 下限 12，目标 72；C3 下限 15，目标 90。约束下界和变量均逐项核对，残差为零。声明的供给电量指标为 20→24 MWh，决策为 10→12 MW。组件更新保留未选择函数 r1 的用例为 24，而非采用新函数后的 96。函数曲线在固定 x=10 时为 10→20，页面同时核对单位和物理值。没有用被测计算函数生成这些期望。

## 失败记录与修复范围

早期日志原样保留，不能当作最终通过。包括 TypeScript 缺少 Typography 导入、同步入口收紧后暴露的旧生命周期用例缺必填输入，以及一轮浏览器数值断言早于异步任务完成。后者任务实际 SUCCESS、耗时 17 秒，原失败运行态和 trace 在本地保留；测试改为等待服务端终态，再核对独立目标 20、变量和零残差，原 15 秒 UI 断言与 180 秒总测试预算保留。没有修改数值容差或跳过失败。最后实际复测 2 passed。

## 兼容与未验证范围

旧结果和缺失的历史环境不补造；旧任务没有可信组件清单时不能历史执行，旧模型需明确创建当前版本、选取合法依赖并重新测试。旧结果没有完整物理证据时只显示不可比。执行记录中测试时 HEAD 为此前提交、修改状态为 true，这是当时实际环境；用源码指纹对应验证内容，不回填未来 commit。

本批未重跑外部收费 LLM、未构建完整平台交付 Docker 镜像、未执行原环境严格复现、客户真实数据、一般容量/长期性能、生产部署、Windows 运行环境认证。Node 容器验证不是整个平台 Docker 验收。5 个跳过项保留，不能计为通过。构建仍有既有 chunk 提示，部分页面单元有框架 act/Ant Design 警告，原始日志保留。没有新 push，GitHub Actions 本轮 job 尚未在云端执行，不将配置完成写成云端已通过。
