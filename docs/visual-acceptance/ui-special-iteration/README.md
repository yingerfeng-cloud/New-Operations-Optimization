# UI 专项迭代视觉验收证据

- 生成日期：2026-07-19
- 验收环境：Windows，前端 `http://127.0.0.1:5173`，后端 `http://127.0.0.1:8000`
- 页面路径：`/tasks`、`/models/MODEL-POWER-UNIT-COMMITMENT-DAY-AHEAD/edit`
- 测试数据：真实后端的日前机组组合模型；二维矩阵使用 P0 Mock E2E 的 `grouped` 合同，以避免改写真实模型资产。

## 交互验收结果

- 任务创建第二步：分组导航、运行数据摘要、错误 Drawer、批量粘贴均完成交互验证。
- 全屏矩阵：通过 P0 Mock E2E 打开二维矩阵聚焦编辑器并保存截图；测试随后完成矩阵粘贴和保存返回。
- 模型创建：第二步、第三步、检查 Drawer、精确问题定位和字段聚焦均完成验证。
- 聚焦编辑：脏状态退出显示“继续编辑 / 放弃修改 / 保存并退出”三路选择；放弃后恢复进入前上下文，`.main-content.scrollTop` 实测 `472 -> 472`。
- 390 px 下页面根节点无横向溢出；数据表在主内容区域内保留受控横向滚动。

## 截图清单

- `task-step2-1440.png`、`task-step2-390.png`
- `task-error-drawer-390.png`
- `task-batch-paste-1440.png`
- `task-fullscreen-matrix-1440.png`
- `model-step2-1440.png`、`model-step3-1440.png`
- `model-inspection-drawer-1440.png`
- `model-precise-issue-drawer-1440.png`、`model-precise-field-highlight-1440.png`
- `model-focus-editor-1440.png`、`model-focus-exit-confirm-1440.png`、`model-focus-exit-restored-1440.png`
- `responsive-{390,768,1024,1366,1440,1920}-model-step2.png`

## 响应式检查

| 视口 | document client/scroll | body client/scroll | 根页面溢出 |
| --- | ---: | ---: | --- |
| 390 × 844 | 390 / 390 | 390 / 390 | 否 |
| 768 × 1024 | 768 / 768 | 768 / 768 | 否 |
| 1024 × 768 | 1024 / 1024 | 1024 / 1024 | 否 |
| 1366 × 768 | 1366 / 1366 | 1366 / 1366 | 否 |
| 1440 × 900 | 1440 / 1440 | 1440 / 1440 | 否 |
| 1920 × 1080 | 1920 / 1920 | 1920 / 1920 | 否 |

## CSS 收口统计

- CSS 文件：19 -> 18
- CSS 行数：3139 -> 2625
- `!important`：93 -> 86
- 任务创建和模型创建页面选择器已从 `base.css` / `product.css` 迁移到页面样式；删除失效的 `task-create.css`。
