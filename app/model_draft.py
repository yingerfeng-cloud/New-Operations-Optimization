from __future__ import annotations

from copy import deepcopy
from typing import Any

import app.model_components  # noqa: F401
from app.model_components.formula_components import normalize_component_payload
from app.model_components.registry import component_definition, list_component_catalog
from app.problem_type_diagnosis import infer_problem_type_from_draft, normalize_problem_type
from app.storage.memory_store import STORE


def create_model_draft_from_template(template: dict[str, Any]) -> dict[str, Any]:
    if template.get("build_mode") != "component_based":
        return create_generic_model_draft_from_template(template)
    component_spec = deepcopy(template.get("component_spec") or {})
    components = []
    for item in component_spec.get("components", []) or []:
        component_type = str(item.get("type") or item.get("code") or item.get("component_id"))
        definition = _component_definition_or_metadata(component_type)
        components.append(
            {
                "component_id": component_type,
                "type": component_type,
                "enabled": item.get("enabled", True),
                "required": item.get("required", definition.get("required", False)),
                "config": deepcopy(item.get("config") or {}),
                "definition": definition,
                "generated_constraints": deepcopy(definition.get("generated_constraints") or []),
                "generated_objective_terms": deepcopy(definition.get("generated_objective_terms") or []),
            }
        )
    draft = {
        "basic_info": {
            "name": template.get("name", ""),
            "scenario": template.get("scenario", ""),
            "model_code": template.get("model_code") or template.get("code", ""),
            "builder_mode": template.get("build_mode", "component_based"),
            "solver": template.get("solver", "HiGHS"),
        },
        "semantic": {
            "objects": deepcopy(template.get("business_objects") or []),
            "sets": deepcopy(component_spec.get("sets") or template.get("sets") or []),
            "parameters": deepcopy(template.get("parameters") or []),
            "variables": deepcopy(component_spec.get("variables") or template.get("variables") or []),
            "derived_expressions": [],
            "outputs": deepcopy(template.get("outputs") or []),
        },
        "components": components,
        "constraints": deepcopy(component_spec.get("additional_custom_constraints") or []),
        "objective": _objective_from_components(components, component_spec.get("objective") or {}),
        "mathematical_expansion": {},
        "runtime_parameters": deepcopy(template.get("sample_runtime_parameters") or template.get("parameters_sample") or {}),
        "advanced": {
            "component_spec": component_spec,
            "generic_spec": deepcopy(template.get("generic_spec") or {}),
            "ui_metadata": deepcopy(template.get("ui_metadata") or {}),
            "component_catalog": list_component_catalog(),
        },
    }
    finalize_model_draft(draft)
    draft["mathematical_expansion"] = build_mathematical_expansion(draft)
    infer_problem_type_from_draft(draft, draft["basic_info"].get("solver"))
    draft["advanced"]["component_spec"] = build_component_spec_from_draft(draft)
    return draft


def _component_definition_or_metadata(component_type: str) -> dict[str, Any]:
    with STORE.lock:
        custom = deepcopy(STORE.custom_components.get(component_type) or {})
    if custom:
        custom = normalize_component_payload(custom)
        custom.setdefault("component_id", component_type)
        custom.setdefault("type", component_type)
        custom.setdefault("name", component_type)
        custom.setdefault("implemented", custom.get("status") == "published")
        custom.setdefault("generated_constraints", [])
        custom.setdefault("generated_objective_terms", [])
        return custom
    try:
        return component_definition(component_type)
    except RuntimeError:
        return {
            "component_id": component_type,
            "type": component_type,
            "name": component_type,
            "implemented": False,
            "enabled": False,
            "metadata_only": True,
            "generated_constraints": [],
            "generated_objective_terms": [],
            "description": "metadata-only component; backend builder is not registered",
        }


