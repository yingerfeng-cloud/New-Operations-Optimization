"""Synthetic known answers for I-01/I-03/I-04; never customer acceptance."""
from copy import deepcopy
from uuid import uuid4

import pytest
import pyomo.environ as pyo

from app.agent.schema_parameter_analyzer import schema_parameter_analyzer
from app.builders.component_model_builder import ComponentModelBuilder
from app.services.invocation_service import invocation_service
from app.services.job_service import job_service
from app.services.model_service import model_service
from app.solvers.highs_adapter import HiGHSAdapter
from app.storage.memory_store import STORE
from tests.test_helpers import test_and_publish_model
from tests.test_review_execution_contracts import _curve_model


def _invoke(client, model_id):
    response = client.post(f"/api/models/{model_id}/invoke", json={"parameters": {"horizon": 1}, "options": {"mode": "sync", "explain": False}})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "SUCCESS", body
    return body


def _update(client, function_id, factor):
    response = client.put(f"/api/function-assets/{function_id}", json={"points": [[0, 0], [20, 20 * factor]]})
    assert response.status_code == 200, response.text
    return response.json()


def _candidate(client, model_id, revisions, key=None):
    response = client.post(f"/api/models/{model_id}/function-updates/test", json={"revisions": revisions, "idempotency_key": key or uuid4().hex})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["task"]["status"] == "SUCCESS", body
    return body


def test_schema_agent_runtime_agree_on_declared_formats():
    semantic = {"sets": [{"code": "unrelated", "values": ["A", "B"]}, {"code": "site", "values": ["B", "A"]}],
                "parameters": [{"code": "cost", "dimension": ["site"], "sample_value": [10, 20]},
                               {"code": "capacity", "dimension": ["site"], "validation": {"type": "dict"}}]}
    schema = invocation_service.input_schema(semantic)
    assert schema[0]["allowed_formats"] == ["dict", "array"]
    assert schema[0]["axes"] == [{"set": "site", "members": ["B", "A"]}]
    assert schema[0]["format_examples"] == {"array": [10, 20], "dict": {"B": 10, "A": 20}}
    for costs in ([10, 20], {"B": 10, "A": 20}):
        result = schema_parameter_analyzer.analyze(schema, {"cost": costs, "capacity": {"B": 1, "A": 2}})
        assert not result["invalid_parameters"], result
    result = schema_parameter_analyzer.analyze(schema, {"cost": [10, 20], "capacity": [1, 2]})
    assert result["invalid_parameters"][0]["key"] == "capacity"


@pytest.mark.parametrize("labels", [["B", "A"], [20, 10], ["20", "10"]])
def test_nested_axes_validated_by_schema_and_runtime(labels):
    from app.semantic.semantic_validator import RuntimeParameterValidator
    semantic = {"sets": [{"code": "site", "values": labels}, {"code": "tariff", "values": ["N", "D"]}],
                "parameters": [{"code": "cost", "dimension": ["site", "tariff"], "validation": {"type": "array"}}]}
    schema = invocation_service.input_schema(semantic)
    assert schema[0]["axis_order"] == ["site", "tariff"]
    values = {"cost": [[1, 10], [20, 30]]}
    assert not schema_parameter_analyzer.analyze(schema, values)["invalid_parameters"]
    assert not RuntimeParameterValidator().validate(semantic, values)
    invalid = {"cost": [[1], [20, 30]]}
    assert schema_parameter_analyzer.analyze(schema, invalid)["invalid_parameters"]
    assert RuntimeParameterValidator().validate(semantic, invalid)


