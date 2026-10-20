from copy import deepcopy
import json
import os
import subprocess
import sys
from threading import Event, Thread
from uuid import uuid4

import pytest

from app.jobs.job_runner import job_runner
from app.schemas.solve import SolveRequest
from app.services.job_service import job_service
from app.storage.memory_store import STORE
from app.templates.power_templates import get_template
from tests.test_helpers import test_and_publish_model


def test_template_clone_retains_builder_reference_and_async_publish_flow(client):
    base = client.get("/api/models/MODEL-POWER-ECONOMIC-DISPATCH").json()
    code = "review_template_clone_" + uuid4().hex[:8]
    semantic = deepcopy(base["semantic_spec"])
    semantic.update(model_code=code, template_code="economic_dispatch", build_mode="template_based")
    created = client.post("/api/models", json={"name": "Template clone", "scene": "review", "build_mode": "template_based", "template_id": code, "semantic_spec": semantic, "parameters": base["parameters"], "ui_metadata": base["ui_metadata"]})
    assert created.status_code == 200, created.text
    model_id = created.json()["id"]
    tested = client.post(f"/api/models/{model_id}/test-jobs", json={"parameters": base["parameters"]})
    assert tested.status_code == 200, tested.text
    assert tested.json()["status"] == "SUCCESS", tested.text
    published = client.post(f"/api/models/{model_id}/publish")
    assert published.status_code == 200, published.text
    result = client.post(f"/api/models/{model_id}/invoke", json={"parameters": base["parameters"], "options": {"mode": "sync", "explain": False}})
    assert result.status_code == 200, result.text
    assert result.json()["objective_value"] == pytest.approx(160300)


@pytest.mark.parametrize("stage", ["build", "solve", "format"])
@pytest.mark.parametrize("action", ["cancel", "delete", "retry"])
def test_late_worker_cannot_revive_or_overwrite_task(monkeypatch, stage, action):
    from app.builders.pyomo_builder import PyomoModelBuilder
    from app.explain.result_formatter import SolveResultFormatter
    from app.solvers.solver_router import solver_router

    monkeypatch.setenv("OPTIFORGE_SYNC_JOBS", "false")
    monkeypatch.setattr(job_runner, "start", lambda task_id: None)
    owner, method = {"build": (PyomoModelBuilder, "build"), "solve": (solver_router, "solve"), "format": (SolveResultFormatter, "format")}[stage]
    original = getattr(owner, method)
    entered, release = Event(), Event()

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(10), "test barrier was not released"
        return original(*args, **kwargs)

    monkeypatch.setattr(owner, method, blocked)
    params = deepcopy(get_template("economic_dispatch")["sample_runtime_parameters"])
    task = job_service.create_task(SolveRequest(model_code="economic_dispatch", parameters=params))
    old_attempt = task.attempt_id
    errors = []

    def run():
        try:
            job_runner.run(task.id)
        except BaseException as exc:
            errors.append(exc)

    worker = Thread(target=run, daemon=True)
    worker.start()
    try:
        assert entered.wait(10)
        assert job_service.cancel_task(task.id).status == "CANCELLED"
        if action == "delete":
            job_service.delete_task(task.id)
        elif action == "retry":
            retried = job_service.retry_task(task.id)
            assert retried.attempt_id != old_attempt
    finally:
        release.set()
        worker.join(15)
    assert not worker.is_alive()
    assert not errors
    assert task.id not in STORE.results
    if action == "delete":
        assert task.id not in STORE.tasks
    elif action == "retry":
        current = job_service.get_task(task.id)
        assert current.status == "PENDING"
        assert current.result is None
        monkeypatch.setattr(owner, method, original)
        job_runner.run(task.id, current.attempt_id)
        assert job_service.get_task(task.id).status == "SUCCESS"
        assert STORE.results[task.id]["result"]["objective_value"] == pytest.approx(160300)
    else:
        current = job_service.get_task(task.id)
        assert current.status == "CANCELLED"
        assert current.result is None


