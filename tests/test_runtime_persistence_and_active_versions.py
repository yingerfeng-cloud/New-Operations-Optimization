from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.agent.platform_gateway import InProcessPlatformGateway
from app.schemas.model import AssetView, ModelPackage, ModelView
from app.schemas.solve import SolveRequest, TaskRecord
from app.services.invocation_service import invocation_service
from app.services.job_service import job_service
from app.services.model_service import model_service
from app.services.skill_registry import skill_registry
from app.storage.memory_store import MemoryStore, STORE
from app.utils import has_pyomo
from tests.test_model_skill_invocation import minimal_dispatch_payload


def _model(
    model_id: str,
    code: str,
    *,
    family: str,
    version: str,
    active: bool,
    builtin: bool = False,
    status: str = "published",
) -> ModelView:
    timestamp = "2026-07-14 10:00:00"
    return ModelView(
        id=model_id,
        template_id=code,
        name=f"model-{version}",
        scene="test",
        version=version,
        model_family_id=family,
        is_active_version=active,
        status=status,
        semantic_spec={"model_code": code, "sets": [], "parameters": [], "variables": [], "constraints": [], "objectives": []},
        ui_metadata={"managed_default_template": True} if builtin else {},
        created_at=timestamp,
        updated_at=timestamp,
        published_at=timestamp if status == "published" else None,
    )


def test_runtime_schema_v2_restores_models_versions_assets_tasks_and_results(tmp_path, monkeypatch) -> None:
    path = tmp_path / "runtime_store.json"
    monkeypatch.setenv("COPT_RUNTIME_STORE", str(path))
    store = MemoryStore()
    user_model = _model("MODEL-USER-V2", "runtime_case", family="FAMILY-RUNTIME", version="v2.0", active=True)
    builtin = _model("MODEL-BUILTIN-V1", "runtime_case", family="builtin:runtime_case", version="v1.0", active=False, builtin=True)
    store.models = {user_model.id: user_model, builtin.id: builtin}
    store.model_versions = {
        "FAMILY-RUNTIME": [{"model_id": user_model.id, "model_family_id": "FAMILY-RUNTIME", "version": "v2.0"}],
        "builtin:runtime_case": [{"model_id": builtin.id, "model_family_id": "builtin:runtime_case", "version": "v1.0"}],
    }
    store.active_model_versions = {"FAMILY-RUNTIME": user_model.id, "builtin:runtime_case": builtin.id}
    store.assets["ASSET-1"] = AssetView(id="ASSET-1", asset_type="model", name="asset", domain="test", description="asset", created_at="2026-07-14 10:00:00")
    store.tasks["TASK-RUNNING"] = TaskRecord(
        id="TASK-RUNNING",
        request=SolveRequest(model_id=user_model.id, payload={"api_key": "TOP-SECRET-RUNTIME-KEY"}),
        status="SOLVING",
    )
    store.tasks["TASK-SUCCESS"] = TaskRecord(id="TASK-SUCCESS", request=SolveRequest(model_id=user_model.id), status="SUCCESS", result={"objective": 1})
    store.results["TASK-SUCCESS"] = {"summary": {"objective": 1}, "result": {"status": "SUCCESS"}}

    store.save_runtime()
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 2
    assert "TOP-SECRET-RUNTIME-KEY" not in path.read_text(encoding="utf-8")
    assert set(payload["models"]) == {user_model.id}
    assert "builtin:runtime_case" not in payload["model_versions"]
    assert "builtin:runtime_case" not in payload["active_model_versions"]

    restored = MemoryStore()
    assert restored.models[user_model.id].version == "v2.0"
    assert restored.model_versions["FAMILY-RUNTIME"][0]["model_id"] == user_model.id
    assert restored.active_model_versions["FAMILY-RUNTIME"] == user_model.id
    assert restored.assets["ASSET-1"].name == "asset"
    assert restored.tasks["TASK-RUNNING"].status == "INTERRUPTED"
    assert "服务重启" in (restored.tasks["TASK-RUNNING"].error or "")
    assert restored.tasks["TASK-SUCCESS"].status == "SUCCESS"
    assert restored.results["TASK-SUCCESS"]["result"]["status"] == "SUCCESS"
    persisted_after_restart = json.loads(path.read_text(encoding="utf-8"))
    assert persisted_after_restart["tasks"]["TASK-RUNNING"]["status"] == "INTERRUPTED"


