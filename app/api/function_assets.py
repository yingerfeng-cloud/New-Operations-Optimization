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


@router.post("/{function_id}/validate")
def validate_function_asset(function_id: str, payload: dict | None = None) -> dict:
    return function_asset_service.validate_asset(function_id, payload)


@router.post("/{function_id}/preview")
def preview_function_asset(function_id: str, payload: dict | None = None) -> dict:
    return function_asset_service.preview_asset(function_id, payload)
