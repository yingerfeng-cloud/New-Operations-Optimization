"""Selective function revisions on the existing model-version lifecycle."""
from copy import deepcopy
import hashlib
import json

from fastapi import HTTPException

from app.function_strategy import effective_1d_strategy
from app.services.function_asset_service import function_asset_hash, function_asset_service
from app.services.function_dependencies import capture_dependencies, dependency_ids, dependency_snapshots
from app.services.model_service import model_service
from app.services.model_version_service import model_version_service
from app.storage.memory_store import STORE


def revision_diff(before: dict, after: dict) -> dict:
    """Contract changes need editing; point changes still require a new solve."""
    from app.schemas.function_asset import FunctionAsset
    before = FunctionAsset.model_validate(before).model_dump()
    after = FunctionAsset.model_validate(after).model_dump()
    fields = ("function_type", "input_schema", "output_schema", "group_keys", "interpolation", "out_of_domain_policy", "allow_extrapolation")
    changes = {field: {"before": before.get(field), "after": after.get(field)} for field in fields if before.get(field) != after.get(field)}
    old_strategy, new_strategy = effective_1d_strategy(before.get("solve_strategy")), effective_1d_strategy(after.get("solve_strategy"))
    if old_strategy != new_strategy:
        changes["solve_strategy"] = {"before": old_strategy, "after": new_strategy}
    if before.get("interpolation_mode") != after.get("interpolation_mode"):
        changes["interpolation_mode"] = {"before": before.get("interpolation_mode"), "after": after.get("interpolation_mode")}
    domain_changed = before.get("domain") != after.get("domain")
    return {"contract_changes": changes, "requires_model_edit": bool(changes), "domain_changed": domain_changed,
            "before_domain": before.get("domain"), "after_domain": after.get("domain"),
            "before_points": before.get("points_2d") or before.get("points"), "after_points": after.get("points_2d") or after.get("points"),
            "message": "单位、维度、插值或策略契约变化，请创建新版本并在完整工作台调整模型后测试。" if changes else "断点、定义域和可行域变化将重新检查变量范围并进行真实测试。"}


def model_function_updates(model_id: str) -> dict:
    model = model_service.get_model(model_id)
    snapshots = dependency_snapshots(model, require_pinned=bool(model.published_at))
    rows = []
    for function_id in sorted(dependency_ids(model)):
        versions = function_asset_service.list_versions(function_id)
        current = (model.function_dependencies or {}).get(function_id)
        before = snapshots.get(function_id)
        rows.append({"function_id": function_id, "name": versions[-1].name, "binding": current,
                     "latest_revision": versions[-1].revision,
                     "versions": [{"revision": asset.revision, "content_hash": asset.content_hash,
                                   "diff": revision_diff(before, asset.model_dump()) if before else None} for asset in versions]})
    return {"model_id": model.id, "version": model.version, "dependencies": rows}


def selected_dependencies(source, revisions: dict[str, int]) -> dict:
    ids = dependency_ids(source)
    if not revisions or revisions.keys() - ids:
        raise HTTPException(status_code=422, detail={"code": "INVALID_DEPENDENCY_SELECTION", "message": "请选择本模型已经引用的函数及具体修订。"})
    # Missing history is never filled with today's library content on an old model.
    dependency_snapshots(source, require_pinned=bool(source.published_at))
    inherited = capture_dependencies(source)
    for function_id, revision in revisions.items():
        asset = function_asset_service.get_version(function_id, revision).model_dump()
        old = inherited[function_id]["asset"]
        diff = revision_diff(old, asset)
        if diff["requires_model_edit"]:
            raise HTTPException(status_code=422, detail={"code": "FUNCTION_CONTRACT_CHANGED", "message": diff["message"], "function_id": function_id, "diff": diff})
        inherited[function_id] = {"revision": asset["revision"], "content_hash": function_asset_hash(asset), "asset": deepcopy(asset)}
    dependency_snapshots(source.model_copy(update={"function_dependencies": inherited}), require_pinned=True)
    return inherited


