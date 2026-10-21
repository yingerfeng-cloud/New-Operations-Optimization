"""The input layout shared by schema consumers and the runtime validator.

An explicit type remains authoritative. Untyped indexed values only admit
positional arrays when their axes are known; mappings always use business keys.
This module does not resolve coefficients or infer an axis from unrelated sets.
"""
from copy import deepcopy
import math
from typing import Any

from app.model_dimensions import extract_dimensions


def parameter_default_policy(param: dict) -> str:
    validation = param.get("validation") or {}
    explicit = param.get("default_policy") or validation.get("default_policy")
    if explicit:
        return str(explicit)
    if param.get("runtime_injected") is False or any(param.get(key) is not None for key in ("default_value", "defaultValue", "default")):
        return "default_allowed"
    return "user_required" if bool(validation.get("required", param.get("required", True))) else "sample_only"


def declared_parameter_defaults(semantic: dict) -> dict:
    result = {}
    for param in semantic.get("parameters") or []:
        if parameter_default_policy(param) != "default_allowed":
            continue
        key = param.get("math_param") or param.get("code") or param.get("key")
        value = next((param[field] for field in ("default_value", "defaultValue", "default", "sample_value", "sample") if param.get(field) is not None), None)
        if key and value is not None:
            result[str(key)] = deepcopy(value)
    return result


def parameter_input_contract(param: dict, sets: dict[str, list]) -> dict:
    dimensions = extract_dimensions(param)
    validation = param.get("validation") or {}
    declared = str(validation.get("type") or param.get("type") or param.get("param_type") or "").lower()
    declared = {"list": "array", "object": "dict", "float": "number", "int": "integer"}.get(declared, declared)
    sample = param.get("sample_value", param.get("sample", param.get("default_value", param.get("default"))))
    # A blank editor placeholder is missing metadata, not a string declaration.
    # Explicit string contracts remain authoritative below.
    if isinstance(sample, str) and not sample.strip():
        sample = None
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
    leaf = sample
    while isinstance(leaf, (dict, list)) and leaf:
        leaf = next(iter(leaf.values())) if isinstance(leaf, dict) else leaf[0]
    items = validation.get("items") or {}
    leaf_type = param.get("value_type") or param.get("leaf_type") or validation.get("leaf_type") or validation.get("item_type") or (items.get("type") if isinstance(items, dict) else None)
    explicit_leaf_type = bool(leaf_type)
    if not leaf_type:
        leaf_type = "boolean" if isinstance(leaf, bool) else "string" if isinstance(leaf, str) else "number"
    if formats == ["string"] or formats == ["boolean"]:
        leaf_type = formats[0]
    description = "；".join(filter(None, [
        "允许格式：" + " / ".join(formats),
        ("轴顺序：" + " → ".join(dimensions)) if dimensions else "标量",
        "数组逐轴按声明集合顺序；映射逐轴按业务键匹配" if dimensions else "",
    ]))
    coordinate_type = str(param.get("coordinate_type") or validation.get("coordinate_type") or "scalar").lower()
    if param.get("value_type") in {"array", "dict", "object"}:
        coordinate_type = "dict" if param["value_type"] == "object" else param["value_type"]
        leaf_type = param.get("leaf_type") or validation.get("leaf_type") or "number"
    return {"type": formats[0], "allowed_formats": formats, "value_type": leaf_type, "explicit_value_type": explicit_leaf_type, "coordinate_type": coordinate_type, "axis_order": dimensions,
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
            # Declared axes end at a coordinate, not at an arbitrary numeric leaf.
            # Composite coordinates require an explicit contract; unindexed curve
            # and configuration parameters keep their existing structured layout.
            if isinstance(node, (dict, list)):
                coordinate_type = item.get("coordinate_type", "scalar")
                if axes and (coordinate_type == "scalar" or depth == len(axes) and (
                    coordinate_type == "array" and not isinstance(node, list)
                    or coordinate_type in {"dict", "object"} and not isinstance(node, dict)
                )):
                    return {"key": key, "field": location, "error": "parameter rank mismatch", "expected": "scalar coordinate" if coordinate_type == "scalar" else coordinate_type,
                            "actual": type(node).__name__, "message": f"参数 {location} 已到达声明的 {len(axes)} 个轴，不允许额外嵌套。"}
                for label, child in (enumerate(node) if isinstance(node, list) else node.items()):
                    error = check(child, depth + 1, f"{location}[{label}]")
                    if error:
                        return error
                return None
            leaf_type = item.get("value_type")
            if axes and depth == len(axes) and item.get("coordinate_type") in {"array", "dict", "object"}:
                return {"key": key, "field": location, "error": "composite coordinate required", "expected": item["coordinate_type"], "actual": type(node).__name__}
            if leaf_type in {"number", "integer"} and (
                isinstance(node, bool) or not isinstance(node, (int, float)) or not math.isfinite(node)
                or leaf_type == "integer" and int(node) != node
            ):
                return {"key": key, "field": location, "error": "invalid numeric value", "expected": f"finite {leaf_type}",
                        "actual": node, "message": f"参数 {location} 必须为有限数值。"}
            if leaf_type == "json" and isinstance(node, float) and not math.isfinite(node):
                return {"key": key, "field": location, "error": "invalid numeric value", "expected": "finite JSON number", "actual": node}
            if leaf_type in {"boolean", "string"} and (item.get("explicit_value_type") or formats == [leaf_type]) and not isinstance(node, bool if leaf_type == "boolean" else str):
                return {"key": key, "field": location, "error": "invalid coordinate value", "expected": leaf_type, "actual": type(node).__name__}
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
