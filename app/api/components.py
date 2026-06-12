from __future__ import annotations

from copy import deepcopy

import app.model_components  # noqa: F401
from fastapi import APIRouter, HTTPException

from app.model_components.formula_components import normalize_component_payload as normalize_formula_component
from app.model_components.formula_components import validate_component_definition
from app.model_components.registry import COMPONENT_DEPENDENCIES, component_definition, list_component_catalog
from app.model_components.solver_capabilities import normalize_capabilities
from app.services.model_service import model_service
from app.storage.memory_store import STORE
from app.utils import now_text

router = APIRouter(prefix="/api/components", tags=["components"])


@router.get("/catalog")
def get_component_catalog() -> list[dict]:
    with STORE.lock:
        custom = [normalize_formula_component(item) for item in STORE.custom_components.values()]
    rows = {item["component_id"]: item for item in list_component_catalog()}
    for item in custom:
        rows[item["component_id"]] = item
    return sorted(rows.values(), key=lambda item: item["component_id"])


@router.post("/catalog")
def create_component(payload: dict) -> dict:
    component = _normalize_component_payload(payload, creating=True)
    _assert_component_identity_available(component["component_id"])
    with STORE.lock:
        STORE.custom_components[component["component_id"]] = component
        STORE.save_runtime()
    return component


@router.post("/validate-dependencies")
def validate_component_dependencies(payload: dict) -> dict:
    raw_components = payload.get("components") or []
    enabled = {
        _component_id_from_payload_item(item)
        for item in raw_components
        if _component_enabled(item)
    }
    errors = []
    catalog_ids = {item["component_id"] for item in get_component_catalog()}
    for component_id in sorted(enabled):
        dependencies = set(COMPONENT_DEPENDENCIES.get(component_id, []))
        try:
            dependencies.update(get_component(component_id).get("depends_on") or [])
        except HTTPException:
            pass
        for dependency in sorted(dependencies):
            if dependency not in catalog_ids:
                errors.append({"component_id": component_id, "missing_dependency": dependency, "message": f"组件 {component_id} 依赖组件 {dependency} 不存在"})
            elif dependency not in enabled:
                errors.append({"component_id": component_id, "missing_dependency": dependency, "message": f"组件 {component_id} 缺少依赖组件 {dependency}"})
    return {"valid": not errors, "errors": errors}


@router.get("/{component_id}")
def get_component(component_id: str) -> dict:
    with STORE.lock:
        custom = STORE.custom_components.get(component_id)
    if custom:
        return {**normalize_formula_component(custom), "referenced_by": _component_references(component_id)}
    try:
        return {**component_definition(component_id), "referenced_by": _component_references(component_id)}
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{component_id}")
def update_component(component_id: str, payload: dict) -> dict:
    existing_detail = get_component(component_id)
    if existing_detail.get("status") == "published" and _component_references(component_id):
        raise HTTPException(status_code=409, detail="已发布且被模型引用的组件不能直接修改，请复制为新版本。")
    component = _normalize_component_payload({**payload, "component_id": component_id}, creating=False)
    with STORE.lock:
        existing = STORE.custom_components.get(component_id)
        versions = list((existing or {}).get("versions") or [])
        versions.append(
            {
                "version": component.get("version", "1.0.0"),
                "changed_at": now_text(),
                "change_note": payload.get("change_note", "metadata update"),
                "snapshot": deepcopy(component),
            }
        )
        component["versions"] = versions
        STORE.custom_components[component_id] = component
        STORE.save_runtime()
    return component


@router.delete("/{component_id}")
def delete_component(component_id: str) -> dict:
    with STORE.lock:
        component = STORE.custom_components.get(component_id)
    if not component:
        raise HTTPException(status_code=404, detail="Component not found")
    if component.get("status") == "published" or _component_references(component_id):
        raise HTTPException(status_code=409, detail="已发布或已被引用组件不能物理删除，只能停用或复制新版本。")
    with STORE.lock:
        del STORE.custom_components[component_id]
        STORE.save_runtime()
    return {"component_id": component_id, "status": "deleted"}


@router.post("/{component_id}/copy-version")
def copy_component_version(component_id: str, payload: dict | None = None) -> dict:
    source = get_component(component_id)
    payload = payload or {}
    next_version = str(payload.get("version") or f"{source.get('version', '1.0.0')}-copy")
    new_component_id = str(payload.get("component_id") or f"{component_id}_v{next_version.replace('.', '_').replace('-', '_')}")
    copied = {
        **deepcopy(source),
        "component_id": new_component_id,
        "type": new_component_id,
        "version": next_version,
        "status": "draft",
        "enabled": False,
        "implemented": False,
        "change_note": payload.get("change_note", "copy version"),
        "referenced_by": [],
    }
    component = _normalize_component_payload(copied, creating=True)
    _assert_component_identity_available(new_component_id)
    with STORE.lock:
        STORE.custom_components[new_component_id] = component
        STORE.save_runtime()
    return component


@router.post("/{component_id}/validate")
def validate_component(component_id: str, payload: dict | None = None) -> dict:
    component = _normalize_component_payload({**(payload or get_component(component_id)), "component_id": component_id}, creating=False)
    return validate_component_definition(component)