def prepare_candidate(model_id: str, revisions: dict[str, int], idempotency_key: str) -> object:
    if not idempotency_key or len(idempotency_key) > 200:
        raise HTTPException(status_code=422, detail="idempotency_key is required (max 200 characters)")
    signature = hashlib.sha256(json.dumps({"source": model_id, "revisions": revisions}, sort_keys=True).encode()).hexdigest()
    with STORE.lock:
        for model in STORE.models.values():
            context = (model.ui_metadata or {}).get("function_update") or {}
            if context.get("idempotency_key") == idempotency_key:
                if context.get("signature") != signature:
                    raise HTTPException(status_code=409, detail="同一更新标识不能用于不同修订选择。")
                return model
        source = model_service.get_model(model_id)
        dependencies = selected_dependencies(source, revisions)
        package = model_version_service.new_version_package(source, family_models=STORE.models.values())
        metadata = deepcopy(package.ui_metadata or {})
        from app.services.update_comparison import baseline_evidence
        metadata["function_update"] = {"source_model_id": source.id, "comparison_baseline": baseline_evidence(source), "selected_revisions": revisions,
                                       "idempotency_key": idempotency_key, "signature": signature,
                                       "source_objective": ((source.dry_run_result or {}).get("solver_check") or {}).get("objective_value")}
        package = package.model_copy(update={"ui_metadata": metadata})
        return model_service.create_model(package, inherited_dependencies=dependencies, inherited_components=deepcopy(source.component_dependencies))


def test_candidate(model_id: str, revisions: dict[str, int], idempotency_key: str) -> dict:
    candidate = prepare_candidate(model_id, revisions, idempotency_key)
    context = candidate.ui_metadata["function_update"]
    source = model_service.get_model(context["source_model_id"])
    baseline = context.get("comparison_baseline") or {}
    parameters = baseline.get("parameters") or source.last_test_parameters or model_service._default_test_parameters(source)
    task = model_service.start_model_test(candidate.id, {"parameters": parameters, "solver_config": deepcopy(baseline.get("solver_config", source.last_test_solver_config)), "idempotency_key": f"function-update:{candidate.id}:{candidate.content_hash}"})
    return {"model": model_service.get_model(candidate.id), "task": task.view()}


def select_candidate_revisions(model_id: str, revisions: dict[str, int]):
    with STORE.lock:
        model = model_service.get_model(model_id)
        if model.published_at:
            raise HTTPException(status_code=409, detail="已发布模型不可原位更换依赖，请准备新版本。")
        dependencies = selected_dependencies(model, revisions)
        updated = model.model_copy(update={"function_dependencies": dependencies, "status": "developing",
            "tested_at": None, "tested_model_id": None, "tested_content_hash": None, "test_task_id": None,
            "dry_run_result": {}})
        updated = updated.model_copy(update={"content_hash": model_service._content_hash(updated)})
        STORE.models[model_id] = updated
        model_service._record_model_version_locked(updated)
        STORE.save_runtime()
        return updated


def apply_candidate(model_id: str):
    with STORE.lock:
        candidate = model_service.get_model(model_id)
        context = candidate.ui_metadata.get("function_update") or candidate.ui_metadata.get("component_update") or {}
        if not context:
            raise HTTPException(status_code=409, detail="不是函数更新候选版本。")
        if candidate.status == "published":
            return candidate
        source = model_service.get_model(context["source_model_id"])
        if source.published_at:
            active = [row for row in STORE.models.values() if row.model_family_id == source.model_family_id and row.is_active_version]
            if active and active[0].id != source.id:
                raise HTTPException(status_code=409, detail={"code": "FORMAL_VERSION_CHANGED", "message": "正式版本已经切换，请查看当前正式版本后重新准备更新。"})
        return model_service.publish_model(model_id)
