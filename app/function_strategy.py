"""Effective one-dimensional strategies; legacy names retain existing exact solves."""


def effective_1d_strategy(value: str | None) -> str:
    return "segment_binary" if value in {None, "", "convex_combination_lp", "binary_segment_milp"} else str(value)
