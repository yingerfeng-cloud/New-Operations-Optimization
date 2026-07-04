# 组件化 Builder 使用说明

本文说明 React 正式前端中的组件管理与组件化模型创建。旧版 `HTML 原型入口` 已下线并删除，不再作为操作入口。

## 1. 启动

开发模式：

```powershell
# 终端 1
$env:PORT='8000'
.\.venv\Scripts\python.exe server.py

# 终端 2
cd frontend
npm run dev
```

访问：

- React：`http://localhost:5173`
- API：`http://localhost:8000/api`

生产模式先在 `frontend/` 执行 `npm run build`，然后访问 `http://localhost:8000/`。

## 2. 组件库

访问 `/components`。列表展示组件名称、编码、分类、领域、状态、启用状态、实现状态与版本。

可执行操作：

- 查看：打开组件详情。
- 编辑：维护组件基础信息与定义。
- 校验：调用 `/api/components/{id}/validate`。
- 发布：校验通过后发布组件。
- 复制版本：生成独立的新版本草稿。
- 停用：关闭组件启用状态。

## 3. 组件详情

详情页按产品化面板展示：

- 基础信息
- `required_sets`
- 参数与参数绑定
- 变量
- 生成约束
- 生成目标项
- 依赖关系
- 校验结果

参数绑定表包含参数编码、名称、数据来源、是否必填、默认值、单位、示例值和绑定状态。

依赖面板会区分可用与缺失依赖。缺失依赖是发布阻断项，不能通过隐藏错误或只修改前端状态绕过。

## 4. 创建组件

1. 在组件库点击“新建组件”。
2. 填写组件名称、编码、分类、领域和版本。
3. 配置集合、参数、变量、约束、目标项、参数绑定与依赖。
4. 保存草稿。
5. 执行校验。
6. 修复所有错误和缺失依赖。
7. 发布组件。

已发布且被模型引用的组件不应直接破坏性修改，应使用“复制版本”建立新版本。

## 5. 创建组件化模型

访问 `/models/create`：

1. Step 1 选择“组件化 Builder”。
2. 可选择组件化内置模板初始化 ModelDraft。
3. Step 2 检查组件回写的集合、参数与变量。
4. Step 3 查看组件生成的约束、目标项和依赖校验。
5. Step 4 维护运行时参数与参数来源。
6. Step 5 执行语义、依赖、绑定、问题类型和求解器兼容性校验。
7. 校验通过后发布或测试运行。

组件草稿最终保存到 `component_spec.components`。后端仍由 `ComponentModelBuilder` 与组件注册表构建 Pyomo 模型。

## 6. 时间集合约定

调度模型统一使用：

```text
time        = 调度时段，长度 horizon
time_volume = 状态时点，长度 horizon + 1
```

储能 SOC、梯级水电库容等状态变量通常使用 `time_volume`；区间功率、流量和成本通常使用 `time`。

## 7. 梯级水电样例

内置模板 `cascade_hydro_dispatch` 使用组件化 Builder。

操作：

1. 进入模型资产中心。
2. 点击“从模板克隆”。
3. 选择梯级水电模板。
4. 查看模型的 `component_spec` 与运行参数。
5. 发布并执行测试。
6. 在任务中心查看求解状态，在结果报告库查看出力、发电流量、弃水和库容变化。

后端回归入口：

```powershell
python -m pytest `
  tests/test_component_builder_e2e.py `
  tests/test_component_based_hydro_model.py -q
```

## 8. 光储样例

组件化光储模板包括容量配置、日前调度、日内调度及 V2 版本。结果建议关注：

- 光伏利用率与弃光量
- 电池充放电
- SOC 曲线
- 偏差成本
- 收益/成本拆解

回归入口：

```powershell
python -m pytest tests/test_pv_storage_v2_acceptance.py -q
```

## 9. 关键约束

- 不在前端复制后端组件构建逻辑。
- 不允许缺失依赖的组件发布。
- 不允许组件 validate 抛出未处理异常。
- 模型 publish 前必须完成组件依赖与参数绑定校验。
- 组件生成公式与自定义公式均应进入 ModelDraft。
- 组件功能只进入 React 工程；legacy prototype 前端已下线。

代码入口见 `docs/engineering-map.md`，测试命令见 `docs/iteration-test-entrypoints.md`。