def test_runtime_persistence_survives_fresh_backend_process(tmp_path) -> None:
    path = tmp_path / "runtime_store_process_restart.json"
    repository_root = Path(__file__).resolve().parents[1]
    environment = {**os.environ, "COPT_RUNTIME_STORE": str(path), "RUNTIME_STORE_PATH": str(path)}
    writer = textwrap.dedent(
        """
        from app.schemas.model import ModelView
        from app.schemas.solve import SolveRequest, TaskRecord
        from app.storage.memory_store import STORE

        model = ModelView(
            id="MODEL-PROCESS-V2", template_id="process_restart_case", name="process-v2", scene="test",
            version="v2.0", model_family_id="FAMILY-PROCESS", is_active_version=True, status="published",
            semantic_spec={"model_code": "process_restart_case"}, created_at="2026-07-14 10:00:00",
            updated_at="2026-07-14 10:00:00", published_at="2026-07-14 10:00:00",
        )
        with STORE.lock:
            STORE.models[model.id] = model
            STORE.model_versions["FAMILY-PROCESS"] = [{"model_id": model.id, "model_family_id": "FAMILY-PROCESS", "version": "v2.0"}]
            STORE.active_model_versions["FAMILY-PROCESS"] = model.id
            STORE.tasks["TASK-PROCESS"] = TaskRecord(id="TASK-PROCESS", request=SolveRequest(model_id=model.id), status="SOLVING")
            STORE.results["TASK-DONE"] = {"result": {"status": "SUCCESS", "objective": 42}}
            STORE.save_runtime()
        """
    )
    reader = textwrap.dedent(
        """
        from app.services.model_service import model_service
        from app.storage.memory_store import STORE

        model_service.seed_default_templates()
        assert STORE.models["MODEL-PROCESS-V2"].version == "v2.0"
        assert STORE.active_model_versions["FAMILY-PROCESS"] == "MODEL-PROCESS-V2"
        assert STORE.tasks["TASK-PROCESS"].status == "INTERRUPTED"
        assert STORE.results["TASK-DONE"]["result"]["objective"] == 42
        assert model_service.resolve_model(model_code="process_restart_case").id == "MODEL-PROCESS-V2"
        print("BACKEND_PROCESS_RESTART_OK")
        """
    )

    first = subprocess.run([sys.executable, "-c", writer], cwd=repository_root, env=environment, capture_output=True, text=True, timeout=60)
    assert first.returncode == 0, first.stderr
    second = subprocess.run([sys.executable, "-c", reader], cwd=repository_root, env=environment, capture_output=True, text=True, timeout=90)
    assert second.returncode == 0, second.stderr
    assert "BACKEND_PROCESS_RESTART_OK" in second.stdout


def test_resolver_prefers_user_active_version_but_explicit_id_keeps_history() -> None:
    code = "active_resolver_case"
    builtin = _model("MODEL-RESOLVER-V1", code, family=f"builtin:{code}", version="v1.0", active=False, builtin=True)
    user = _model("MODEL-RESOLVER-V2", code, family="FAMILY-RESOLVER", version="v2.0", active=True)
    with STORE.lock:
        STORE.models[builtin.id] = builtin
        STORE.models[user.id] = user
        STORE.active_model_versions[user.model_family_id] = user.id

    assert model_service.resolve_model(model_code=code).id == user.id
    assert model_service.resolve_model(model_id=builtin.id).id == builtin.id

    request = SolveRequest(model_code=code, async_run=True)
    job_service._prepare_request(request)
    assert request.model_id == user.id
    assert request.payload["resolved_model_id"] == user.id


def test_duplicate_active_code_from_another_user_family_is_blocked() -> None:
    code = "duplicate_family_case"
    existing = _model("MODEL-FAMILY-A", code, family="FAMILY-A", version="v1.0", active=True)
    candidate = _model("MODEL-FAMILY-B", code, family="FAMILY-B", version="v1.0", active=False, status="tested")
    with STORE.lock:
        STORE.models[existing.id] = existing
        STORE.models[candidate.id] = candidate

    with pytest.raises(HTTPException) as exc_info:
        model_service._validate_publish_code_ownership(candidate)
    assert exc_info.value.status_code == 409
    assert "模型编码已被其他模型家族使用" in str(exc_info.value.detail)


