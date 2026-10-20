"""Draft and evidence recovery on isolated synthetic assets."""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.jobs.job_runner import job_runner
from app.services.job_service import job_service
from app.services.model_service import model_service
from app.storage.memory_store import STORE, MemoryStore
from tests.test_review_execution_contracts import _curve_model


def test_incomplete_draft_roundtrip_and_no_publish_evidence(client):
    code = "review_partial_" + uuid4().hex[:8]
    draft = {"basic_info": {"name": "合成半成品", "scenario": "review", "model_code": code, "builder_mode": "generic_linear", "solver": "HiGHS"},
             "semantic": {"sets": [{"code": "site", "values": ["B", "A"]}], "parameters": [{"code": "cost", "dimension": ["site"]}], "variables": []},
             "components": [], "formulas": [], "runtime_parameters": {"cost": [10, 20]}, "advanced": {}}
    response = client.post("/api/models", json={"name": "合成半成品", "scene": "review", "model_draft": draft, "semantic_spec": {"model_code": code, **draft["semantic"]}})
    assert response.status_code == 200, response.text
    model = response.json()
    assert model["status"] == "developing"
    assert not model["tested_content_hash"]
    assert model["model_draft"]["semantic"]["sets"][0]["values"] == ["B", "A"]
    model["model_draft"]["semantic"]["parameters"].append({"code": "capacity", "dimension": ["site"]})
    model["expected_content_hash"] = model["content_hash"]
    saved = client.put(f"/api/models/{model['id']}", json=model)
    assert saved.status_code == 200, saved.text
    assert saved.json()["id"] == model["id"]
    assert client.post(f"/api/models/{model['id']}/publish").status_code in {409, 422}
    assert not model_service.get_model(model["id"]).published_at


def test_stale_autosave_and_return_to_draft_do_not_overwrite_newer_content(client):
    _, model_id = _curve_model(client)
    original = client.get(f"/api/models/{model_id}").json()
    changed = deepcopy(original)
    changed["name"] = "另一位置已保存"
    changed["expected_content_hash"] = original["content_hash"]
    saved = client.put(f"/api/models/{model_id}", json=changed)
    assert saved.status_code == 200, saved.text
    original["expected_content_hash"] = original["content_hash"]
    conflict = client.put(f"/api/models/{model_id}", json=original)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "MODEL_DRAFT_CONFLICT"
    assert model_service.get_model(model_id).name == "另一位置已保存"
    tested = client.post(f"/api/models/{model_id}/test-jobs", json={"parameters": {"horizon": 1}})
    assert tested.json()["status"] == "SUCCESS", tested.text
    before = model_service.get_model(model_id)
    rejected = client.post(f"/api/models/{model_id}/return-to-draft", json={"expected_content_hash": original["content_hash"]})
    assert rejected.status_code == 409
    after = model_service.get_model(model_id)
    assert after.status == before.status == "trial"
    assert after.tested_content_hash == before.tested_content_hash


def test_test_job_pointer_manifest_and_trace_survive_persistence(client, monkeypatch):
    f, model_id = _curve_model(client)
    monkeypatch.setenv("OPTIFORGE_SYNC_JOBS", "false")
    monkeypatch.setattr(job_runner, "start", lambda _: None)
    key = uuid4().hex
    body = {"parameters": {"horizon": 1}, "idempotency_key": key}
    first = client.post(f"/api/models/{model_id}/test-jobs", json=body)
    again = client.post(f"/api/models/{model_id}/test-jobs", json=body)
    assert first.status_code == again.status_code == 200
    task = first.json()
    assert task["id"] == again.json()["id"]
    source = client.get(f"/api/models/{model_id}").json()
    assert source["test_task_id"] == task["id"]
    assert task["trace"]["model_test"]["source_content_hash"] == source["content_hash"]
    assert task["trace"]["model_test"]["submission_key"] == key
    restored = MemoryStore()
    assert restored.models[model_id].test_task_id == task["id"]
    assert restored.tasks[task["id"]].request.payload["_model_test"]["dependencies"][f]["revision"] == 1
    # A process restart marks interrupted work; this is not mid-solver continuation.
    assert restored.tasks[task["id"]].status == "INTERRUPTED"
    job_runner.run(task["id"])
    finished = job_service.get_task(task["id"])
    assert finished.objective_value == pytest.approx(10)
    model = model_service.get_model(model_id)
    assert model.tested_content_hash == finished.trace["model_test"]["tested_content_hash"] == model.content_hash


def test_async_test_modified_content_cannot_restore_stale_evidence(client, monkeypatch):
    _, model_id = _curve_model(client)
    monkeypatch.setenv("OPTIFORGE_SYNC_JOBS", "false")
    monkeypatch.setattr(job_runner, "start", lambda _: None)
    key = uuid4().hex
    first = client.post(f"/api/models/{model_id}/test-jobs", json={"parameters": {"horizon": 1}, "idempotency_key": key}).json()
    current = client.get(f"/api/models/{model_id}").json()
    current["name"] = "测试途中修改"
    assert client.put(f"/api/models/{model_id}", json=current).status_code == 200
    duplicate = client.post(f"/api/models/{model_id}/test-jobs", json={"parameters": {"horizon": 1}, "idempotency_key": key})
    assert duplicate.status_code == 409
    job_runner.run(first["id"])
    assert job_service.get_task(first["id"]).status == "FAILED"
    assert "MODEL_TEST_OUTDATED" in job_service.get_task(first["id"]).error
    assert not model_service.get_model(model_id).tested_content_hash


def test_legacy_sync_test_cannot_overwrite_an_edit_during_solve(client, monkeypatch):
    _, model_id = _curve_model(client)
    original = model_service._dry_run_model

    def solve_then_edit(model, **kwargs):
        result = original(model, **kwargs)
        current = model_service.get_model(model_id)
        model_service.update_model(model_id, current.model_copy(update={"name": "求解期间已更新"}))
        return result

    monkeypatch.setattr(model_service, "_dry_run_model", solve_then_edit)
    tested = client.post(f"/api/models/{model_id}/test", json={"parameters": {"horizon": 1}})
    assert tested.status_code == 409, tested.text
    assert tested.json()["detail"]["code"] == "MODEL_TEST_OUTDATED"
    assert model_service.get_model(model_id).name == "求解期间已更新"
    assert not model_service.get_model(model_id).tested_content_hash
