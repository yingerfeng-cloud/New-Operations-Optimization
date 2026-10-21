"""Real ASGI APIs + HiGHS, synthetic dispatch with independent lower bounds."""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.services.job_service import job_service
from app.storage.memory_store import STORE


def component(client, factor=1, source=None, depends_on=None):
    identifier = "iter_c_" + uuid4().hex[:10]
    if source:
        response = client.post(f"/api/components/{source}/copy-version", json={"component_id": identifier, "version": str(factor)})
        assert response.status_code == 200, response.text
    payload = {"component_id": identifier, "name": "合成供给下限", "version": "1.0.0", "sets": [{"code": "time"}],
        "parameters": [{"code": "demand", "dimension": ["time"], "default": [10, 10]}],
        "variables": [{"code": "output", "dimension": ["time"], "type": "continuous", "lower_bound": 0}],
        "constraints": [{"constraint_id": "supply_floor", "indices": [{"set": "time", "alias": "t"}], "expression": f"output[t] >= {factor} * demand[t]"}],
        "depends_on": depends_on or []}
    response = client.put(f"/api/components/{identifier}", json={"constraints": payload["constraints"]}) if source else client.post("/api/components/catalog", json=payload)
    assert response.status_code == 200, response.text
    response = client.post(f"/api/components/{identifier}/publish")
    assert response.status_code == 200, response.text
    return identifier


def model(client, identifier, extra=None):
    code = "iter_dispatch_" + uuid4().hex[:8]
    variables = [{"code": "output", "name": "output", "indices": ["time"], "dimension": ["time"], "lower_bound": 0, "upper_bound": 100, "unit": "MW"}]
    spec = {"model_code": code, "build_mode": "component_based", "sets": [{"code": "time", "values": [0, 1]}],
        "parameters": [{"code": "demand", "dimension": ["time"], "default": [10, 10]}], "variables": variables,
        "components": [{"type": item} for item in [identifier, *(extra or [])]],
        "objective": {"sense": "minimize", "terms": [{"term_id": "cost", "expression": "sum(3 * output[t] for t in time)",
            "weight": 1, "weight_key": "cost", "supported_by_backend": True, "solve_participation": "solve_active"}]}}
    payload = {"name": code, "scene": "合成供给", "build_mode": "component_based", "problem_type": "LP", "model_problem_type": "LP",
        "component_spec": spec, "semantic_spec": {**deepcopy(spec), "parameters": [{"code": "demand", "dimension": ["time"], "value_type": "number", "sample_value": [10, 10]}]},
        "parameters": {"horizon": 2, "demand": [10, 10]}, "output_contract": {"variables": [{"code": "output", "name": "供给功率", "unit": "MW"}]}}
    response = client.post("/api/models", json=payload)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_publish(client, identifier):
    response = client.post(f"/api/models/{identifier}/test-jobs", json={"parameters": {"horizon": 2, "demand": [10, 10]}, "idempotency_key": uuid4().hex})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SUCCESS", response.text
    response = client.post(f"/api/models/{identifier}/publish")
    assert response.status_code == 200, response.text
    return response.json()


test_publish.__test__ = False


def invoke(client, identifier, factor=1):
    response = client.post(f"/api/models/{identifier}/invoke", json={"parameters": {"horizon": 2, "demand": [10, 10]}, "options": {"mode": "sync", "explain": False}})
    assert response.status_code == 200, response.text
    result = response.json()
    # A positive linear cost with independent lower bounds gives x=10*factor
    # in both periods. Primal feasibility plus cost lower bound proves optimality.
    assert result["objective_value"] == pytest.approx(60 * factor)
    assert list(result["variable_values"]["output"].values()) == pytest.approx([10 * factor, 10 * factor])
    return result