def test_new_version_inherits_family_code_and_increments_version() -> None:
    code = "version_identity_case"
    source = _model("MODEL-VERSION-V1", code, family="FAMILY-VERSION", version="v1.2", active=True)
    with STORE.lock:
        STORE.models[source.id] = source
    package = ModelPackage(
        name="new version",
        scene="test",
        template_id=code,
        semantic_spec={"model_code": code},
        supersedes_model_id=source.id,
    )

    prepared = model_service._prepare_version_identity(package)
    assert prepared.model_family_id == source.model_family_id
    assert prepared.supersedes_model_id == source.id
    assert prepared.version == "v1.3"
    assert prepared.is_active_version is False

    created = model_service.create_model_version(source.id, {"name": "editable v1.3"})
    assert created.id != source.id
    assert created.model_family_id == source.model_family_id
    assert created.supersedes_model_id == source.id
    assert created.version == "v1.3"
    assert created.status == "developing"
    assert created.is_active_version is False
    assert model_service.get_model(source.id).status == "published"
    assert {item.id for item in model_service.list_model_versions(source.id)} >= {source.id, created.id}
    with pytest.raises(HTTPException) as delete_error:
        model_service.delete_model(source.id)
    assert delete_error.value.status_code == 409


def test_skill_and_agent_gateway_invoke_active_user_version(monkeypatch) -> None:
    code = "agent_active_version_case"
    skill_name = f"run_{code}"
    builtin = _model("MODEL-AGENT-V1", code, family=f"builtin:{code}", version="v1.0", active=False, builtin=True)
    user = _model("MODEL-AGENT-V2", code, family="FAMILY-AGENT", version="v2.0", active=True)
    with STORE.lock:
        STORE.models[builtin.id] = builtin
        STORE.models[user.id] = user
        STORE.active_model_versions[user.model_family_id] = user.id
        STORE.skills[skill_name] = {"skill_name": skill_name, "model_id": builtin.id, "status": "enabled"}

    monkeypatch.setattr(invocation_service, "model_schema", lambda model_id: {"model_id": model_id, "model_code": code, "input_schema": []})
    monkeypatch.setattr(invocation_service, "invoke_model", lambda model_id, body: {"status": "SUCCESS", "model_id": model_id})

    skill_response = skill_registry.run_skill(skill_name, {"parameters": {}, "options": {"strict_runtime_parameters": False}})
    agent_response = InProcessPlatformGateway().run_skill(skill_name, {"parameters": {}, "options": {"strict_runtime_parameters": False}})

    assert skill_response["resolved_model_id"] == user.id
    assert agent_response["resolved_model_id"] == user.id


def test_publish_new_version_switches_skill_and_agent_to_new_asset(monkeypatch) -> None:
    if not has_pyomo():
        pytest.skip("pyomo is required for publish dry-run")
    pytest.importorskip("highspy")
    builtin = model_service.resolve_model(model_code="economic_dispatch")
    builtin_copy = model_service.copy_model(builtin.id)
    assert not (builtin_copy.ui_metadata or {}).get("managed_default_template")
    model_service.delete_model(builtin_copy.id)

    payload = minimal_dispatch_payload()
    code = f"active_version_{uuid.uuid4().hex[:8]}"
    payload["semantic_spec"]["model_code"] = code
    first_draft = model_service.create_model(ModelPackage.model_validate(payload))
    model_service.run_model_test_case(first_draft.id, {"parameters": first_draft.parameters})
    first = model_service.publish_model(first_draft.id)
    second_draft = model_service.create_model_version(first.id, {"name": f"{first.name}-v2"})
    model_service.run_model_test_case(second_draft.id, {"parameters": second_draft.parameters})
    second = model_service.publish_model(second_draft.id)
    skill_name = f"run_{code}"

    assert model_service.resolve_model(model_code=code).id == second.id
    assert second.published_by == "system"
    assert model_service.resolve_model(model_id=first.id).id == first.id
    assert model_service.get_model(first.id).is_active_version is False
    assert model_service.get_model(first.id).status == "published"
    with STORE.lock:
        STORE.skills[skill_name] = {"skill_name": skill_name, "model_id": first.id, "status": "enabled"}

    monkeypatch.setattr(invocation_service, "model_schema", lambda model_id: {"model_id": model_id, "model_code": code, "input_schema": []})
    monkeypatch.setattr(invocation_service, "invoke_model", lambda model_id, body: {"status": "SUCCESS", "model_id": model_id})
    skill_response = skill_registry.run_skill(skill_name, {"parameters": {}, "options": {"strict_runtime_parameters": False}})
    agent_response = InProcessPlatformGateway().run_skill(skill_name, {"parameters": {}, "options": {"strict_runtime_parameters": False}})

    assert skill_response["resolved_model_id"] == second.id
    assert agent_response["resolved_model_id"] == second.id
