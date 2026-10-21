"""Component selections reuse model versions, asynchronous tests and publish gates."""
from copy import deepcopy

from fastapi import HTTPException

from app.schemas.model import ModelPackage
from app.services.component_dependencies import (
    catalog_definition, component_hash, component_id, component_refs, digest,
    prepare_model_dependencies, inspect_manifest,
)
from app.services.model_service import model_service
from app.services.model_version_service import model_version_service
from app.storage.memory_store import STORE


def revision_diff(before, after):
    fields = ("sets", "required_sets", "variables", "parameters", "input_schema", "output_schema", "solver_capabilities")
    changes = {field: {"before": before.get(field), "after": after.get(field)} for field in fields if before.get(field) != after.get(field)}
    return {"contract_changes": changes, "requires_model_edit": bool(changes),
            "before_constraints": before.get("generated_constraints"), "after_constraints": after.get("generated_constraints"),
            "before_objectives": before.get("generated_objective_terms"), "after_objectives": after.get("generated_objective_terms"),
            "message": "接口、维度、单位或能力变化，请在完整工作台修改并测试。" if changes else "使用相同输入与设置重新测试所选组件修订。"}


def model_component_updates(model_id):
    model = model_service.get_model(model_id)
    assets = inspect_manifest(model.component_dependencies, component_refs(model))
    rows = []
    for identifier, entry in assets.items():
        family = entry["family_id"]
        with STORE.lock:
            candidates = [deepcopy(row) for row in STORE.custom_components.values()
                          if (row.get("component_family_id") or row.get("component_id")) == family
                          and row.get("status") == "published"
                          and row.get("component_id") not in (STORE.system_config.get("component_revocations") or {})]
        rows.append({"component_id": identifier, "name": entry["definition"].get("name", identifier), "binding": entry,
            "revocation": deepcopy((STORE.system_config.get("component_revocations") or {}).get(identifier)),
            "versions": [{"component_id": component_id(row), "revision": int(row.get("revision") or 1), "version": row.get("version"),
                          "content_hash": component_hash(row), "diff": revision_diff(entry["definition"], row)} for row in candidates]})
    return {"model_id": model.id, "dependencies": rows}


def selected_package(source, selections):
    assets = inspect_manifest(source.component_dependencies, component_refs(source))
    if not selections or selections.keys() - assets.keys():
        raise HTTPException(status_code=422, detail={"code": "INVALID_COMPONENT_SELECTION", "message": "请选择已绑定组件及目标修订。"})
    targets = {}
    for old_id, new_id in selections.items():
        target = catalog_definition(new_id)
        family = str(target.get("component_family_id") or new_id)
        if family != assets[old_id]["family_id"]:
            raise HTTPException(status_code=422, detail={"code": "COMPONENT_FAMILY_MISMATCH", "message": "目标修订不属于同一组件家族。"})
        diff = revision_diff(assets[old_id]["definition"], target)
        if diff["requires_model_edit"]:
            raise HTTPException(status_code=422, detail={"code": "COMPONENT_CONTRACT_CHANGED", "message": diff["message"], "diff": diff})
        targets[old_id] = target

    def replace(value):
        if isinstance(value, list):
            return [replace(item) for item in value]
        if not isinstance(value, dict):
            return deepcopy(value)
        identifier = component_id(value)
        if identifier in targets and ("definition" in value or "type" in value or "component_id" in value):
            target = targets[identifier]
            row = {**deepcopy(value), "type": component_id(target), "component_id": component_id(target),
                   "version": str(target.get("version", "1.0.0")), "definition": deepcopy(target)}
            for field in ("generated_constraints", "generated_objective_terms", "depends_on", "dependencies"):
                if field in row:
                    row[field] = deepcopy(target.get(field) or [])
            return row
        return {key: replace(item) for key, item in value.items()}

    data = source.model_dump()
    for field in ("component_spec", "semantic_spec", "model_draft"):
        data[field] = replace(data[field])
    # Existing definitions are inherited; only explicitly chosen identities are
    # newly authorized against the catalog. Function capture retains old revisions.
    package = ModelPackage.model_validate(data).model_copy(update={"published_at": None})
    package = model_service._normalize_component_model(package)
    return prepare_model_dependencies(package)


def prepare_candidate(model_id, selections, idempotency_key):
    signature = digest({"source": model_id, "selections": selections})
    with STORE.lock:
        for model in STORE.models.values():
            context = model.ui_metadata.get("component_update") or {}
            if context.get("idempotency_key") == idempotency_key:
                if context.get("signature") != signature:
                    raise HTTPException(status_code=409, detail="同一更新标识不能用于不同组件选择。")
                return model
        source = model_service.get_model(model_id)
        selected = selected_package(source, selections)
        package = model_version_service.new_version_package(source, family_models=STORE.models.values())
        package = package.model_copy(update={key: deepcopy(getattr(selected, key)) for key in ("component_spec", "semantic_spec", "model_draft")})
        metadata = deepcopy(package.ui_metadata)
        from app.services.update_comparison import baseline_evidence
        metadata["component_update"] = {"source_model_id": source.id, "comparison_baseline": baseline_evidence(source), "selections": selections,
                                        "idempotency_key": idempotency_key, "signature": signature}
        package = package.model_copy(update={"ui_metadata": metadata})
        return model_service.create_model(package, inherited_dependencies=selected.function_dependencies, inherited_components=selected.component_dependencies)


def test_candidate(model_id, selections, idempotency_key):
    candidate = prepare_candidate(model_id, selections, idempotency_key)
    source = model_service.get_model(candidate.ui_metadata["component_update"]["source_model_id"])
    original = STORE.tasks.get(source.test_task_id)
    baseline = candidate.ui_metadata["component_update"].get("comparison_baseline") or {}
    parameters = baseline.get("parameters") or source.last_test_parameters or model_service._default_test_parameters(source)
    settings = deepcopy(baseline.get("solver_config", source.last_test_solver_config))
    task = model_service.start_model_test(candidate.id, {"parameters": parameters, "solver_config": settings,
        "idempotency_key": f"component-update:{candidate.id}:{candidate.content_hash}"})
    return {"model": model_service.get_model(candidate.id), "task": task.view()}


def select_candidate_components(model_id, selections):
    with STORE.lock:
        model = model_service.get_model(model_id)
        if model.published_at:
            raise HTTPException(status_code=409, detail="已发布模型不可原位更换依赖，请创建新版本。")
        package = selected_package(model, selections)
        fields = {key: deepcopy(getattr(package, key)) for key in ("component_spec", "semantic_spec", "model_draft", "component_dependencies", "function_dependencies")}
        updated = model.model_copy(update={**fields, "status": "developing", "tested_at": None, "tested_model_id": None,
            "tested_content_hash": None, "test_task_id": None, "dry_run_result": {}})
        updated = updated.model_copy(update={"content_hash": model_service._content_hash(updated)})
        STORE.models[model_id] = updated
        model_service._record_model_version_locked(updated)
        STORE.save_runtime()
        return updated