def candidate(client, identifier, selections):
    response = client.post(f"/api/models/{identifier}/component-updates/test", json={"selections": selections, "idempotency_key": uuid4().hex})
    assert response.status_code == 200, response.text
    assert response.json()["task"]["status"] == "SUCCESS", response.text
    return response.json()["model"]["id"]


def test_selective_component_update_offline_and_formal_governance(client):
    c1 = component(client)
    a, b = model(client, c1), model(client, c1)
    test_publish(client, a); test_publish(client, b)
    original = invoke(client, b)
    c2 = component(client, 1.2, c1)
    selected = candidate(client, a, {c1: c2})
    c3 = component(client, 1.5, c1)
    assert client.post(f"/api/components/{c1}/offline").status_code == 200
    invoke(client, b)
    assert client.post(f"/api/models/{selected}/component-updates/apply").status_code == 200
    invoke(client, selected, 1.2)
    invoke(client, b)
    assert client.post(f"/api/models/{a}/invoke", json={"parameters": {}}).status_code == 409
    replay = client.post(f"/api/tasks/{original['task_id']}/replay")
    assert replay.status_code == 200, replay.text
    assert replay.json()["objective_value"] == pytest.approx(60)
    pinned = client.get(f"/api/models/{selected}").json()["component_dependencies"]
    assert c2 in pinned["assets"] and c3 not in pinned["assets"]
    # Explicit rebinding after a successful test must invalidate evidence.
    next_candidate = candidate(client, b, {c1: c2})
    change = client.put(f"/api/models/{next_candidate}/component-dependencies", json={"selections": {c2: c3}})
    assert change.status_code == 200, change.text
    blocked = client.post(f"/api/models/{next_candidate}/component-updates/apply")
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"]["code"] == "MODEL_NOT_TESTED"
    test_publish(client, next_candidate)
    invoke(client, next_candidate, 1.5)


def test_queued_cancel_retry_uses_original_server_bindings(client, monkeypatch):
    c1 = component(client)
    a = model(client, c1); test_publish(client, a)
    monkeypatch.setenv("OPTIFORGE_SYNC_JOBS", "false")
    for _ in range(4): STORE.scheduler.acquire()
    try:
        response = client.post("/api/tasks", json={"model_id": a, "parameters": {"demand": [10, 10], "horizon": 2}})
        assert response.status_code == 200, response.text
        task_id = response.json()["id"]
        assert client.post(f"/api/tasks/{task_id}/cancel").status_code == 200
        component(client, 2, c1)
        assert client.post(f"/api/components/{c1}/offline").status_code == 200
    finally:
        for _ in range(4): STORE.scheduler.release()
    monkeypatch.setenv("OPTIFORGE_SYNC_JOBS", "true")
    retried = client.post(f"/api/tasks/{task_id}/retry")
    assert retried.status_code == 200, retried.text
    assert retried.json()["status"] == "SUCCESS", retried.text
    assert retried.json()["objective_value"] == pytest.approx(60)
    assert retried.json()["attempt_history"][0]["status"] == "CANCELLED"


def test_client_snapshot_forgery_corruption_and_missing_history_are_rejected(client):
    c = component(client)
    a = model(client, c); test_publish(client, a)
    view = client.get(f"/api/models/{a}").json()
    forged = deepcopy(view); forged.pop("id"); forged["name"] = "forged"
    assert client.post("/api/models", json=forged).json()["detail"]["code"] == "COMPONENT_MANIFEST_SERVER_OWNED"
    result = invoke(client, a)
    task = job_service.get_task(result["task_id"])
    task.request.payload["_component_dependencies"]["assets"][c]["definition"]["constraints"][0]["expression"] = "output[t] >= 0"
    assert client.post(f"/api/tasks/{task.id}/replay").json()["detail"]["code"] == "COMPONENT_SNAPSHOT_CORRUPT"
    task.request.payload.pop("_component_dependencies")
    assert client.post(f"/api/tasks/{task.id}/replay").json()["detail"]["code"] == "TASK_HISTORY_UNREPLAYABLE"


