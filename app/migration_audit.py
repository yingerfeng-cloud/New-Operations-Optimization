"""Inspect a deployment copy without importing stores, creating secrets or writing data."""
from typing import Any

from app.function_asset_content import function_asset_hash


def _function_ids(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, list):
        for item in value:
            found.update(_function_ids(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in {"function_asset_id", "curve_asset_id"} and isinstance(item, str):
                found.add(item)
            elif key == "function_asset_bindings" and isinstance(item, dict):
                found.update(str(asset_id) for asset_id in item.values() if asset_id)
            elif key not in {"function_dependencies", "_function_asset_snapshots"}:
                found.update(_function_ids(item))
    return found


def _snapshot_issues(ids: set[str], dependencies: dict) -> list[dict]:
    issues = [{"function_id": key, "issue": "missing_snapshot", "action": "verified_backup_or_explicit_new_version"} for key in sorted(ids - dependencies.keys())]
    for function_id, row in dependencies.items():
        asset = row.get("asset") if isinstance(row, dict) else None
        try:
            valid = (isinstance(asset, dict) and asset.get("function_id") == function_id
                     and asset.get("revision", 1) == row.get("revision") and function_asset_hash(asset) == row.get("content_hash"))
        except (ValueError, TypeError):
            valid = False
        if not valid:
            issues.append({"function_id": function_id, "issue": "corrupt_snapshot", "action": "restore_verified_original_keep_results"})
    return issues


def _time_values(model: dict) -> list[dict]:
    rows: list[dict] = []

    def visit(value: Any, path: str):
        if not isinstance(value, dict):
            return
        for field, factor in (("time_step_seconds", 1), ("interval_minutes", 60), ("delta_t", 3600)):
            item = value.get(field)
            if isinstance(item, (int, float)) and not isinstance(item, bool) and item > 0:
                rows.append({"field": f"{path}.{field}", "seconds": item * factor})
        for key, item in value.items():
            if key in {"ui_metadata", "time_dimension", "semantic_spec", "component_spec", "model_draft", "runtime_parameters", "parameters", "sample_runtime_parameters", "advanced"}:
                visit(item, f"{path}.{key}")
    visit(model, "model")
    return rows


def audit_runtime_copy(payload: dict, *, secret_file_present: bool = False, environment_secret_present: bool = False) -> dict:
    models = payload.get("models") or {}
    tasks = payload.get("tasks") or {}
    model_rows = []
    for model_id, model in models.items():
        ids = set().union(*(_function_ids(model.get(key)) for key in ("component_spec", "semantic_spec", "model_draft", "parameters")))
        issues = _snapshot_issues(ids, model.get("function_dependencies") or {})
        times = _time_values(model)
        if times and max(row["seconds"] for row in times) - min(row["seconds"] for row in times) > 1e-7:
            issues.append({"issue": "time_contract_conflict", "values": times, "action": "keep_original_create_consistent_version_and_retest"})
        model_rows.append({"model_id": model_id, "version": model.get("version"), "status": model.get("status"), "issues": issues})
    task_rows = []
    for task_id, task in tasks.items():
        request = task.get("request") or {}
        runtime = request.get("payload") or {}
        dependencies = (runtime.get("_result_context") or {}).get("function_dependencies") or {}
        issues = _snapshot_issues(_function_ids(runtime), dependencies)
        if not any(runtime.get(key) for key in ("semantic_spec", "component_spec", "generic_spec")):
            issues.append({"issue": "missing_prepared_model", "action": "keep_results_rebuild_explicit_model_for_new_calculation"})
        snapshots = runtime.get("_function_asset_snapshots") or {}
        for function_id, row in dependencies.items():
            try:
                valid = isinstance(row, dict) and function_id in snapshots and function_asset_hash(snapshots[function_id]) == row.get("content_hash")
            except (ValueError, TypeError):
                valid = False
            if not valid:
                issues.append({"issue": "missing_or_inconsistent_task_snapshot", "function_id": function_id})
        task_rows.append({"task_id": task_id, "model_id": request.get("model_id"), "replayability": "result_only_unknown_history" if issues else "recorded_inputs_available",
                          "has_result": bool(task.get("result") or task_id in (payload.get("results") or {})), "issues": issues})
    bindings = []
    for name, skill in (payload.get("skills") or {}).items():
        model_id = skill.get("model_id")
        if model_id:
            target = models.get(model_id)
            bindings.append({"skill": name, "model_id": model_id, "recorded_version": skill.get("model_version"),
                             "check": "fixed_target_missing_or_builtin" if target is None else "fixed_target_offline" if target.get("status") == "offline" else "fixed_target_retained",
                             "action": "review_binding_explicitly_no_automatic_migration"})
    config = payload.get("llm_config") or {}
    ciphertext = str(config.get("key_ciphertext") or "")
    if config.get("api_key"):
        key_state = "legacy_plaintext_requires_reentry_or_secure_migration"
    elif ciphertext.startswith("fernet:v1:"):
        key_state = "fernet_material_present_not_decryption_verified" if secret_file_present or environment_secret_present else "fernet_secret_missing"
    elif ciphertext:
        key_state = "legacy_xor_original_host_user_path_required"
    else:
        key_state = "no_stored_key_environment_not_examined"
    return {"read_only": True, "schema_version": payload.get("schema_version"), "models": model_rows, "tasks": task_rows,
            "service_bindings": bindings, "llm": {"key_state": key_state, "enabled": config.get("enabled"), "decryption_executed": False},
            "summary": {"model_count": len(model_rows), "models_requiring_review": sum(bool(row["issues"]) for row in model_rows),
                        "task_count": len(task_rows), "tasks_with_unknown_history": sum(bool(row["issues"]) for row in task_rows)},
            "limits": ["Missing historical curves or secrets are never reconstructed from current assets.",
                       "Recorded inputs do not guarantee identical solver output across environments; recheck objectives and constraints.",
                       "Run upgrade acceptance on a copy with retained secret material before changing the live deployment."]}