@router.post("/{component_id}/publish")
def publish_component(component_id: str) -> dict:
    with STORE.lock:
        component = deepcopy(STORE.custom_components.get(component_id) or {})
    if not component:
        raise HTTPException(status_code=404, detail="Component not found")
    normalized = _normalize_component_payload(component, creating=False)
    result = validate_component_definition(normalized)
    if not result["valid"]:
        raise HTTPException(status_code=422, detail={"message": "组件发布校验失败", "errors": result["errors"]})
    normalized["status"] = "published"
    normalized["implemented"] = True
    normalized["enabled"] = True
    normalized["published_at"] = now_text()
    normalized["updated_at"] = now_text()
    with STORE.lock:
        STORE.custom_components[component_id] = normalized
        STORE.save_runtime()
    return normalized


@router.post("/{component_id}/offline")
def offline_component(component_id: str) -> dict:
    component = get_component(component_id)
    component["status"] = "offline" if component.get("status") in {"published", "trial", "tested"} else component.get("status", "draft")
    component["enabled"] = False
    component["updated_at"] = now_text()
    normalized = _normalize_component_payload(component, creating=False)
    with STORE.lock:
        STORE.custom_components[component_id] = normalized
        STORE.save_runtime()
    return normalized


def _component_id_from_payload_item(item: object) -> str:
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        return str(item.get("type") or item.get("component_id") or item.get("code") or "")
    return ""


def _component_enabled(item: object) -> bool:
    if isinstance(item, dict):
        return item.get("enabled", True) is not False
    return True


def _normalize_component_payload(payload: dict, *, creating: bool) -> dict:
    component_id = str(payload.get("component_id") or payload.get("type") or "").strip()
    if not component_id:
        raise HTTPException(status_code=422, detail="component_id is required")
    timestamp = now_text()
    normalized = normalize_formula_component(
        {
            **payload,
            "component_id": component_id,
            "type": component_id,
            "depends_on": list(payload.get("depends_on") or payload.get("dependencies") or []),
            "dependencies": list(payload.get("dependencies") or payload.get("depends_on") or []),
        }
    )
    return {
        **normalized,
        "component_id": component_id,
        "type": component_id,
        "name": payload.get("name") or payload.get("display_name") or component_id,
        "display_name": payload.get("display_name") or payload.get("name") or component_id,
        "domain": payload.get("domain") or "通用",
        "category": payload.get("category") or "基础组件",
        "version": payload.get("version") or "1.0.0",
        "status": payload.get("status") or "draft",
        "implemented": bool(payload.get("implemented", False)),
        "enabled": payload.get("enabled", True) is not False,
        "required": bool(payload.get("required", False)),
        "problem_types": normalize_capabilities(list(payload.get("problem_types") or ["LP"])),
        "solver_capabilities": normalize_capabilities(list(payload.get("solver_capabilities") or ["LP"])),
        "variable_types": list(normalized.get("variable_types") or payload.get("variable_types") or ["continuous"]),
        "expression_class": normalized.get("expression_class") or payload.get("expression_class") or "linear",
        "problem_type_effect": normalized.get("problem_type_effect") or payload.get("problem_type_effect") or "LP",
        "depends_on": list(payload.get("depends_on") or payload.get("dependencies") or []),
        "inputs": normalized.get("parameters") or [_schema_item(item) for item in list(payload.get("inputs") or [])],
        "outputs": list(payload.get("outputs") or []),
        "generated_constraints": normalized.get("generated_constraints") or [],
        "generated_objective_terms": normalized.get("generated_objective_terms") or [],
        "config_schema": dict(payload.get("config_schema") or {}),
        "math_template": dict(payload.get("math_template") or {}),
        "description": payload.get("description") or "",
        "examples": list(payload.get("examples") or []),
        "test_cases": list(payload.get("test_cases") or []),
        "versions": list(payload.get("versions") or []),
        "created_at": payload.get("created_at") or timestamp,
        "updated_at": timestamp,
        "editable": True,
        "metadata_only": not bool(normalized.get("generated_constraints")),
    }


def _assert_component_identity_available(component_id: str) -> None:
    with STORE.lock:
        if component_id in STORE.custom_components:
            raise HTTPException(status_code=409, detail=f"Component already exists: {component_id}")
    try:
        component_definition(component_id)
    except RuntimeError:
        return
    raise HTTPException(status_code=409, detail=f"Component already exists: {component_id}")


def _schema_item(item: object) -> dict:
    if isinstance(item, dict):
        code = str(item.get("code") or item.get("key") or item.get("name") or "")
        return {**item, "code": code, "key": item.get("key") or code, "name": item.get("name") or code}
    code = str(item)
    return {"code": code, "key": code, "name": code}


def _component_references(component_id: str) -> list[dict]:
    rows = []
    for model in model_service.list_models():
        components = (model.component_spec or {}).get("components") or []
        if any((item.get("type") or item.get("component_id") or item.get("code")) == component_id for item in components):
            rows.append(
                {
                    "model_id": model.id,
                    "model_name": model.name,
                    "model_version": model.version,
                    "status": model.status,
                    "component_version": get_component_version(component_id),
                }
            )
    return rows


def get_component_version(component_id: str) -> str:
    with STORE.lock:
        custom = STORE.custom_components.get(component_id)
    if custom:
        return str(custom.get("version", "1.0.0"))
    try:
        return str(component_definition(component_id).get("version", "1.0.0"))
    except RuntimeError:
        return "unknown"