def create_generic_model_draft_from_template(template: dict[str, Any]) -> dict[str, Any]:
    objective = _generic_objective(template)
    draft = {
        "basic_info": {
            "name": template.get("name", ""),
            "scenario": template.get("scenario", ""),
            "model_code": template.get("model_code") or template.get("code", ""),
            "builder_mode": template.get("build_mode", "template_based"),
            "solver": template.get("solver", "HiGHS"),
        },
        "semantic": {
            "objects": deepcopy(template.get("business_objects") or []),
            "sets": deepcopy(template.get("sets") or []),
            "parameters": deepcopy(template.get("parameters") or []),
            "variables": deepcopy(template.get("variables") or []),
            "derived_expressions": deepcopy(template.get("derived_expressions") or []),
            "outputs": deepcopy(template.get("outputs") or []),
        },
        "components": [],
        "constraints": deepcopy(template.get("constraints") or []),
        "objective": objective,
        "mathematical_expansion": {},
        "runtime_parameters": deepcopy(template.get("sample_runtime_parameters") or {}),
        "advanced": {
            "component_spec": {},
            "generic_spec": deepcopy(template.get("generic_spec") or {}),
            "ui_metadata": deepcopy(template.get("ui_metadata") or {}),
            "component_catalog": [],
        },
    }
    finalize_model_draft(draft)
    draft["mathematical_expansion"] = build_mathematical_expansion(draft)
    infer_problem_type_from_draft(draft, draft["basic_info"].get("solver"))
    return draft


def finalize_model_draft(draft: dict[str, Any]) -> dict[str, Any]:
    """Regenerate fields that must come from the final Model Draft."""
    basic = draft.setdefault("basic_info", {})
    if basic.get("problem_type") and not (draft.get("advanced") or {}).get("manual_problem_type_override"):
        draft.setdefault("advanced", {})["manual_problem_type_override"] = basic.get("problem_type")
    basic.pop("problem_type", None)
    basic.pop("time_granularity", None)
    semantic = draft.setdefault("semantic", {})
    _apply_runtime_time_set_defaults(semantic, draft.setdefault("runtime_parameters", {}))
    semantic["sets"] = generate_set_members(merge_component_required_sets(draft))
    for component in draft.get("components") or []:
        component_id = component.get("component_id") or component.get("type")
        component["generated_constraints"] = [_normalize_constraint_row(item, source_component=component_id) for item in component.get("generated_constraints") or []]
        component["generated_objective_terms"] = [_normalize_objective_term(item, source_component=component_id) for item in component.get("generated_objective_terms") or []]
    objective = draft.setdefault("objective", {})
    objective["terms"] = [_normalize_objective_term(item, source_component=item.get("source_component")) for item in objective.get("terms") or []]
    draft["objective_strategy"] = generate_objective_strategy(draft.get("objective") or {})
    runtime = draft.setdefault("runtime_parameters", {})
    for item in semantic.get("sets") or []:
        if item.get("type") == "time_period" and item.get("delta_t") is not None and item.get("time_granularity") is not None:
            runtime.setdefault("delta_t", item.get("delta_t"))
        if item.get("code") == "time" and item.get("horizon") is not None:
            runtime.setdefault("horizon", item.get("horizon"))
    return draft


def _apply_runtime_time_set_defaults(semantic: dict[str, Any], runtime: dict[str, Any]) -> None:
    try:
        horizon = int(runtime.get("horizon")) if runtime.get("horizon") is not None else None
    except (TypeError, ValueError):
        horizon = None
    granularity = _runtime_time_granularity_minutes(runtime)
    for item in semantic.get("sets") or []:
        code = str(item.get("code") or item.get("key") or "")
        set_type = str(item.get("type") or item.get("set_type") or _infer_set_type(code))
        if set_type != "time_period":
            continue
        if item.get("horizon") is None and horizon is not None:
            item["horizon"] = horizon
        if item.get("time_granularity") is None and granularity is not None:
            item["time_granularity"] = granularity
            item["time_unit"] = "minute"


def _runtime_time_granularity_minutes(runtime: dict[str, Any]) -> float | None:
    if runtime.get("time_granularity") is not None:
        try:
            return float(runtime["time_granularity"])
        except (TypeError, ValueError):
            return None
    if runtime.get("time_step_seconds") is not None:
        try:
            seconds = float(runtime["time_step_seconds"])
        except (TypeError, ValueError):
            return None
        return seconds / 60 if seconds > 0 else None
    if runtime.get("delta_t") is not None:
        try:
            hours = float(runtime["delta_t"])
        except (TypeError, ValueError):
            return None
        return hours * 60 if hours > 0 else None
    return None


