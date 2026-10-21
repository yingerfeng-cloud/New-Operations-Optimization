"""Continuous component recovery journeys through real APIs and HiGHS.

Synthetic independent answer: two periods with x >= 10 (or 12), and
minimize 3*x in each period, give 60 (or 72) with zero constraint residual.
"""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.storage.memory_store import STORE
from tests.test_iteration_component_bindings import component, model, test_publish, candidate, invoke


def revoke(client, identifier):
    impact = client.get(f"/api/components/{identifier}/revocation-impact").json()
    reason = "合成安全撤销：使用安全替代修订恢复"
    response = client.post(f"/api/components/{identifier}/revoke", json={
        "reason": reason, "expected_impact_hash": impact["impact_hash"],
    })
    assert response.status_code == 200, response.text
    return reason, impact


def assert_solved(client, task, expected=72):
    assert task["status"] == "SUCCESS", task
    result = client.get(f"/api/tasks/{task['id']}/result").json()
    assert result["objective_value"] == pytest.approx(expected)
    assert list(result["variable_values"]["output"].values()) == pytest.approx([expected / 6] * 2)
    assert result["solution_evidence"]["max_constraint_violation"] == 0


@pytest.mark.parametrize("legacy_draft", [False, True])
def test_rv01_component_apply_then_ordinary_version_survives_repeated_stale_saves(client, legacy_draft):
    c1 = component(client)
    a = model(client, c1)
    test_publish(client, a)
    c2 = component(client, 1.2, c1)
    v2 = candidate(client, a, {c1: c2})
    applied = client.post(f"/api/models/{v2}/component-updates/apply")
    assert applied.status_code == 200, applied.text
    audit = applied.json()["ui_metadata"]["component_update"]
    assert audit["source_model_id"] == a
    response = client.post(f"/api/models/{v2}/versions", json={"name": "合成普通后续版本"})
    assert response.status_code == 200, response.text
    v3 = response.json()["id"]
    if legacy_draft:
        # Simulate the persisted ordinary draft produced before this fix. Only
        # the direct published parent's matching audit authorizes lazy cleanup.
        from app.services.model_service import model_service
        STORE.models[v3].ui_metadata["component_update"] = deepcopy(audit)
        STORE.models[v3].model_draft["advanced"].setdefault("ui_metadata", {})["component_update"] = deepcopy(audit)
        STORE.models[v3].content_hash = model_service._content_hash(STORE.models[v3])
    for iteration in range(2):
        asset = client.get(f"/api/models/{v3}").json()
        asset["name"] = f"合成普通版本名称 {iteration}"
        # An old editor/recovery copy must not reinstate another operation's
        # control context through either metadata representation.
        for metadata in (asset["ui_metadata"], asset["model_draft"]["advanced"].setdefault("ui_metadata", {})):
            metadata.update(component_update=deepcopy(audit), function_update=deepcopy(audit))
        saved = client.put(f"/api/models/{v3}", json=asset)
        assert saved.status_code == 200, saved.text
    task = client.post(f"/api/models/{v3}/test-jobs", json={"parameters": {"horizon": 2, "demand": [10, 10]}, "idempotency_key": uuid4().hex})
    assert task.status_code == 200, task.text
    assert_solved(client, task.json())
    published = client.post(f"/api/models/{v3}/publish")
    assert published.status_code == 200, published.text
    view = published.json()
    assert view["version"] == "v0.3" and view["supersedes_model_id"] == v2
    for metadata in (view["ui_metadata"], view["model_draft"]["advanced"]["ui_metadata"]):
        assert "component_update" not in metadata and "function_update" not in metadata
    assert client.get(f"/api/models/{v2}").json()["ui_metadata"]["component_update"] == audit
    invoke(client, v3, 1.2)


