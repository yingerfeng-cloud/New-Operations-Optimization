from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.schemas.model import ModelView
from app.schemas.solve import SolveRequest
from app.services.job_service import job_service
from app.services.model_service import model_service
from app.services.skill_registry import skill_registry
from app.storage.memory_store import STORE


@pytest.fixture
def restore_runtime_state():
    with STORE.lock:
        models = dict(STORE.models)
        skills = dict(STORE.skills)
        active_versions = dict(STORE.active_model_versions)
        model_versions = {key: list(value) for key, value in STORE.model_versions.items()}
    try:
        yield
    finally:
        with STORE.lock:
            STORE.models.clear()
            STORE.models.update(models)
            STORE.skills.clear()
            STORE.skills.update(skills)
            STORE.active_model_versions.clear()
            STORE.active_model_versions.update(active_versions)
            STORE.model_versions.clear()
            STORE.model_versions.update(model_versions)


def test_trial_is_explicit_model_id_only_and_has_no_formal_skill(restore_runtime_state) -> None:
    suffix = uuid.uuid4().hex[:8]
    code = f"trial_governance_{suffix}"
    model = ModelView(
        id=f"MODEL-TRIAL-{suffix.upper()}",
        template_id=code,
        name="试运行治理验证",
        scene="test",
        version="v1.1",
        model_family_id=f"FAMILY-{suffix.upper()}",
        status="trial",
        semantic_spec={
            "model_code": code,
            "sets": [],
            "parameters": [],
            "variables": [],
            "constraints": [],
            "objectives": [],
        },
        created_at="2026-07-30 10:00:00",
        updated_at="2026-07-30 10:00:00",
        tested_at="2026-07-30 10:00:00",
    )
    with STORE.lock:
        STORE.models[model.id] = model

    with pytest.raises(HTTPException) as code_resolution:
        model_service.resolve_model(model_code=code)
    assert code_resolution.value.status_code == 404

    with pytest.raises(HTTPException) as task_by_code:
        job_service._prepare_request(SolveRequest(model_code=code))
    assert task_by_code.value.status_code == 409
    assert task_by_code.value.detail["code"] == "MODEL_NOT_PUBLISHED"

    direct_request = SolveRequest(model_id=model.id)
    job_service._prepare_request(direct_request)
    assert direct_request.model_id == model.id
    assert direct_request.payload["resolved_model_id"] == model.id

    with pytest.raises(HTTPException) as skill_generation:
        skill_registry.generate_skill(model.id)
    assert skill_generation.value.status_code == 409
    assert all(item["model_id"] != model.id for item in skill_registry.list_skills())

    detail = model_service.asset_detail(model.id)
    assert detail["skill_info"]["available"] is False
    assert detail["skill_info"]["access_policy"] == "explicit_model_id_only"
    assert detail["skill_info"]["skill_name"] is None
    assert detail["skill_info"]["debug_endpoint"] == f"/api/models/{model.id}/invoke"
