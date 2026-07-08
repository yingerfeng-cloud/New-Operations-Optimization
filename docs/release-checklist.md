# P4 发布检查清单

- Dashboard 展示平台能力矩阵、Ipopt 状态和两个标杆入口。
- 模型中心展示三个标杆模型的演示说明。
- 函数资产中心展示水电演示资产和 2D 曲面诊断。
- 模型创建 Step5 区分 LP/MILP、PWL/McCormick、NLP、MINLP_RESERVED。
- 模型服务接口按模型类型生成样例请求并展示增强调试返回。
- 任务中心支持 NLP 默认 Ipopt。
- 结果中心展示水电解释和 NLP 解释。
- Agent 能回答水电和 NLP 固定演示问题。
- 报告服务不写死 HiGHS。
- 打包排除 `artifacts`、`logs`、`frontend/node_modules`、`frontend/dist`、测试报告和缓存目录。