def merge_component_required_sets(draft: dict[str, Any]) -> list[dict[str, Any]]:
    semantic = draft.get("semantic") or {}
    rows: list[dict[str, Any]] = []
    by_code: dict[str, dict[str, Any]] = {}
    active_component_ids = {
        str(component.get("type") or component.get("component_id") or component.get("code") or "")
        for component in draft.get("components") or []
        if component.get("enabled", True) is not False
    }
    active_required_codes: set[str] = set()
    required_owners_by_code: dict[str, set[str]] = {}
    for component in draft.get("components") or []:
        if component.get("enabled", True) is False:
            continue
        component_id = str(component.get("type") or component.get("component_id") or component.get("code") or "")
        definition = component.get("definition") or _component_definition_or_metadata(str(component.get("type") or component.get("component_id")))
        for raw in definition.get("required_sets") or definition.get("sets") or []:
            code = str(raw.get("code") or raw.get("key") or raw.get("name") or "")
            if code:
                active_required_codes.add(code)
                if component_id:
                    required_owners_by_code.setdefault(code, set()).add(component_id)

    def active_owners(values: Any) -> list[str]:
        return sorted({str(value) for value in values or [] if str(value) in active_component_ids})

    def add(raw: dict[str, Any], source: str, required: bool = False) -> None:
        item = normalize_set_definition(raw, source=source, required=required)
        code = item.get("code")
        if not code:
            return
        owners = active_owners(
            list(item.get("required_by") or [])
            + list(item.get("used_by") or [])
            + list(required_owners_by_code.get(str(code), set()))
        )
        owner = item.get("source_component") if item.get("source_component") in active_component_ids else (owners[0] if owners else "")
        item["source_component"] = owner
        item["owner_component"] = owner
        item["generated_by_component"] = owner
        item["required_by"] = owners
        item["used_by"] = active_owners(list(item.get("used_by") or []) + owners)
        existing = by_code.get(code)
        if not existing:
            by_code[code] = item
            rows.append(item)
            return
        if (existing.get("type") or "normal") != (item.get("type") or "normal"):
            existing.setdefault("conflicts", []).append(
                {"source": source, "type": item.get("type"), "expected_type": existing.get("type")}
            )
        for key, value in item.items():
            if key == "source":
                sources = set(str(existing.get("source") or "").split(","))
                sources.add(str(value))
                existing["source"] = ",".join(sorted(x for x in sources if x))
            elif key == "required":
                existing["required"] = bool(existing.get("required") or value)
            elif key in {"required_by", "used_by"}:
                existing[key] = sorted(set(existing.get(key) or []) | set(value or []))
            elif existing.get(key) in (None, "", []) and value not in (None, "", []):
                existing[key] = value

    for raw in semantic.get("sets") or []:
        if isinstance(raw, dict):
            source = str(raw.get("source") or "")
            raw_owner = raw.get("source_component") or raw.get("owner_component") or raw.get("generated_by_component") or (source.split(":", 1)[1] if source.startswith("component_required_set:") else "")
            code = str(raw.get("code") or raw.get("key") or raw.get("name") or "")
            inferred_owners = sorted(required_owners_by_code.get(code, set()))
            owner = raw_owner if raw_owner in active_component_ids else (inferred_owners[0] if inferred_owners else "")
            is_component_generated = bool(raw_owner or owner) or source.startswith("component_required_set") or source == "component_generated"
            if is_component_generated and owner not in active_component_ids and code not in active_required_codes:
                continue
            add({**raw, "source_component": owner, "owner_component": owner, "generated_by_component": owner}, str(raw.get("source") or "user_defined"), bool(raw.get("required", False)))
    for component in draft.get("components") or []:
        if component.get("enabled", True) is False:
            continue
        definition = component.get("definition") or _component_definition_or_metadata(str(component.get("type") or component.get("component_id")))
        component_id = str(component.get("type") or component.get("component_id") or definition.get("component_id") or "")
        for raw in definition.get("required_sets") or definition.get("sets") or []:
            if isinstance(raw, dict):
                add({**raw, "source_component": component_id, "owner_component": component_id, "generated_by_component": component_id}, f"component_required_set:{component_id}", bool(raw.get("required", True)))
    return rows


