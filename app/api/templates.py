from __future__ import annotations

from fastapi import APIRouter

import app.model_components  # noqa: F401
from app.model_components.registry import list_component_catalog
from app.schemas.model import ModelView
from app.services.template_service import template_library

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("")
def list_templates() -> list[dict]:
    return template_library.list_templates()


@router.get("/{template_code}")
def get_template(template_code: str) -> dict:
    return template_library.get_template(template_code)


@router.post("/{template_code}/clone", response_model=ModelView)
def clone_template(template_code: str) -> ModelView:
    return template_library.clone_template(template_code)


@router.post("/{template_code}/publish")
def publish_template(template_code: str) -> dict:
    return template_library.publish(template_code)


@router.post("/{template_code}/unpublish")
def unpublish_template(template_code: str) -> dict:
    return template_library.unpublish(template_code)


@router.get("/{template_code}/parameter-schema")
def get_parameter_schema(template_code: str) -> list[dict]:
    return template_library.parameter_schema(template_code)


@router.get("/{template_code}/sample-runtime-parameters")
def get_sample_runtime_parameters(template_code: str) -> dict:
    return template_library.sample_runtime_parameters(template_code)


@router.get("/{template_code}/model-draft")
def get_template_model_draft(template_code: str) -> dict:
    return template_library.get_template(template_code).get("model_draft", {})


@router.get("/component-registry/catalog")
def get_component_registry_catalog() -> list[dict]:
    return list_component_catalog()
