"""Canonical decision-variable identifiers shared by result contracts."""
from copy import deepcopy
from typing import Any

from app.model_dimensions import extract_dimensions, validate_dimension_field_consistency


def normalize_variables(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    seen: set[str] = set()
    for raw in rows or []:
        identifiers = {str(raw[field]).strip() for field in ("math_var", "code", "key") if raw.get(field)}
        if len(identifiers) > 1:
            raise ValueError(f"Conflicting variable identifiers: {sorted(identifiers)}")
        key = next((str(raw[field]).strip() for field in ("math_var", "code", "key", "name") if raw.get(field)), "")
        if not key:
            raise ValueError("Variable identifier is required")
        if key in seen:
            raise ValueError(f"Duplicate variable identifier: {key}")
        if validate_dimension_field_consistency(raw, path=key):
            raise ValueError(f"Conflicting variable dimensions: {key}")
        seen.add(key)
        result.append({**deepcopy(raw), "key": key, "name": str(raw.get("name") or key), "dimension": extract_dimensions(raw)})
    return result