@pytest.mark.parametrize("saved_evidence", [True, False])
def test_rv02_revoked_model_can_select_safe_revision_test_and_publish(client, saved_evidence):
    c1 = component(client)
    a = model(client, c1)
    test_publish(client, a)
    original = invoke(client, a)
    if not saved_evidence:
        # Explicit legacy fixture: no old model-test business evidence exists.
        STORE.models[a].dry_run_result["solver_check"].pop("evidence", None)
    c2 = component(client, 1.2, c1)
    reason, impact = revoke(client, c1)
    blocked = client.post("/api/tasks", json={"model_id": a, "parameters": {"horizon": 2, "demand": [10, 10]}})
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "COMPONENT_REVOKED"
    replay = client.post(f"/api/tasks/{original['task_id']}/replay", json={"mode": "current_kernel"})
    assert replay.status_code == 409 and replay.json()["detail"]["code"] == "COMPONENT_REVOKED"
    before_tasks = set(STORE.tasks)
    listed = client.get(f"/api/models/{a}/component-updates")
    assert listed.status_code == 200, listed.text
    row = next(row for row in listed.json()["dependencies"] if row["component_id"] == c1)
    assert c2 in {version["component_id"] for version in row["versions"]}
    assert row["revocation"]["reason"] == reason
    fixed = candidate(client, a, {c1: c2})
    comparison = client.get(f"/api/models/{fixed}/update-comparison").json()
    if saved_evidence:
        assert comparison["comparable"] is True
        assert {key: comparison["objective"][key] for key in ("before", "after", "delta")} == {"before": 60, "after": 72, "delta": 12}
    else:
        assert comparison["comparable"] is False
        assert "无可比旧结果" in comparison["message"]
    assert len(set(STORE.tasks) - before_tasks) == 1  # Never execute C1 to make a baseline.
    assert client.post(f"/api/models/{fixed}/component-updates/apply").status_code == 200
    invoke(client, fixed, 1.2)
    assets = client.get(f"/api/models/{fixed}").json()["component_dependencies"]["assets"]
    assert c2 in assets and c1 not in assets
    record = STORE.system_config["component_revocations"][c1]
    assert record["reason"] == reason
    assert a in impact["model_ids"] and original["task_id"] in impact["task_ids"]


def test_rv01_real_formal_switch_still_rejects_stale_candidate_after_editor_save(client):
    c1 = component(client)
    a = model(client, c1)
    test_publish(client, a)
    c2 = component(client, 1.2, c1)
    stale = candidate(client, a, {c1: c2})
    view = client.get(f"/api/models/{stale}").json()
    returned = client.post(f"/api/models/{stale}/return-to-draft", json={"expected_content_hash": view["content_hash"]})
    assert returned.status_code == 200, returned.text
    view = returned.json()
    # An editor cannot erase/retarget the legitimate candidate conflict guard.
    view["ui_metadata"].pop("component_update")
    view["model_draft"]["advanced"].setdefault("ui_metadata", {})["component_update"] = {"source_model_id": stale}
    saved = client.put(f"/api/models/{stale}", json=view)
    assert saved.status_code == 200, saved.text
    assert saved.json()["ui_metadata"]["component_update"]["source_model_id"] == a
    tested = client.post(f"/api/models/{stale}/test-jobs", json={"idempotency_key": uuid4().hex})
    assert tested.status_code == 200, tested.text
    assert_solved(client, tested.json())
    switched = client.post(f"/api/models/{a}/versions", json={"name": "合成抢先正式发布版本"})
    assert switched.status_code == 200, switched.text
    test_publish(client, switched.json()["id"])
    for endpoint in ("publish", "component-updates/apply"):
        rejected = client.post(f"/api/models/{stale}/{endpoint}")
        assert rejected.status_code == 409, rejected.text
        assert rejected.json()["detail"]["code"] == "FORMAL_VERSION_CHANGED"


def test_rv02_retained_indirect_revocation_and_incomplete_replacement_cannot_run(client):
    upstream = component(client, .5)
    parent = component(client, 1, depends_on=[upstream])
    a = model(client, parent, [upstream])
    test_publish(client, a)
    safe_parent = component(client, 1.2, parent)
    safe_upstream = component(client, .6, upstream)
    revoke(client, upstream)
    tasks, models = set(STORE.tasks), set(STORE.models)
    for selections, code in (({parent: safe_parent}, "COMPONENT_REVOKED"),
                             ({upstream: safe_upstream}, "COMPONENT_DEPENDENCY_MISSING")):
        rejected = client.post(f"/api/models/{a}/component-updates/test", json={"selections": selections, "idempotency_key": uuid4().hex})
        assert rejected.status_code == 409, rejected.text
        assert rejected.json()["detail"]["code"] == code
    assert set(STORE.tasks) == tasks and set(STORE.models) == models


def test_rv02_repair_inspection_does_not_accept_corrupt_or_client_owned_history(client):
    c1 = component(client)
    a = model(client, c1)
    test_publish(client, a)
    c2 = component(client, 1.2, c1)
    revoke(client, c1)
    forged = client.get(f"/api/models/{a}").json()
    forged.pop("id")
    rejected = client.post("/api/models", json=forged)
    assert rejected.status_code == 422 or rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"]["code"] == "COMPONENT_MANIFEST_SERVER_OWNED"
    # Simulated stored corruption, not an alternate implementation of validation.
    STORE.models[a].component_dependencies["assets"][c1]["definition"]["name"] = "损坏的历史定义"
    listed = client.get(f"/api/models/{a}/component-updates")
    assert listed.status_code == 409 and listed.json()["detail"]["code"] == "COMPONENT_SNAPSHOT_CORRUPT"
    selected = client.post(f"/api/models/{a}/component-updates/test", json={"selections": {c1: c2}, "idempotency_key": uuid4().hex})
    assert selected.status_code == 409 and selected.json()["detail"]["code"] == "COMPONENT_SNAPSHOT_CORRUPT"