def test_selective_update_inherits_g_and_other_model_keeps_f(client):
    f, a = _curve_model(client)
    g = "review_g_" + uuid4().hex[:8]
    created = client.post("/api/function-assets", json={"function_id": g, "name": "G", "points": [[0, 0], [20, 60]], "solve_strategy": "segment_binary", "status": "published"})
    assert created.status_code == 200
    # A uses F(x) + G(x), x=10. Independent known answer 10+30=40.
    model = client.get(f"/api/models/{a}").json()
    spec = model["component_spec"]
    spec["variables"].append({"name": "g_level", "indices": ["time"], "lower_bound": 0})
    spec["components"].append({**deepcopy(spec["components"][0]), "function_asset_id": g, "y": "g_level[t]", "constraint_id": "g_mapping"})
    spec["components"][0]["constraint_id"] = "f_mapping"
    spec["objective"]["terms"] = [{"term_id": "combined_cost", "expression": "sum(level[t] + g_level[t] for t in time)",
        "weight_key": "piecewise_cost", "weight": 1, "supported_by_backend": True, "solve_participation": "solve_active"}]
    model["semantic_spec"]["variables"].append({"code": "g_level", "dimension": ["time"]})
    model["semantic_spec"]["component_spec"] = deepcopy(spec)
    model["model_draft"] = {}
    response = client.put(f"/api/models/{a}", json=model)
    assert response.status_code == 200, response.text
    test_and_publish_model(client, a, {"horizon": 1})
    assert _invoke(client, a)["objective_value"] == pytest.approx(40)
    b = client.post(f"/api/models/{a}/copy").json()["id"]
    test_and_publish_model(client, b, {"horizon": 1})
    original_g = client.get(f"/api/models/{a}").json()["function_dependencies"][g]
    _update(client, f, 2)
    _update(client, g, 4)
    key = uuid4().hex
    candidate = _candidate(client, a, {f: 2}, key)
    candidate_id = candidate["model"]["id"]
    assert _candidate(client, a, {f: 2}, key)["model"]["id"] == candidate_id
    tested = client.get(f"/api/models/{candidate_id}").json()
    assert tested["function_dependencies"][g] == original_g
    assert tested["dry_run_result"]["solver_check"]["objective_value"] == pytest.approx(50)
    # An unselected later library revision cannot invalidate the tested pair F2/G1.
    _update(client, f, 3)
    assert _invoke(client, a)["objective_value"] == pytest.approx(40)
    applied = client.post(f"/api/models/{candidate_id}/function-updates/apply")
    assert applied.status_code == 200, applied.text
    assert _invoke(client, candidate_id)["objective_value"] == pytest.approx(50)
    assert _invoke(client, b)["objective_value"] == pytest.approx(40)
    formal = client.post("/api/tasks", json={"model_code": model["semantic_spec"]["model_code"], "parameters": {"horizon": 1}, "async_run": False})
    assert formal.status_code == 200, formal.text
    assert formal.json()["resolved_model_id"] == candidate_id
    assert formal.json()["objective_value"] == pytest.approx(50)
    refs = client.get(f"/api/function-assets/{f}").json()["referenced_by"]
    assert any(row.get("model_id") == a and row["function_revision"] == 1 for row in refs)
    assert any(row.get("model_id") == candidate_id and row["function_revision"] == 2 for row in refs)
    deleted = client.delete(f"/api/function-assets/{f}/versions/1")
    assert deleted.status_code == 409
    assert deleted.json()["detail"]["code"] == "FUNCTION_REVISION_REFERENCED"


def test_explicit_change_after_test_requires_retest(client):
    f, a = _curve_model(client)
    test_and_publish_model(client, a, {"horizon": 1})
    _update(client, f, 2)
    c = _candidate(client, a, {f: 2})["model"]["id"]
    _update(client, f, 3)
    changed = client.put(f"/api/models/{c}/function-dependencies", json={"revisions": {f: 3}})
    assert changed.status_code == 200, changed.text
    blocked = client.post(f"/api/models/{c}/function-updates/apply")
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "MODEL_NOT_TESTED"
    assert client.post(f"/api/models/{c}/test-jobs", json={"parameters": {"horizon": 1}}).json()["status"] == "SUCCESS"
    assert client.post(f"/api/models/{c}/function-updates/apply").status_code == 200
    assert _invoke(client, c)["objective_value"] == pytest.approx(30)


