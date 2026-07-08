# 非线性能力边界

已开放：

- NLP / Ipopt：连续变量非线性模型真实求解。
- 1D/2D PWL：将曲线或曲面映射线性化为 LP/MILP。
- McCormick：用于双线性关系松弛。

未开放为生产级能力：

- `MINLP_RESERVED`：含整数变量和非线性表达式的模型。

口径要求：

- 不把 Ipopt 结果描述为全局最优。
- 不把 `MINLP_RESERVED` 包装成生产级能力。
- Ipopt 不可用时必须返回明确不可用提示。
