from __future__ import annotations

from typing import Any


def map_business_parameters(semantic_spec: dict[str, Any], parameters: dict[str, Any]) -> dict[str, Any]:
    source = parameters or {}
    mapped = dict(source)
    if not semantic_spec:
        return mapped
    for item in semantic_spec.get("parameters", []):
        if not isinstance(item, dict):
            continue
        business_key = item.get("key") or item.get("code") or item.get("name")
        math_param = item.get("math_param") or item.get("mapped_to") or item.get("code")
        if business_key in source and math_param:
            mapped[str(math_param)] = source[business_key]
        elif math_param and math_param not in mapped and "default_value" in item:
            mapped[str(math_param)] = item["default_value"]
    return mapped


def semantic_spec_to_template_dict(semantic_spec: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": semantic_spec.get("model_code") or semantic_spec.get("code"),
        "scenario": semantic_spec.get("model_code") or semantic_spec.get("scenario"),
        "sets": semantic_spec.get("sets", []),
        "parameters": semantic_spec.get("parameters", []),
        "variables": semantic_spec.get("variables", []),
        "constraints": semantic_spec.get("constraints", []),
        "objectives": semantic_spec.get("objectives", []),
    }
