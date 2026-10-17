# 评审执行证据索引

- `manifest.json`：基线、附件 hash、实际依赖版本、最终测试统计和证据文件 hash。
- `math-before-fix.log`：修复前已知答案反例的失败记录。其失败证明原问题；最终行为由新回归及下列成功日志验证。
- `backend.log/xml`：常规后端回归，612 通过、5 项因本机无 Ipopt 跳过。
- `integration.log/xml`：159 项集成回归，包含 11 个模拟业务场景的公共 API 流程。
- `frontend-unit.log`、`frontend-build.log`：463 项前端回归及类型检查/构建。
- `browser.log`：真实 Chrome 的发布成功、长任务跟踪和结果恢复。三张 PNG 截图按用户要求仅保留在本地验收目录，不纳入远端提交。
- `docker-build.log`：本轮专用镜像 `optiforge-review:20261017` 的构建。
- `docker-image.json`、`docker-runtime.json`：最终镜像标识、架构及实际求解器/依赖版本。
- `docker-prepare.json`：官方入口、令牌策略、真实 Ipopt 样例、下线及合成 Key 保存。
- `docker-recreated-verify.json`、`docker-final-verify.json`：不同主机名及最终镜像下的同卷恢复验证。
- `docker-ipopt-tests.log`：最终镜像中的 9 项 NLP 相关测试全部通过。
- `synthetic-poc.log`：模拟场景执行顺序和预期状态。完整输入见 `../../tests/fixtures/review_20261017_poc.json`；实际解与独立复算见 `../review_20261017_poc/`。

所有模拟输入、测试 Key 和令牌均为本次隔离验收专用，未使用实际客户数据或真实 LLM 服务。

日志仅清理行尾空白和文末空行以便 Git 检查；被格式化文件的原始 hash 另存于 `manifest.json` 的 `log_formatting.original_sha256`，测试内容和结果未变。