def normalize_set_definition(raw: dict[str, Any], *, source: str = "user_defined", required: bool = False) -> dict[str, Any]:
    code = str(raw.get("code") or raw.get("key") or raw.get("name") or "")
    explicit_type = str(raw.get("type") or raw.get("set_type") or "").strip()
    set_type = explicit_type or ("time_period" if code == "time" else "state_time" if code in {"time_volume", "state_time", "soc_time"} else "normal")
    raw_members = raw.get("members", raw.get("values", []))
    members = deepcopy(raw_members if isinstance(raw_members, list) else [])
    item = {
        **deepcopy(raw),
        "code": code,
        "key": raw.get("key") or code,
        "name": raw.get("name") or code,
        "type": set_type,
        "members": members,
        "values": deepcopy(members),
        "source": raw.get("source") or source,
        "source_component": raw.get("source_component") or raw.get("owner_component") or raw.get("generated_by_component") or (source.split(":", 1)[1] if source.startswith("component_required_set:") else ""),
        "owner_component": raw.get("owner_component") or raw.get("source_component") or raw.get("generated_by_component") or (source.split(":", 1)[1] if source.startswith("component_required_set:") else ""),
        "generated_by_component": raw.get("generated_by_component") or raw.get("source_component") or raw.get("owner_component") or (source.split(":", 1)[1] if source.startswith("component_required_set:") else ""),
        "required": bool(raw.get("required", required)),
        "configured": bool(raw.get("configured", False) or members),
    }
    owner = item.get("source_component") or ""
    item["required_by"] = sorted(set(raw.get("required_by") or []) | ({owner} if owner else set()))
    item["used_by"] = sorted(set(raw.get("used_by") or []) | ({owner} if owner else set()))
    if set_type == "time_period":
        if raw.get("horizon") is not None:
            item["horizon"] = int(raw["horizon"])
        if raw.get("time_granularity") is not None:
            item["time_granularity"] = float(raw["time_granularity"])
        item.setdefault("time_unit", raw.get("time_unit") or "minute")
        item.setdefault("delta_t_unit", raw.get("delta_t_unit") or "hour")
    if set_type == "state_time":
        item.setdefault("base_set", raw.get("base_set") or "time")
        item.setdefault("generation_rule", raw.get("generation_rule") or "horizon_plus_1")
    return item


