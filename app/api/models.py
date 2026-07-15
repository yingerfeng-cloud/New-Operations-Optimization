from __future__ import annotations

from copy import deepcopy
from typing import Any

from fastapi import APIRouter

from app.schemas.model import AssetPackage, AssetView, ModelPackage, ModelView
from app.services.invocation_service import invocation_service
from app.services.model_service import model_service

router = APIRouter(prefix="/api", tags=["models"])


def _model_package_from_payload(payload: dict[str, Any] | ModelPackage) -> ModelPackage:
    if isinstance(payload, ModelPackage):
        return payload
    data = deepcopy(payload)
    if "scene" not in data:
        data["scene"] = data.get("scenario") or data.get("description") or data.get("name") or "custom_model"
    if "name" not in data:
        data["name"] = data.get("display_name") or data.get("code") or data.get("model_code") or "custom_model"
    if "template_id" not in data:
        data["template_id"] = data.get("code") or data.get("model_code")
    if isinstance(data.get("constraints"), list):
        data.setdefault("draft_constraints", data["constraints"])
        data["constraints"] = {}
    if isinstance(data.get("parameters"), list):
        data.setdefault("parameter_schema", {"parameters": data["parameters"]})
        data["parameters"] = deepcopy(data.get("sample_runtime_parameters") or {})
    looks_like_template_detail = any(key in payload for key in ("code", "model_code", "component_spec", "sets", "variables", "objectives"))
    if "semantic_spec" not in data and looks_like_template_detail:
        semantic = deepcopy(payload)
        if isinstance(semantic.get("constraints"), list):
            semantic["draft_constraints"] = semantic["constraints"]
        data["semantic_spec"] = semantic
    if "objective" not in data and isinstance(data.get("objectives"), list) and data["objectives"]:
        data["objective"] = data["objectives"][0].get("code") or "objective"
    return ModelPackage(**data)


@router.post("/models", response_model=ModelView)
def create_model(model: dict[str, Any]) -> ModelView:
    return model_service.create_model(_model_package_from_payload(model))


@router.get("/models", response_model=list[ModelView])
def list_models() -> list[ModelView]:
    return model_service.list_models()


@router.get("/models/{model_id}", response_model=ModelView)
def get_model(model_id: str) -> ModelView:
    return model_service.get_model(model_id)


@router.put("/models/{model_id}", response_model=ModelView)
def update_model(model_id: str, model: dict[str, Any]) -> ModelView:
    return model_service.update_model(model_id, _model_package_from_payload(model))


@router.post("/models/{model_id}/publish", response_model=ModelView)
def publish_model(model_id: str) -> ModelView:
    return model_service.publish_model(model_id)


@router.post("/models/{model_id}/test", response_model=ModelView)
def test_model(model_id: str, test_case: dict) -> ModelView:
    return model_service.run_model_test_case(model_id, test_case)


@router.post("/models/{model_id}/offline", response_model=ModelView)
def offline_model(model_id: str) -> ModelView:
    return model_service.offline_model(model_id)


@router.delete("/models/{model_id}")
def delete_model(model_id: str) -> dict[str, str]:
    return model_service.delete_model(model_id)


@router.post("/models/{model_id}/copy", response_model=ModelView)
def copy_model(model_id: str) -> ModelView:
    return model_service.copy_model(model_id)


@router.get("/models/{model_id}/versions", response_model=list[ModelView])
def list_model_versions(model_id: str) -> list[ModelView]:
    return model_service.list_model_versions(model_id)


@router.post("/models/{model_id}/versions", response_model=ModelView)
def create_model_version(model_id: str, overrides: dict[str, Any] | None = None) -> ModelView:
    return model_service.create_model_version(model_id, overrides)


@router.get("/models/{model_id}/schema")
def model_schema(model_id: str) -> dict:
    return invocation_service.model_schema(model_id)


@router.get("/models/{model_id}/asset-detail")
def model_asset_detail(model_id: str) -> dict:
    return model_service.asset_detail(model_id)


@router.post("/assets", response_model=AssetView)
def create_asset(asset: AssetPackage) -> AssetView:
    return model_service.create_asset(asset)


@router.get("/assets", response_model=list[AssetView])
def list_assets() -> list[AssetView]:
    return model_service.list_assets()
