# 本轮锁文件依赖扫描核对

扫描前锁文件 SHA-256：`2d6c7bc49394675ab6e82bd6429bdb089fe2e51865d2f04d6397a96e3a0fa07c`。

扫描后锁文件 SHA-256：`027e4be6fa4971c94b4a3898c5fa733dacc11bb6c78c2666871bf8e67894cbcd`。

原始扫描时间及版本记录在 `reports/iteration-20261021/audit-before-metadata.json`（Node 22.23.2 / npm 10.9.8）。修补后同环境和 CI 精确 Node 22.17.0 / npm 10.9.2 均实际复扫为 0；CI 环境观测时间为 `2026-10-21T03:28:37.286Z`。另执行新增审计脚本本身，在本机 Node 24 也为 0。

| audit 依赖项 | 锁定版本与公告 | 本项目影响判断 | 处理 |
|---|---|---|---|
| follow-redirects（传递依赖） | 1.16.0；[跨域凭证剥离绕过](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8)、[敏感头正则转义](https://github.com/advisories/GHSA-8r9p-f939-6h3c)，公告补丁 1.16.1 | 由 Axios 1.20.0 的 Node HTTP 适配器引入。实际检查 Axios browser 映射将该适配器替换为 null，当前生产前端为静态构建、业务后端为 Python。静态构建未找到相关字符串，不据此作完整不可利用证明。 | 更新到 1.16.1；保留 Axios 版本 |
| Vite（直接开发依赖） | 7.3.5；[Windows 文件存在性绕过](https://github.com/advisories/GHSA-587h-7wmj-h5pm)、[百分号转义](https://github.com/advisories/GHSA-698v-4r3x-3vcv)、[编辑器 CLI 标志解释](https://github.com/advisories/GHSA-r825-w8mm-5pxw)，7.x 补丁为 7.3.7 | 属开发服务器/打开编辑器路径；官方静态 dist 托管没有该开发路由。未做攻击验证，不把 npm 摘要升级成已证实生产漏洞。开发环境也需要补丁。 | 更新到 7.3.7；package 最低版本为 ^7.3.7 |

“2 high”是 npm 汇总的两个依赖包条目，详细 JSON 含多条公告，不等于两个已确认生产攻击。没有运行 `npm audit fix --force`。package-lock 实际变化仅根条目声明和上述两个包，见 `audit-package-changes.json`；`patch-install.log` 保留更新输出。

`dependency-impact-evidence.json` 保存当前 Axios browser 路径及 58 个实际构建文件的字符串检查范围。这是静态可达性线索，不是渗透测试。修补后又在 Node 22.17.0 执行 npm ci、构建及 485 项前端单元；React 和路由依赖的主版本保持原样。

持续检查使用 `scripts/audit_frontend_dependencies.mjs`，保存完整 JSON、运行时间、实际 Node/npm、锁 hash 与退出状态；网络或响应错误不记通过，高危/严重项返回非零。这里的 0 仅代表所记录时间与具体锁文件的审计结果，不能承诺未来公告永远为零。