def test_revocation_is_explicit_impact_checked_and_blocks_old_bindings(client):
    c = component(client)
    a = model(client, c); test_publish(client, a)
    task = invoke(client, a)
    assert client.post(f"/api/components/{c}/revoke", json={"reason": "安全问题，需要撤销"}).status_code == 409
    affected = client.get(f"/api/components/{c}/revocation-impact").json()
    assert a in affected["model_ids"] and task["task_id"] in affected["task_ids"]
    response = client.post(f"/api/components/{c}/revoke", json={"reason": "安全问题，需要撤销", "expected_impact_hash": affected["impact_hash"]})
    assert response.status_code == 200, response.text
    blocked = client.post("/api/tasks", json={"model_id": a, "parameters": {"demand": [10, 10]}})
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "COMPONENT_REVOKED"
    invocation = client.post(f"/api/models/{a}/invoke", json={"parameters": {"demand": [10, 10]}}).json()
    assert invocation["status"] == "FAILED"
    assert invocation.get("objective_value") is None
    assert "COMPONENT_REVOKED" in str(invocation)
    assert client.post(f"/api/tasks/{task['task_id']}/replay").json()["detail"]["code"] == "COMPONENT_REVOKED"


def test_component_update_keeps_unselected_function_revision(client):
    c1 = component(client)
    fid = 'iter_f_' + uuid4().hex[:8]
    assert client.post('/api/function-assets', json={"function_id": fid, "name": fid, "points": [[0, 0], [100, 100]], "solve_strategy": "segment_binary", "status": "published"}).status_code == 200
    a = model(client, c1)
    package = client.get(f'/api/models/{a}').json()
    spec = package['component_spec']
    spec['variables'].append({"name": "cost", "indices": ["time"], "lower_bound": 0})
    spec['components'].append({"type": "function_mapping_component", "function_asset_id": fid,
        "x": "output[t]", "y": "cost[t]", "indices": [{"set": "time", "alias": "t"}], "solve_strategy": "segment_binary"})
    for field in ('expression', 'formula', 'dsl_formula'):
        spec['objective']['terms'][0][field] = 'sum(cost[t] for t in time)'
    package['semantic_spec']['component_spec'] = deepcopy(spec)
    package['semantic_spec']['variables'].append({"code": "cost", "dimension": ["time"]})
    package['model_draft'] = {}
    assert client.put(f'/api/models/{a}', json=package).status_code == 200
    baseline = test_publish(client, a)
    assert baseline['dry_run_result']['solver_check']['objective_value'] == pytest.approx(20)
    assert client.put(f'/api/function-assets/{fid}', json={"points": [[0, 0], [100, 400]]}).status_code == 200
    c2 = component(client, 1.2, c1)
    updated = candidate(client, a, {c1: c2})
    asset = client.get(f'/api/models/{updated}').json()
    assert asset['function_dependencies'][fid]['revision'] == 1
    assert asset['dry_run_result']['solver_check']['objective_value'] == pytest.approx(24)


def test_upstream_dependency_missing_and_offline_rules(client):
    upstream = component(client, .5)
    parent = component(client, 1, depends_on=[upstream])
    incomplete = model(client, parent)
    missing = client.post(f'/api/models/{incomplete}/test-jobs', json={})
    assert missing.status_code == 409 and missing.json()['detail']['code'] == 'COMPONENT_DEPENDENCY_MISSING'
    complete = model(client, parent, [upstream]); test_publish(client, complete)
    assert client.post(f'/api/components/{upstream}/offline').status_code == 200
    invoke(client, complete)
    fresh = model(client, parent, [upstream])
    unavailable = client.post(f'/api/models/{fresh}/test-jobs', json={})
    assert unavailable.status_code == 409 and unavailable.json()['detail']['code'] == 'COMPONENT_NOT_SELECTABLE'
