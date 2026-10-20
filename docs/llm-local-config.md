# 本机火山引擎配置与持久化

2026-10-20 在 `docker-data/runtime_store.json` 找到原火山引擎配置和旧密文。Docker Compose 将这个目录挂到 `/app/data`；本机原生启动默认使用 `data/runtime_store.json`，两者是不同运行态。只检查后者找不到配置，不能据此判断设置页未保存。

原密文为绑定主机、用户名及数据路径的旧 XOR 格式，在当前原生环境及现存已停止容器的标识下均未能恢复；没有以猜测值覆盖旧 Key。原文件已先备份到本机忽略目录 `reports/review_20261020_local/runtime-before-user-key.json`。用户重新填写 Key 后，真实火山引擎 Function Calling 探测通过，再只更新原文件的 `llm_config`，其他模型、任务、结果、会话和服务绑定均逐项确认未变。

## 日常使用

1. 本机编辑 `docker-data/llm.local.json`，填写 `api_key`，保留实际供应商、地址和模型标识。该文件只存在本机，权限 0600；仓库仅提交空 Key 的 `config/llm.local.example.json`。
2. 使用本批代码运行服务，在“系统设置 → 大模型配置”核对“持久化文件”和“本机配置文件”，点击“从本机配置文件导入”，再“测试连接”。本轮用户填写的 Key 已实际导入并完成加密持久化。
3. 文件不会后台反复覆盖设置。导入后的设置页修改继续权威生效；再次编辑文件后须明确导入。API 为 `POST /api/llm/config/import-local`，仍受现有 API 认证保护。错误文件不会清空已有配置，API 不返回明文 Key。

Docker 下默认文件为 `/app/data/llm.local.json`，即宿主机 `docker-data/llm.local.json`。原生运行默认文件与所选运行态同目录，也可用 `OPTIFORGE_LLM_CONFIG_FILE` 指定本机文件。需要原生运行使用 Docker 数据时，应明确设置 `RUNTIME_STORE_PATH` / `OPTIFORGE_RUNTIME_STORE` 为同一个绝对路径，并停止同时使用该文件的另一服务；平台不会自动切换目录。

## 备份和迁移

同时保留 `runtime_store.json` 和同目录隐藏文件 `.optiforge-config-secret`。若部署设置了 `OPTIFORGE_CONFIG_SECRET` 或 `OPTIFORGE_CONFIG_SECRET_FILE`，则须保留原值或对应文件。新格式为 Fernet，重建容器不会因主机名变化而改变解密材料。本轮已在新建、禁网、只读挂载数据卷的容器中验证可解密；未重建或启动原服务容器。

旧 XOR 仅可在原主机、用户和路径材料仍可验证时迁移；材料未知时重新填 Key，不能承诺恢复。缺失 Fernet Secret 时也须恢复原 Secret 或重新填 Key，不能另建随机 Secret 后宣称原 Key 已恢复。

本机 JSON、运行数据、Secret、备份及截图均不进入 Git。Docker 构建和交付包排除本机 Key 文件与 Secret。现有打包脚本本轮未执行。
