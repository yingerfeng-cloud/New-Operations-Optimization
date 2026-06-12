from __future__ import annotations

from typing import Any, Callable


def resolve_shifted_reference(
    ref_getter: Callable[[int], Any],
    t: int,
    offset: int,
    fallback: Any = None,
    fallback_key: Any = None,
):
    shifted_t = t + offset
    if shifted_t < 0:
        if fallback is None:
            raise RuntimeError(f"时间引用越界：t={t}, offset={offset}，且未提供 fallback。")
        if fallback_key is not None:
            if fallback_key not in fallback:
                raise RuntimeError(f"时间引用越界 fallback 缺失：{fallback_key}")
            return fallback[fallback_key]
        return fallback
    return ref_getter(shifted_t)
