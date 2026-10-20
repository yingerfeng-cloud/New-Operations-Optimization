"""The input layout shared by schema consumers and the runtime validator.

An explicit type remains authoritative. Untyped indexed values only admit
positional arrays when their axes are known; mappings always use business keys.
This module does not resolve coefficients or infer an axis from unrelated sets.
"""
from copy import deepcopy
from typing import Any

from app.model_dimensions import extract_dimensions


def parameter_input_contract(param: dict, sets: dict[str, list]) -> dict:
    dimensions = extract_dimensions(param)
    validation = param.get("validation") or {}
    declared = str(validation.get("type") or param.get("type") or param.get("param_type") or "").lower()
    declared = {"list": "array", "object": "dict", "float": "number", "int": "integer"}.get(declared, declared)
    sample = param.get("sample_value", param.get("sample", param.get("default_value", param.get("default"))))
    if declared in {"number", "integer", "string", "boolean", "array", "dict"}:
        formats = [declared]
    elif dimensions:
        formats = ["dict", "array"] if all(sets.get(axis) for axis in dimensions) else ["dict"]
    else:
        formats = ["array" if isinstance(sample, list) else "dict" if isinstance(sample, dict) else "string" if isinstance(sample, str) else "boolean" if isinstance(sample, bool) else "number"]
    examples = {}
    if sample is not None:
        kind = "array" if isinstance(sample, list) else "dict" if isinstance(sample, dict) else "number"
        if kind in formats:
            examples[kind] = deepcopy(sample)
        if len(dimensions) == 1 and sets.get(dimensions[0]):
            members = sets[dimensions[0]]
            if isinstance(sample, list) and len(sample) == len(members) and "dict" in formats:
                examples["dict"] = {str(member): deepcopy(value) for member, value in zip(members, sample)}
            elif isinstance(sample, dict) and "array" in formats and all(str(member) in sample or member in sample for member in members):
                examples["array"] = [deepcopy(sample.get(member, sample.get(str(member)))) for member in members]
    axes = [{"set": axis, "members": list(sets.get(axis) or [])} for axis in dimensions]
    description = "；".join(filter(None, [
        "允许格式：" + " / ".join(formats),
        ("轴顺序：" + " → ".join(dimensions)) if dimensions else "标量",
        "数组逐轴按声明集合顺序；映射逐轴按业务键匹配" if dimensions else "",
    ]))
    return {"type": formats[0], "allowed_formats": formats, "axis_order": dimensions,
            "axes": axes, "format_description": description, "format_examples": examples}


def validate_parameter_input(item: dict, value: Any, supplied: dict | None = None) -> dict | None:
    """Validate declared layouts, including every axis of nested values."""
    formats = item.get("allowed_formats")
    if not formats:
        return None  # Schemas from older services keep their existing validation.
    key = item.get("key") or item.get("code")
    actual = "array" if isinstance(value, list) else "dict" if isinstance(value, dict) else "boolean" if isinstance(value, bool) else "integer" if isinstance(value, int) else "number" if isinstance(value, float) else "string" if isinstance(value, str) else "null"
    numeric_compatible = (actual == "integer" and "number" in formats) or (actual == "number" and "integer" in formats and value.is_integer())
    if actual not in formats and not numeric_compatible:
        return {"key": key, "field": key, "error": "parameter format mismatch", "expected": formats,
                "actual": actual, "message": f"参数 {key} {item.get('format_description', '')}"}
    axes = item.get("axes") or []
    supplied = supplied or {}

    def check(node: Any, depth: int, location: str) -> dict | None:
        if depth >= len(axes):
            return None
        axis = axes[depth]
        members = supplied.get(axis["set"], axis.get("members"))
        if not isinstance(members, list):
            members = axis.get("members") or []
        if not isinstance(node, (list, dict)):
            return {"key": key, "field": location, "error": "indexed parameter requires array or mapping", "expected": axis["set"], "actual": type(node).__name__}
        if members and isinstance(node, list) and len(node) != len(members):
            return {"key": key, "field": location, "error": "length mismatch", "expected": len(members), "actual": len(node),
                    "message": f"参数 {location} 按 {axis['set']} 轴需要 {len(members)} 个值，实际 {len(node)} 个。"}
        if members and isinstance(node, dict) and set(map(str, node)) != set(map(str, members)):
            missing = sorted(set(map(str, members)) - set(map(str, node)))
            return {"key": key, "field": location, "error": f"{axis['set']} 索引与集合定义不一致：缺少 {', '.join(missing)}", "expected": list(map(str, members)), "actual": list(map(str, node))}
        for label, child in (enumerate(node) if isinstance(node, list) else node.items()):
            error = check(child, depth + 1, f"{location}[{label}]")
            if error:
                return error
        return None

    return check(value, 0, str(key))