def _curve_model(client):
    asset_id = "review_curve_" + uuid4().hex[:8]
    asset = client.post("/api/function-assets", json={"function_id": asset_id, "name": "Review curve", "points": [[0, 0], [20, 20]], "solve_strategy": "segment_binary", "status": "published"})
    assert asset.status_code == 200, asset.text
    code = "review_dependency_" + uuid4().hex[:8]
    variables = [{"name": "volume", "indices": ["time"], "lower_bound": 10, "upper_bound": 10}, {"name": "level", "indices": ["time"], "lower_bound": 0}]
    component = {
        "model_code": code, "build_mode": "component_based", "required_solver_capabilities": ["MILP"],
        "sets": [{"code": "time", "values": [0]}], "variables": variables,
        "components": [{"type": "function_mapping_component", "function_asset_id": asset_id, "x": "volume[t]", "y": "level[t]", "indices": [{"set": "time", "alias": "t"}], "solve_strategy": "segment_binary"}],
        "objective": {"sense": "minimize", "terms": [{"term_id": "level_cost", "expression": "sum(level[t] for t in time)", "weight_key": "piecewise_cost", "weight": 1, "supported_by_backend": True, "solve_participation": "solve_active"}]},
    }
    response = client.post("/api/models", json={"name": "Review dependency", "scene": "review", "build_mode": "component_based", "problem_type": "MILP", "model_problem_type": "MILP", "parameters": {"horizon": 1}, "component_spec": component, "semantic_spec": {**component, "parameters": [], "variables": [{"code": row["name"], "dimension": row["indices"]} for row in variables]}})
    assert response.status_code == 200, response.text
    return asset_id, response.json()["id"]


def test_published_dependencies_are_replayable_and_new_version_is_explicit(client):
    asset_id, model_id = _curve_model(client)
    test_and_publish_model(client, model_id, {"horizon": 1})

    def invoke(id):
        result = client.post(f"/api/models/{id}/invoke", json={"parameters": {"horizon": 1}, "options": {"mode": "sync", "explain": False}})
        assert result.status_code == 200, result.text
        assert result.json()["status"] == "SUCCESS", result.text
        return result.json()

    assert invoke(model_id)["objective_value"] == pytest.approx(10)
    skill = client.post(f"/api/models/{model_id}/skills/generate", json={"use_llm": False})
    assert skill.status_code == 200, skill.text
    original_model = client.get(f"/api/models/{model_id}").json()
    changed = client.put(f"/api/function-assets/{asset_id}", json={"points": [[0, 0], [20, 40]]})
    assert changed.status_code == 200, changed.text
    assert changed.json()["revision"] == 2
    historical = client.get(f"/api/function-assets/{asset_id}/versions/1")
    assert historical.status_code == 200, historical.text
    assert historical.json()["points"] == [[0, 0], [20, 20]]
    assert invoke(model_id)["objective_value"] == pytest.approx(10)
    skill_result = client.post(f"/api/skills/{skill.json()['skill_name']}/run", json={"parameters": {"horizon": 1}, "options": {"mode": "sync", "explain": False}})
    assert skill_result.status_code == 200, skill_result.text
    assert skill_result.json()["objective_value"] == pytest.approx(10)
    replay = '''
import json, sys
from app.main import app
from fastapi.testclient import TestClient
with TestClient(app) as client:
 response = client.post('/api/models/' + sys.argv[1] + '/invoke', json={'parameters': {'horizon': 1}, 'options': {'mode': 'sync', 'explain': False}})
 print(json.dumps({'http': response.status_code, 'objective': response.json().get('objective_value')}))
'''
    restored = subprocess.run([sys.executable, "-c", replay, model_id], env={**os.environ, "OPTIFORGE_RUNTIME_STORE": str(STORE.persistence_path), "RUNTIME_STORE_PATH": str(STORE.persistence_path)}, capture_output=True, text=True, check=True)
    assert json.loads(restored.stdout.strip().splitlines()[-1]) == {"http": 200, "objective": 10}, restored.stderr
    assert client.get(f"/api/models/{model_id}").json()["content_hash"] == original_model["content_hash"]
    new = client.post(f"/api/models/{model_id}/versions", json={}).json()
    assert "id" in new, new
    selected = client.put(f"/api/models/{new['id']}/function-dependencies", json={"revisions": {asset_id: 2}})
    assert selected.status_code == 200, selected.text
    test_and_publish_model(client, new["id"], {"horizon": 1})
    assert invoke(new["id"])["objective_value"] == pytest.approx(20)


def test_library_update_does_not_invalidate_selected_test_evidence(client):
    asset_id, model_id = _curve_model(client)
    assert client.post(f"/api/models/{model_id}/test", json={"parameters": {"horizon": 1}}).status_code == 200
    assert client.put(f"/api/function-assets/{asset_id}", json={"points": [[0, 0], [20, 40]]}).status_code == 200
    published = client.post(f"/api/models/{model_id}/publish")
    assert published.status_code == 200, published.text
    assert published.json()["function_dependencies"][asset_id]["revision"] == 1


