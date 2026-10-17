"""Immutable function inputs shared by model tests, published calls and jobs."""
from copy import deepcopy
from typing import Any

from fastapi import HTTPException

from app.services.function_asset_service import get_function_asset, function_asset_hash


def dependency_ids(model: Any) -> set[str]:
    ids: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key in {"function_asset_id", "curve_asset_id"} and isinstance(item, str) and item:
                    ids.add(item)
                elif key == "function_asset_bindings" and isinstance(item, dict):
                    ids.update(str(asset_id) for asset_id in item.values() if asset_id)
                elif key not in {"function_dependencies", "_function_asset_snapshots"}:
                    visit(item)

    for value in (model.component_spec, model.semantic_spec, model.parameters, model.model_draft):
        visit(value)
    return ids


def capture_dependencies(model: Any) -> dict[str, dict]:
    dependencies = {}
    for function_id in sorted(dependency_ids(model)):
        asset = get_function_asset(function_id)
        asset.pop("_versions", None)
        asset.pop("referenced_by", None)
        dependencies[function_id] = {
            "revision": int(asset.get("revision") or 1),
            "content_hash": function_asset_hash(asset), "asset": deepcopy(asset),
        }
    return dependencies


def dependency_snapshots(model: Any, *, require_pinned: bool = False) -> dict[str, dict]:
    dependencies = model.function_dependencies or {}
    if require_pinned and dependency_ids(model) - dependencies.keys():
        raise HTTPException(status_code=409, detail={
            "code": "MODEL_DEPENDENCIES_UNPINNED",
            "message": "旧模型尚未固定函数依赖，请重新测试当前模型或创建新版本后测试发布。",
        })
    result = {}
    for function_id, dependency in dependencies.items():
        asset = dependency.get("asset")
        if not isinstance(asset, dict) or function_asset_hash(asset) != dependency.get("content_hash"):
            raise HTTPException(status_code=409, detail={"code": "MODEL_DEPENDENCY_CORRUPT", "message": f"函数依赖快照校验失败：{function_id}"})
        result[function_id] = deepcopy(asset)
    return result


def assert_dependencies_current(model: Any) -> None:
    current = capture_dependencies(model) if model.function_dependencies else {}
    signature = lambda dependencies: {key: (item["revision"], item["content_hash"]) for key, item in dependencies.items()}
    if model.function_dependencies and signature(current) != signature(model.function_dependencies):
        raise HTTPException(status_code=409, detail={
            "code": "MODEL_DEPENDENCY_OUTDATED", "message": "函数资产在测试后已发生变化，请重新测试后发布。",
        })
