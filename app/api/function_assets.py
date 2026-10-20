from __future__ import annotations

from app.schemas.function_asset import FunctionAsset
from app.services.function_asset_service import function_asset_service
from fastapi import APIRouter

router = APIRouter(prefix="/api/function-assets", tags=["function-assets"])


@router.get("", response_model=list[FunctionAsset])
def list_function_assets() -> list[FunctionAsset]:
    return function_asset_service.list_assets()


@router.post("", response_model=FunctionAsset)
def create_function_asset(payload: dict) -> FunctionAsset:
    return function_asset_service.create_asset(payload)


@router.post("/import-csv", response_model=FunctionAsset)
def import_function_asset_csv(payload: dict) -> FunctionAsset:
    return function_asset_service.import_csv(payload)


@router.get("/{function_id}", response_model=FunctionAsset)
def get_function_asset(function_id: str) -> FunctionAsset:
    return function_asset_service.get_asset(function_id)


@router.put("/{function_id}", response_model=FunctionAsset)
def update_function_asset(function_id: str, payload: dict) -> FunctionAsset:
    return function_asset_service.update_asset(function_id, payload)


@router.get("/{function_id}/versions", response_model=list[FunctionAsset])
def list_function_asset_versions(function_id: str) -> list[FunctionAsset]:
    return function_asset_service.list_versions(function_id)


@router.get("/{function_id}/versions/{revision}", response_model=FunctionAsset)
def get_function_asset_version(function_id: str, revision: int) -> FunctionAsset:
    return function_asset_service.get_version(function_id, revision)


@router.delete("/{function_id}/versions/{revision}")
def delete_function_asset_version(function_id: str, revision: int) -> dict:
    from fastapi import HTTPException
    from app.services.function_asset_service import function_asset_references
    from app.storage.memory_store import STORE
    with STORE.lock:
        function_asset_service.get_version(function_id, revision)
        references = function_asset_references(function_id, revision)
        if references:
            raise HTTPException(status_code=409, detail={"code": "FUNCTION_REVISION_REFERENCED", "message": "模型或任务仍在使用此修订，必须保留历史内容。", "references": references})
        if function_asset_service.get_asset(function_id).revision == revision:
            raise HTTPException(status_code=409, detail="当前修订不能作为历史修订清理。")
        STORE.function_assets[function_id].get("_versions", {}).pop(str(revision), None)
        STORE.save_runtime()
    return {"status": "deleted"}


@router.post("/{function_id}/validate")
def validate_function_asset(function_id: str, payload: dict | None = None) -> dict:
    return function_asset_service.validate_asset(function_id, payload)


@router.post("/{function_id}/preview")
def preview_function_asset(function_id: str, payload: dict | None = None) -> dict:
    return function_asset_service.preview_asset(function_id, payload)