def test_fixed_id_skill_and_formal_entry_are_separate(client):
    f, a = _curve_model(client)
    test_and_publish_model(client, a, {"horizon": 1})
    fixed_original = client.post(f"/api/models/{a}/skills/generate", json={"use_llm": False}).json()
    b = client.post(f"/api/models/{a}/copy").json()["id"]
    test_and_publish_model(client, b, {"horizon": 1})
    skill = client.post(f"/api/models/{b}/skills/generate", json={"use_llm": False})
    assert skill.status_code == 200, skill.text
    _update(client, f, 2)
    candidate = _candidate(client, a, {f: 2})["model"]["id"]
    assert client.post(f"/api/models/{candidate}/function-updates/apply").status_code == 200
    assert _invoke(client, candidate)["objective_value"] == pytest.approx(20)
    assert _invoke(client, b)["objective_value"] == pytest.approx(10)
    fixed_skill = client.post(f"/api/skills/{skill.json()['skill_name']}/run", json={"parameters": {"horizon": 1}, "options": {"mode": "sync", "explain": False}})
    assert fixed_skill.status_code == 200, fixed_skill.text
    assert fixed_skill.json()["objective_value"] == pytest.approx(10)
    assert fixed_skill.json()["resolved_model_id"] == b
    fixed_name = fixed_original['skill_name']
    listed = next(row for row in client.get('/api/skills').json() if row['skill_name'] == fixed_name)
    detail = client.get(f'/api/skills/{fixed_name}').json()
    assert listed['model_id'] == detail['model_id'] == a
    assert listed['callable'] is detail['callable'] is False
    # Existing lifecycle governance still applies: the superseded A is offline.
    old = client.post(f"/api/models/{a}/invoke", json={"parameters": {"horizon": 1}})
    assert old.status_code == 409


def test_library_advances_while_candidate_is_queued(client, monkeypatch):
    from app.jobs.job_runner import job_runner
    f, a = _curve_model(client)
    test_and_publish_model(client, a, {"horizon": 1})
    _update(client, f, 2)
    monkeypatch.setenv("OPTIFORGE_SYNC_JOBS", "false")
    monkeypatch.setattr(job_runner, "start", lambda _: None)
    response = client.post(f"/api/models/{a}/function-updates/test", json={"revisions": {f: 2}, "idempotency_key": uuid4().hex})
    assert response.status_code == 200, response.text
    task_id, candidate_id = response.json()["task"]["id"], response.json()["model"]["id"]
    _update(client, f, 3)
    job_runner.run(task_id)
    assert job_service.get_task(task_id).objective_value == pytest.approx(20)
    published = client.post(f"/api/models/{candidate_id}/function-updates/apply")
    assert published.status_code == 200, published.text
    assert published.json()["function_dependencies"][f]["revision"] == 2


def test_failed_candidate_leaves_formal_version_untouched(client):
    f, a = _curve_model(client)
    test_and_publish_model(client, a, {"horizon": 1})
    changed = client.put(f"/api/function-assets/{f}", json={"points": [[0, 0], [5, 10]], "domain": {}})
    assert changed.status_code == 200, changed.text
    response = client.post(f"/api/models/{a}/function-updates/test", json={"revisions": {f: 2}, "idempotency_key": uuid4().hex})
    assert response.status_code == 200, response.text
    candidate_id = response.json()["model"]["id"]
    assert response.json()["task"]["status"] in {"FAILED", "INFEASIBLE"}
    assert client.post(f"/api/models/{candidate_id}/function-updates/apply").status_code == 422
    assert model_service.get_model(a).is_active_version
    assert _invoke(client, a)["objective_value"] == pytest.approx(10)


