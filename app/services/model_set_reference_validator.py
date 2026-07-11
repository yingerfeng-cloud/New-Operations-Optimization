from __future__ import annotations

from typing import Any

from app.model_dimensions import validate_dimension_field_consistency


REFERENCE_FIELDS = {
    "dimension",
    "dimensions",
    "indices",
    "index_sets",
    "foreach",
    "for_each",
    "sum_over",
    "index",
    "referenced_sets",
}


def validate_set_references(
    *,
    semantic_spec: dict | None,
    component_spec: dict | None,
    generic_spec: dict | None,
    model_draft: dict | None = None,
    parameter_schema: dict | None = None,
    input_contract: dict | None = None,
    output_contract: dict | None = None,
) -> list[dict[str, Any]]:
    """Validate explicit structured set references without parsing formula text."""

    semantic = semantic_spec or {}
    component = component_spec or {}
    generic = generic_spec or {}
    semantic_sets = _set_codes(semantic)
    component_sets = _set_codes(component)
    generic_sets = _set_codes(generic)
    all_sets = semantic_sets | component_sets | generic_sets

    errors: list[dict[str, Any]] = []
    _scan_spec("semantic_spec", semantic, semantic_sets or all_sets, errors)
    _scan_spec("component_spec", component, component_sets or semantic_sets or all_sets, errors)
    _scan_spec("generic_spec", generic, generic_sets or semantic_sets or all_sets, errors)

    schema_sets = semantic_sets or component_sets or generic_sets
    _scan_node("parameter_schema", parameter_schema or {}, schema_sets, errors)
    _scan_node("input_contract", input_contract or {}, schema_sets, errors)
    _scan_node("output_contract", output_contract or {}, schema_sets, errors)

    draft = model_draft or {}
    draft_semantic = draft.get("semantic") if isinstance(draft.get("semantic"), dict) else {}
    draft_sets = _set_codes(draft_semantic) or semantic_sets or all_sets
    _scan_spec("model_draft.semantic", draft_semantic, draft_sets, errors)
    _scan_node("model_draft.components", draft.get("components") or [], draft_sets, errors)
    _scan_node("model_draft.formulas", draft.get("formulas") or [], draft_sets, errors)
    return _deduplicate(errors)


def _set_codes(spec: dict[str, Any]) -> set[str]:
    sets = spec.get("sets") or {}
    if isinstance(sets, dict):
        return {str(code) for code in sets}
    if isinstance(sets, list):
        return {
            str(item.get("code") or item.get("key") or item.get("name"))
            for item in sets
            if isinstance(item, dict) and (item.get("code") or item.get("key") or item.get("name"))
        }
    return set()


def _scan_spec(prefix: str, spec: dict[str, Any], available_sets: set[str], errors: list[dict[str, Any]]) -> None:
    if not spec:
        return
    for section in ("parameters", "variables", "constraints", "objectives", "objective", "components"):
        if section in spec:
            _scan_node(f"{prefix}.{section}", spec[section], available_sets, errors)
    for section in ("input_contract", "output_contract", "parameter_schema", "bindings", "dependencies"):
        if section in spec:
            _scan_node(f"{prefix}.{section}", spec[section], available_sets, errors)


def _scan_node(path: str, value: Any, available_sets: set[str], errors: list[dict[str, Any]]) -> None:
    if isinstance(value, list):
        for index, item in enumerate(value):
            _scan_node(f"{path}[{index}]", item, available_sets, errors)
        return
    if not isinstance(value, dict):
        return

    code = str(value.get("code") or value.get("formula_id") or value.get("name") or value.get("constraint_id") or value.get("key") or "")
    errors.extend(validate_dimension_field_consistency(value, path=path))
    for key, child in value.items():
        child_path = f"{path}.{key}" if path.endswith("]") or not code or path.endswith(f".{code}") else f"{path}.{code}.{key}"
        is_term_index = key in {"key", "param_key"} and any(name in value for name in ("var", "variable", "coef_param", "coefficient_parameter"))
        if key == "free_indices":
            for set_code in _free_index_set_codes(value, child):
                if set_code and set_code not in available_sets:
                    errors.append({
                        "field": child_path,
                        "error": "set_reference_not_found",
                        "set": set_code,
                        "message": f"{_subject_name(path, value)} 引用了不存在的集合 {set_code}。",
                    })
        elif key in REFERENCE_FIELDS or is_term_index:
            for set_code in _reference_codes(child):
                if set_code and set_code not in available_sets:
                    errors.append({
                        "field": child_path,
                        "error": "set_reference_not_found",
                        "set": set_code,
                        "message": f"{_subject_name(path, value)} 引用了不存在的集合 {set_code}。",
                    })
        elif key == "domain" and isinstance(child, (dict, list)):
            for set_code in _reference_codes(child):
                if set_code and set_code not in available_sets:
                    errors.append({
                        "field": child_path,
                        "error": "set_reference_not_found",
                        "set": set_code,
                        "message": f"{_subject_name(path, value)} 引用了不存在的集合 {set_code}。",
                    })
        elif key == "sets" and not path.endswith(".sets"):
            for set_code in _reference_codes(child):
                if set_code and set_code not in available_sets:
                    errors.append({
                        "field": child_path,
                        "error": "set_reference_not_found",
                        "set": set_code,
                        "message": f"{_subject_name(path, value)} 引用了不存在的集合 {set_code}。",
                    })
        if isinstance(child, (dict, list)):
            _scan_node(child_path, child, available_sets, errors)


def _reference_codes(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            result.extend(_reference_codes(item))
        return result
    if isinstance(value, dict):
        if value.get("set") is not None:
            return [str(value["set"])]
        result: list[str] = []
        for key in ("sets", "dimension", "dimensions", "indices", "index_sets"):
            if key in value:
                result.extend(_reference_codes(value[key]))
        return result
    return []


def _free_index_set_codes(node: dict[str, Any], value: Any) -> list[str]:
    structured = [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []
    result = [code for item in structured for code in _reference_codes(item)]
    # FormulaDef free_indices may contain aliases such as ``t``. When foreach or
    # referenced_sets is present, those fields carry the authoritative set codes.
    if node.get("foreach") or node.get("referenced_sets"):
        return result
    result.extend(_reference_codes(value))
    return list(dict.fromkeys(result))


def _subject_name(path: str, value: dict[str, Any]) -> str:
    code = str(value.get("code") or value.get("formula_id") or value.get("name") or value.get("constraint_id") or value.get("key") or "该结构")
    if ".parameters" in path:
        return f"参数 {code}"
    if ".variables" in path:
        return f"变量 {code}"
    if ".constraints" in path:
        return f"约束 {code}"
    if ".components" in path:
        return f"组件 {code}"
    if ".formulas" in path:
        return f"公式 {code}"
    return code


def _deduplicate(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in errors:
        key = (str(item.get("field")), str(item.get("set")))
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result
