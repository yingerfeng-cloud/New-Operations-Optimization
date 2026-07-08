# 函数资产与 PWL 指南

水电演示资产：

- `cascade_hydro_level_storage_v1`：水位库容曲线。
- `cascade_hydro_tailwater_outflow_v1`：尾水位流量曲线。
- `cascade_hydro_power_surface_v1`：水电出力二维曲面。

2D Preview 返回：

- `z`：插值输出。
- `triangle`：命中的二维曲面三角面片。
- `lambda`：当前点在三角形三个顶点上的插值权重。

后端未返回 triangle/lambda 时，前端显示“当前未返回该项”，不编造数据。
