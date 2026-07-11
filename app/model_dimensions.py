from __future__ import annotations

from typing import Any


DIMENSION_FIELDS = ("dimension", "dimensions", "indices", "index_sets")


def extract_dimensions(item: dict[str, Any]) -> list[str]:
    """Return the first declared dimension list in a normalized form."""

    for field in DIMENSION_FIELDS:
        if field not in item:
            continue
        dimensions = _normalize_dimension_value(item.get(field))
        if dimensions:
            return dimensions
    return []


def validate_dimension_field_consistency(
    item: dict[str, Any],
    *,
    path: str,
) -> list[dict[str, Any]]:
    declared = {
        field: _normalize_dimension_value(item.get(field))
        for field in DIMENSION_FIELDS
        if field in item and _normalize_dimension_value(item.get(field))
    }
    unique = {tuple(value) for value in declared.values()}
    if len(unique) <= 1:
        return []
    return [{
        "field": path,
        "error": "dimension_fields_conflict",
        "message": "同一结构中的 dimension/dimensions/indices/index_sets 定义不一致。",
        "expected": "所有维度字段表达相同且有序的集合列表",
        "actual": declared,
    }]


def _normalize_dimension_value(value: Any) -> list[str]:
    values = [value] if isinstance(value, str) else value if isinstance(value, (list, tuple)) else []
    result: list[str] = []
    for entry in values:
        if isinstance(entry, str):
            code = entry.strip()
        elif isinstance(entry, dict) and isinstance(entry.get("set"), str):
            code = entry["set"].strip()
        else:
            continue
        if code and code not in result:
            result.append(code)
    return result