def generate_set_members(sets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_code = {str(item.get("code")): item for item in sets}
    for item in sets:
        if item.get("type") != "time_period":
            continue
        if item.get("horizon") is None and item.get("members"):
            item["horizon"] = len(item.get("members") or [])
        if item.get("horizon") is not None:
            item["members"] = list(range(int(item["horizon"])))
            item["values"] = deepcopy(item["members"])
        if item.get("time_granularity") is not None:
            unit = str(item.get("time_unit") or "minute")
            minutes = float(item["time_granularity"]) * (60 if unit in {"hour", "hours"} else 1)
            item["delta_t"] = minutes / 60
            item["delta_t_unit"] = "hour"
            item["window_minutes"] = int(item.get("horizon") or 0) * minutes
            item["window_hours"] = item["window_minutes"] / 60
            item["window_days"] = item["window_hours"] / 24
        item["configured"] = bool(item.get("members") and item.get("horizon") is not None and item.get("time_granularity") is not None)
    for item in sets:
        if item.get("type") != "state_time":
            continue
        base = by_code.get(str(item.get("base_set") or "time")) or {}
        base_members = base.get("members") or base.get("values") or []
        if item.get("generation_rule") == "horizon_plus_1" and base_members and not item.get("members"):
            item["members"] = list(range(len(base_members) + 1))
            item["values"] = deepcopy(item["members"])
        item["configured"] = bool(item.get("base_set") and item.get("members"))
    return sets


def generate_objective_strategy(objective: dict[str, Any]) -> dict[str, Any]:
    active = [
        deepcopy(term)
        for term in objective.get("terms") or []
        if term.get("enabled", True) is not False
        and str(term.get("solve_participation") or "solve_active") not in {"display_only", "remark_only", "none"}
    ]
    inactive = [
        deepcopy(term)
        for term in objective.get("terms") or []
        if term.get("enabled", True) is False
        or str(term.get("solve_participation") or "solve_active") in {"display_only", "remark_only", "none"}
    ]
    if not active:
        return {
            "status": "not_generated",
            "summary": "not generated",
            "active_terms": [],
            "inactive_terms": inactive,
            "publish_blocking": True,
            "message": "No solve-active objective term is configured.",
        }
    names = [str(term.get("name") or term.get("term_id") or term.get("weight_key") or "objective_term") for term in active]
    suffix = "combined max" if str(objective.get("sense") or "minimize").lower() == "maximize" else "combined min"
    return {
        "status": "generated",
        "summary": f"{', '.join(names[:3])}{' etc.' if len(names) > 3 else ''} {suffix}",
        "active_terms": active,
        "inactive_terms": inactive,
        "publish_blocking": False,
    }


def _infer_set_type(code: str) -> str:
    if code in {"time", "period", "dispatch_time"}:
        return "time_period"
    if code in {"time_volume", "state_time", "soc_time"}:
        return "state_time"
    return "normal"


def build_component_spec_from_draft(draft: dict[str, Any]) -> dict[str, Any]:
    finalize_model_draft(draft)
    basic = draft.get("basic_info") or {}
    semantic = draft.get("semantic") or {}
    advanced = draft.get("advanced") or {}
    current = deepcopy(advanced.get("component_spec") or {})
    enabled_components = [
        {"type": item.get("type") or item.get("component_id"), "config": deepcopy(item.get("config") or {})}
        for item in draft.get("components", []) or []
        if item.get("enabled", True)
    ]
    for item in enabled_components:
        if not item["config"]:
            item.pop("config", None)
    objective = deepcopy(draft.get("objective") or {})
    merged_sets = _merge_by_code(deepcopy(semantic.get("sets") or current.get("sets") or []), "code", _component_items(draft, "required_sets"))
    merged_variables = _merge_by_code(deepcopy(semantic.get("variables") or current.get("variables") or []), "name", _component_items(draft, "variables"))
    merged_parameters = _merge_by_code(deepcopy(semantic.get("parameters") or current.get("parameters") or []), "code", _component_items(draft, "parameters"))
    diagnosis = infer_problem_type_from_draft(draft, basic.get("solver"))
    manual_override = (draft.get("advanced") or {}).get("manual_problem_type_override")
    effective_problem_type = normalize_problem_type(manual_override or diagnosis["recommended_problem_type"])
    return {
        **current,
        "model_code": basic.get("model_code") or current.get("model_code"),
        "build_mode": "component_based",
        "name": basic.get("name") or current.get("name"),
        "model_problem_type": effective_problem_type,
        "inferred_problem_type": diagnosis["inferred_problem_type"],
        "problem_type_diagnosis": diagnosis,
        "required_solver_capabilities": [effective_problem_type],
        "sets": merged_sets,
        "parameters": merged_parameters,
        "variables": merged_variables,
        "components": enabled_components,
        "objective": {"type": "weighted_sum", "sense": objective.get("sense", "minimize"), "terms": objective.get("terms", [])},
        "objective_strategy": deepcopy(draft.get("objective_strategy") or generate_objective_strategy(objective)),
        "additional_custom_constraints": deepcopy(draft.get("constraints") or []),
    }


def _component_items(draft: dict[str, Any], key: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for component in draft.get("components", []) or []:
        if component.get("enabled", True) is False:
            continue
        definition = component.get("definition") or _component_definition_or_metadata(str(component.get("type") or component.get("component_id")))
        for item in definition.get(key, []) or []:
            if isinstance(item, dict):
                rows.append(deepcopy(item))
    return rows


def _merge_by_code(base: list[dict[str, Any]], preferred_key: str, additions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    def item_code(item: dict[str, Any]) -> str:
        if preferred_key == "name":
            return str(item.get("code") or item.get("name") or item.get("key") or "")
        return str(item.get("code") or item.get("name") or item.get("key") or "")

    for source in (base, additions):
        for item in source:
            code = item_code(item)
            if not code or code in seen:
                continue
            normalized = deepcopy(item)
            if preferred_key == "name":
                normalized["name"] = normalized.get("code") or normalized.get("name") or normalized.get("key") or code
                normalized.setdefault("indices", normalized.get("dimension") or [])
                normalized.setdefault("domain", _variable_domain(normalized))
            else:
                normalized.setdefault("code", normalized.get("name") or normalized.get("key") or code)
            rows.append(normalized)
            seen.add(code)
    return rows


def _variable_domain(variable: dict[str, Any]) -> str:
    raw = str(variable.get("domain") or variable.get("type") or "continuous").lower()
    if raw in {"binary", "bool", "boolean"}:
        return "Binary"
    if raw in {"integer", "int"}:
        return "Integers"
    if raw in {"nonnegativeintegers"}:
        return "NonNegativeIntegers"
    if variable.get("lower_bound", variable.get("lb", 0)) is None:
        return "Reals"
    return "NonNegativeReals"


FORMULA_NOT_GENERATED = "鏈敓鎴愬叕寮忥紝璇锋鏌ュ彉閲忋€侀泦鍚堛€佸弬鏁板拰鍏紡閰嶇疆"


def _first_non_blank(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _constraint_formula(item: dict[str, Any]) -> str:
    return _first_non_blank(
        item.get("formula"),
        item.get("expression"),
        item.get("dsl"),
        item.get("math_expression"),
        item.get("generated_formula"),
        item.get("display_formula"),
        item.get("math_constraint"),
        item.get("expr"),
    ) or FORMULA_NOT_GENERATED


def _objective_formula(item: dict[str, Any]) -> str:
    return _first_non_blank(
        item.get("formula"),
        item.get("expression"),
        item.get("dsl"),
        item.get("math_expression"),
        item.get("generated_formula"),
        item.get("display_formula"),
        item.get("expr"),
    ) or FORMULA_NOT_GENERATED


def _normalize_constraint_row(item: dict[str, Any], *, source_component: str | None = None) -> dict[str, Any]:
    row = deepcopy(item)
    formula = _constraint_formula(row)
    row.setdefault("formula", formula)
    row.setdefault("expression", formula)
    row.setdefault("display_formula", formula)
    row.setdefault("indices", row.get("foreach") or [])
    row.setdefault("source_component", source_component or row.get("component_id") or row.get("source_component") or "")
    row.setdefault("business_meaning", _first_non_blank(row.get("business_meaning"), row.get("business_rule"), row.get("description")))
    return row


def _normalize_objective_term(item: dict[str, Any], *, source_component: str | None = None) -> dict[str, Any]:
    row = deepcopy(item)
    formula = _objective_formula(row)
    row.setdefault("formula", formula)
    row.setdefault("expression", formula)
    row.setdefault("display_formula", formula)
    row.setdefault("indices", row.get("foreach") or row.get("key") or [])
    row.setdefault("source_component", source_component or row.get("component_id") or row.get("source_component") or "")
    row.setdefault("business_meaning", _first_non_blank(row.get("business_meaning"), row.get("business_goal"), row.get("description")))
    return row


def build_constraints_from_draft(draft: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for component in draft.get("components", []) or []:
        enabled = component.get("enabled", True)
        component_id = component.get("component_id") or component.get("type")
        for constraint in component.get("generated_constraints") or []:
            rows.append(
                {
                    **_normalize_constraint_row(constraint, source_component=component_id),
                    "source": "component",
                    "source_component": component_id,
                    "enabled": enabled,
                    "core": True,
                    "editable": False,
                }
            )
    for index, item in enumerate(draft.get("constraints") or []):
        rows.append(
            {
                "constraint_id": item.get("constraint_id") or item.get("name") or f"custom_constraint_{index + 1}",
                "name": item.get("name") or f"custom constraint {index + 1}",
                "type": item.get("type") or item.get("scope") or "additional_boundary",
                "formula": _constraint_formula(item),
                "expression": _constraint_formula(item),
                "display_formula": _constraint_formula(item),
                "business_meaning": item.get("business_meaning") or item.get("business_rule") or item.get("description") or "user-defined additional constraint",
                "indices": item.get("indices") or item.get("foreach") or [],
                "source": "custom",
                "source_component": "",
                "enabled": item.get("enabled", True),
                "core": False,
                "editable": True,
            }
        )
    return rows


def build_mathematical_expansion(draft: dict[str, Any]) -> dict[str, Any]:
    objective = deepcopy(draft.get("objective") or {})
    objective["terms"] = [_normalize_objective_term(term, source_component=term.get("source_component")) for term in objective.get("terms", [])]
    enabled_terms = [term for term in objective.get("terms", []) if term.get("enabled", True)]
    formula = " + ".join(f"{term.get('weight_key', 'w')} * {_objective_formula(term)}" for term in enabled_terms)
    sections = []
    for constraint in build_constraints_from_draft(draft):
        sections.append(
            {
                "type": "constraint",
                "title": constraint.get("name"),
                "formula": _constraint_formula(constraint),
                "expression": _constraint_formula(constraint),
                "display_formula": _constraint_formula(constraint),
                "business_meaning": constraint.get("business_meaning"),
                "source_component": constraint.get("source_component"),
                "source": constraint.get("source"),
                "enabled": constraint.get("enabled", True),
                "core": constraint.get("core", False),
                "editable": constraint.get("editable", False),
                "curve": constraint.get("curve"),
                "x": constraint.get("x"),
                "y": constraint.get("y"),
                "solve_participation": constraint.get("solve_participation"),
            }
        )
    for component in draft.get("components", []) or []:
        if component.get("enabled", True) is False:
            continue
        definition = component.get("definition") or _component_definition_or_metadata(str(component.get("type") or component.get("component_id")))
        for curve in definition.get("curves") or definition.get("piecewise_curves") or []:
            if not isinstance(curve, dict):
                continue
            sections.append(
                {
                    "type": "piecewise_curve",
                    "title": curve.get("name") or curve.get("code"),
                    "formula": f"{curve.get('y', 'y')} = piecewise({curve.get('x', 'x')})",
                    "curve_points": deepcopy(curve.get("points") or []),
                    "interpolation": curve.get("interpolation", "linear"),
                    "source_component": component.get("component_id") or component.get("type"),
                    "source": "component",
                    "enabled": True,
                    "solve_participation": curve.get("solve_participation", "display_only"),
                }
            )
    return {
        "source": "model_draft_generated",
        "sections": sections,
        "objective": {
            "sense": objective.get("sense", "minimize"),
            "formula": formula or "0",
            "terms": deepcopy(objective.get("terms") or []),
        },
    }


def normalize_component_model_package(model_data: dict[str, Any]) -> dict[str, Any]:
    draft = deepcopy(model_data.get("model_draft") or {})
    if not draft:
        semantic = deepcopy(model_data.get("semantic_spec") or {})
        template_like = {
            **semantic,
            "name": model_data.get("name") or semantic.get("name"),
            "scenario": model_data.get("scene") or semantic.get("scenario"),
            "solver": model_data.get("solver", "HiGHS"),
            "build_mode": "component_based" if (model_data.get("component_spec") or semantic.get("component_spec")) else model_data.get("build_mode", semantic.get("build_mode", "component_based")),
            "component_spec": deepcopy(model_data.get("component_spec") or semantic.get("component_spec") or {}),
            "sample_runtime_parameters": deepcopy(model_data.get("parameters") or semantic.get("sample_runtime_parameters") or {}),
        }
        if template_like["component_spec"]:
            draft = create_model_draft_from_template(template_like)
    if not draft:
        return model_data
    draft.setdefault("advanced", {"component_spec": {}, "generic_spec": {}, "ui_metadata": {}, "component_catalog": []})
    if model_data.get("component_spec"):
        edited_component_spec = deepcopy(model_data["component_spec"])
        draft.setdefault("advanced", {})["component_spec"] = edited_component_spec
        if "components" in edited_component_spec:
            draft["components"] = _draft_components_from_component_spec(edited_component_spec)
        if edited_component_spec.get("objective"):
            draft["objective"] = _objective_from_components(draft.get("components") or [], edited_component_spec.get("objective") or {})
    finalize_model_draft(draft)
    draft["mathematical_expansion"] = build_mathematical_expansion(draft)
    infer_problem_type_from_draft(draft, (draft.get("basic_info") or {}).get("solver"))
    draft["advanced"]["component_spec"] = build_component_spec_from_draft(draft)
    model_data["model_draft"] = draft
    model_data["component_spec"] = deepcopy(draft["advanced"]["component_spec"])
    model_data["mathematical_expansion"] = deepcopy(draft["mathematical_expansion"])
    model_data["objective_config"] = deepcopy(draft.get("objective") or {})
    model_data["draft_constraints"] = deepcopy(build_constraints_from_draft(draft))
    sample_parameters = deepcopy((model_data.get("semantic_spec") or {}).get("sample_runtime_parameters") or {})
    draft_parameters = deepcopy(draft.get("runtime_parameters") or {})
    model_data["parameters"] = {**sample_parameters, **draft_parameters, **deepcopy(model_data.get("parameters") or {})}
    semantic = deepcopy(model_data.get("semantic_spec") or {})
    semantic["build_mode"] = "component_based"
    semantic["component_spec"] = deepcopy(model_data["component_spec"])
    semantic["sets"] = deepcopy((draft.get("semantic") or {}).get("sets") or [])
    semantic["parameters"] = deepcopy(model_data["component_spec"].get("parameters") or (draft.get("semantic") or {}).get("parameters") or semantic.get("parameters") or [])
    semantic["variables"] = deepcopy(model_data["component_spec"].get("variables") or (draft.get("semantic") or {}).get("variables") or semantic.get("variables") or [])
    semantic["model_draft"] = deepcopy(draft)
    semantic["mathematical_expansion"] = deepcopy(model_data["mathematical_expansion"])
    semantic["model_problem_type"] = model_data["component_spec"].get("model_problem_type", "LP")
    semantic["inferred_problem_type"] = draft.get("inferred_problem_type", "LP")
    semantic["problem_type_diagnosis"] = deepcopy(draft.get("problem_type_diagnosis") or {})
    semantic["required_solver_capabilities"] = deepcopy(model_data["component_spec"].get("required_solver_capabilities") or ["LP"])
    model_data["semantic_spec"] = semantic
    model_data["problem_type"] = semantic["model_problem_type"]
    model_data["model_problem_type"] = semantic["model_problem_type"]
    model_data["required_solver_capabilities"] = deepcopy(semantic["required_solver_capabilities"])
    return model_data


def _draft_components_from_component_spec(component_spec: dict[str, Any]) -> list[dict[str, Any]]:
    components: list[dict[str, Any]] = []
    for item in component_spec.get("components") or []:
        component_type = str(item.get("type") or item.get("code") or item.get("component_id") or "")
        if not component_type:
            continue
        definition = _component_definition_or_metadata(component_type)
        components.append(
            {
                "component_id": component_type,
                "type": component_type,
                "enabled": item.get("enabled", True),
                "required": item.get("required", definition.get("required", False)),
                "config": deepcopy(item.get("config") or {}),
                "definition": definition,
                "generated_constraints": deepcopy(definition.get("generated_constraints") or []),
                "generated_objective_terms": deepcopy(definition.get("generated_objective_terms") or []),
            }
        )
    return components


def normalize_generic_model_package(model_data: dict[str, Any]) -> dict[str, Any]:
    if model_data.get("model_draft"):
        return model_data
    semantic = deepcopy(model_data.get("semantic_spec") or {})
    if not semantic:
        return model_data
    draft = create_generic_model_draft_from_template(
        {
            **semantic,
            "name": model_data.get("name") or semantic.get("name"),
            "scenario": model_data.get("scene") or semantic.get("scenario"),
            "solver": model_data.get("solver", "HiGHS"),
            "build_mode": model_data.get("build_mode", semantic.get("build_mode", "template_based")),
            "generic_spec": deepcopy(model_data.get("generic_spec") or semantic.get("generic_spec") or {}),
            "sample_runtime_parameters": deepcopy(model_data.get("parameters") or semantic.get("sample_runtime_parameters") or {}),
        }
    )
    finalize_model_draft(draft)
    model_data["model_draft"] = draft
    model_data["mathematical_expansion"] = deepcopy(draft["mathematical_expansion"])
    model_data["objective_config"] = deepcopy(draft["objective"])
    model_data["draft_constraints"] = deepcopy(build_constraints_from_draft(draft))
    semantic["model_draft"] = deepcopy(draft)
    semantic["mathematical_expansion"] = deepcopy(draft["mathematical_expansion"])
    model_data["semantic_spec"] = semantic
    return model_data


def _objective_from_components(components: list[dict[str, Any]], objective_spec: dict[str, Any]) -> dict[str, Any]:
    terms: list[dict[str, Any]] = []
    weights = objective_spec.get("weights") or {}
    for component in components:
        for term in component.get("generated_objective_terms") or []:
            item = _normalize_objective_term(term, source_component=component.get("component_id") or component.get("type"))
            key = item.get("weight_key")
            if key in weights:
                item["weight"] = weights[key]
            terms.append(item)
    existing_ids = {str(item.get("term_id") or item.get("weight_key") or "") for item in terms}
    for term in objective_spec.get("terms") or []:
        term_id = str(term.get("term_id") or term.get("weight_key") or "")
        if term_id and term_id in existing_ids:
            for item in terms:
                if str(item.get("term_id") or item.get("weight_key") or "") == term_id:
                    item.update(deepcopy(term))
            continue
        terms.append(_normalize_objective_term(term))
    return {"sense": objective_spec.get("sense", "minimize"), "terms": terms}


def _generic_objective(template: dict[str, Any]) -> dict[str, Any]:
    objectives = template.get("objectives") or []
    if not objectives:
        return {"sense": "minimize", "terms": []}
    first = objectives[0]
    return {
        "sense": first.get("sense", "minimize"),
        "terms": [
            {
                "term_id": first.get("code") or "objective",
                "name": first.get("name") or first.get("code") or "鐩爣鍑芥暟",
                "source": "template",
                "expression": first.get("expression") or first.get("business_goal") or "",
                "weight": 1,
                "enabled": True,
                "editable": False,
                "solve_participation": "template_builder",
            }
        ],
    }