def test_all_http_entry_points_enforce_configured_token(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.platform_main import create_platform_app
    from app.agent_main import create_agent_app

    monkeypatch.setenv("OPTIMIZATION_PLATFORM_API_TOKEN", "review-token")
    for target in [app, create_platform_app(), create_agent_app()]:
        with TestClient(target) as http:
            for path, method, payload in [("/api/llm/config", "get", {}), ("/api/llm/config", "put", {"provider": "disabled", "enabled": False})]:
                call = getattr(http, method)
                options = {"json": payload} if method == "put" else {}
                for headers in ({}, {"Authorization": "Bearer wrong"}):
                    assert call(path, headers=headers, **options).status_code == 401
                assert call(path, headers={"Authorization": "Bearer review-token"}, **options).status_code == 200


def test_offline_builtin_and_template_survive_new_process():
    from app.services.model_service import model_service
    from app.services.template_service import template_library
    model_service.offline_model("MODEL-POWER-ECONOMIC-DISPATCH")
    template_library.unpublish("economic_dispatch")
    code = '''
import json
from app.main import app
from app.services.model_service import model_service
from app.services.template_service import template_library
from fastapi.testclient import TestClient
with TestClient(app) as client:
 print(json.dumps([model_service.get_model("MODEL-POWER-ECONOMIC-DISPATCH").status, template_library.get_template("economic_dispatch")["status"], client.post("/api/optimize/run", json={"model_code":"economic_dispatch"}).status_code]))
'''
    output = subprocess.run([sys.executable, "-c", code], env={**os.environ, "OPTIFORGE_RUNTIME_STORE": str(STORE.persistence_path), "RUNTIME_STORE_PATH": str(STORE.persistence_path)}, capture_output=True, text=True, check=True)
    assert json.loads(output.stdout.strip().splitlines()[-1]) == ["offline", "offline", 409]


def test_llm_key_survives_hostname_change_and_reports_missing_secret(monkeypatch):
    from app.services.llm_service import llm_service
    monkeypatch.delenv("OPTIFORGE_CONFIG_SECRET", raising=False)
    monkeypatch.delenv("OPTIFORGE_CONFIG_SECRET_FILE", raising=False)
    encrypted = llm_service._encrypt_key("synthetic-review-key")
    monkeypatch.setattr("socket.gethostname", lambda: "replacement-container")
    assert llm_service._decrypt_key(encrypted) == "synthetic-review-key"
    (STORE.persistence_path.parent / ".optiforge-config-secret").unlink()
    assert llm_service._decrypt_key(encrypted) == ""
    assert llm_service._key_recovery_error


def test_private_agent_context_cannot_execute_via_legacy_api(client):
    from app.agent.conversation_store import conversation_store
    from app.agent.v3.store import agent_v3_store
    conversation = conversation_store.create("Review private boundary")
    task = agent_v3_store.create_task(conversation["conversation_id"], "TURN-REVIEW", "Pending optimization", "optimization_create_or_continue")
    context = conversation_store.create_task_context(conversation["conversation_id"], task["task_id"])
    agent_v3_store.update_task(task["task_id"], execution_context_id=context["conversation_id"], status="APPROVAL_REQUIRED")
    approval = agent_v3_store.create_approval(task["task_id"], "Approve test", {"action": "confirm_invoke"})
    # Historical stored events are projected at read time as well.
    events = client.get(f"/api/agent/v3/conversations/{conversation['conversation_id']}/events")
    assert events.status_code == 200, events.text
    assert context["conversation_id"] not in events.text
    assert "execution_context_id" not in events.text
    before = len(STORE.tasks)
    rejected = client.post("/api/agent/confirm-invoke", json={"conversation_id": context["conversation_id"]})
    assert rejected.status_code == 404
    assert len(STORE.tasks) == before
    assert agent_v3_store.get_task(task["task_id"])["status"] == "APPROVAL_REQUIRED"
    assert agent_v3_store.get_approval(approval["approval_id"])["status"] == "PENDING"


def test_async_model_test_has_real_evidence_and_submission_is_idempotent(client, monkeypatch):
    asset_id, model_id = _curve_model(client)
    monkeypatch.setenv("OPTIFORGE_SYNC_JOBS", "false")
    monkeypatch.setattr(job_runner, "start", lambda id: None)
    payload = {"parameters": {"horizon": 1}, "idempotency_key": "review-test-" + uuid4().hex}
    first = client.post(f"/api/models/{model_id}/test-jobs", json=payload)
    assert first.status_code == 200, first.text
    id = first.json()["id"]
    duplicate = client.post(f"/api/models/{model_id}/test-jobs", json=payload)
    assert duplicate.json()["id"] == id
    job_runner.run(id)
    assert job_service.get_task(id).status == "SUCCESS", job_service.get_task(id).error
    tested = client.get(f"/api/models/{model_id}").json()
    assert tested["status"] == "trial"
    assert tested["tested_content_hash"] == tested["content_hash"]
    assert client.post(f"/api/models/{model_id}/publish").status_code == 200
    assert tested["function_dependencies"][asset_id]["asset"]["points"] == [[0, 0], [20, 20]]