def test_queued_retry_replay_and_explicit_recalculate_have_distinct_inputs(client, monkeypatch):
    from app.jobs.job_runner import job_runner
    from app.schemas.solve import SolveRequest
    f, a = _curve_model(client)
    test_and_publish_model(client, a, {"horizon": 1})
    monkeypatch.setenv("OPTIFORGE_SYNC_JOBS", "false")
    monkeypatch.setattr(job_runner, "start", lambda _: None)
    original = job_service.create_task(SolveRequest(model_id=a, parameters={"horizon": 1}))
    _update(client, f, 2)
    # Submission was pinned before the library edit; failed retry retains the same snapshot.
    with STORE.lock:
        original.status = "FAILED"
    monkeypatch.setenv("OPTIFORGE_SYNC_JOBS", "true")
    retry = client.post(f"/api/tasks/{original.id}/retry")
    assert retry.status_code == 200, retry.text
    assert retry.json()["objective_value"] == pytest.approx(10)
    replay = client.post(f"/api/tasks/{original.id}/replay")
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] != original.id
    assert replay.json()["objective_value"] == pytest.approx(10)
    recalc = client.post(f"/api/tasks/{original.id}/recalculate", json={"revisions": {f: 2}, "idempotency_key": uuid4().hex})
    assert recalc.status_code == 200, recalc.text
    assert recalc.json()["id"] not in {original.id, replay.json()["id"]}
    assert recalc.json()["objective_value"] == pytest.approx(20)
    assert _invoke(client, a)["objective_value"] == pytest.approx(10)


def test_missing_historical_snapshots_are_not_filled_with_latest(client):
    f, a = _curve_model(client)
    test_and_publish_model(client, a, {"horizon": 1})
    result = _invoke(client, a)
    task_id = result["task_id"]
    task = job_service.get_task(task_id)
    task.request.payload.pop("_function_asset_snapshots")
    response = client.post(f"/api/tasks/{task_id}/replay")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "TASK_HISTORY_UNREPLAYABLE"


@pytest.mark.parametrize("change", [{"input_schema": [{"code": "volume", "unit": "MW"}]}, {"out_of_domain_policy": "clamp"}, {"solve_strategy": "display_only"}])
def test_contract_changes_require_full_model_edit(client, change):
    f, a = _curve_model(client)
    test_and_publish_model(client, a, {"horizon": 1})
    changed = client.put(f"/api/function-assets/{f}", json=change)
    assert changed.status_code == 200, changed.text
    response = client.post(f"/api/models/{a}/function-updates/test", json={"revisions": {f: 2}, "idempotency_key": uuid4().hex})
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "FUNCTION_CONTRACT_CHANGED"
    assert _invoke(client, a)["objective_value"] == pytest.approx(10)


@pytest.mark.parametrize("strategy", ["segment_binary", "sos2", "convex_combination_lp", "binary_segment_milp"])
@pytest.mark.parametrize("power,expected", [(10, 100), (5, 50)])
def test_mapping_strategy_metadata_matches_exact_known_answer(client, strategy, power, expected):
    f, a = _curve_model(client)
    client.put(f"/api/function-assets/{f}", json={"points": [[0, 0], [10, 100], [20, 110]]})
    model = model_service.get_model(a)
    spec = deepcopy(model.component_spec)
    spec["variables"][0].update(lower_bound=power, upper_bound=power)
    spec["components"][0]["solve_strategy"] = strategy
    compiled, context = ComponentModelBuilder().build(spec, {"horizon": 1})
    solved = HiGHSAdapter().solve(compiled)
    assert solved.objective_value == pytest.approx(expected)
    assert pyo.value(compiled.level[0]) == pytest.approx(expected)
    record = context["metadata"]["function_assets_used"][0]
    assert record["solve_strategy"] == ("sos2" if strategy == "sos2" else "segment_binary")
    assert record["exact"] is True
    assert record["problem_type"] == "MILP"
    assert record["compiler"] == "piecewise_1d_segment_binary"
