"""Cloud review regressions. All business inputs are synthetic known answers."""
from copy import deepcopy

import pytest

from app.builders.pyomo_builder import PyomoModelBuilder
from app.parameter_input_contract import parameter_input_contract, validate_parameter_input
from app.services.model_service import model_service
from app.services.model_version_service import model_version_service
from app.solvers.highs_adapter import HiGHSAdapter


def dispatch_parameters(delta_t=1):
    return {"unit": ["U1", "U2", "U3"], "horizon": 4,
            "load_forecast": [50, 80, 100, 40], "delta_t": delta_t,
            "unit_min_output": {"U1": 0, "U2": 0, "U3": 0},
            "unit_max_output": {"U1": 60, "U2": 60, "U3": 60},
            "fuel_cost": {"U1": 10, "U2": 20, "U3": 30}}


@pytest.mark.parametrize("delta,answer", [(1, 3300), (.5, 1650)])
def test_ed_energy_cost_uses_duration(delta, answer):
    model, _ = PyomoModelBuilder().build({"model_code": "economic_dispatch"}, dispatch_parameters(delta))
    result = HiGHSAdapter().solve(model)
    assert result.status == "optimal"
    assert result.objective_value == pytest.approx(answer, abs=1e-6)
    assert sum(result.variable_values["unit_output"].values()) == pytest.approx(270)


@pytest.mark.parametrize("delta,answer,selected", [(.25, 300, "U2"), (.5, 500, "U2"), (1, 700, "U1")])
def test_uc_duration_changes_decision_without_scaling_startup(delta, answer, selected):
    params = {"unit": ["U1", "U2"], "horizon": 1, "load_forecast": [20],
              "renewable_forecast": [0], "delta_t": delta,
              "unit_min_output": {"U1": 0, "U2": 0}, "unit_max_output": {"U1": 20, "U2": 20},
              "fuel_cost": {"U1": 10, "U2": 40}, "startup_cost": {"U1": 500, "U2": 100},
              "initial_unit_status": {"U1": 0, "U2": 0}, "reserve_ratio": 0}
    model, _ = PyomoModelBuilder().build({"model_code": "unit_commitment_day_ahead"}, params)
    result = HiGHSAdapter().solve(model)
    # Independent enumeration of the two feasible single-unit choices.
    assert min(500 + 20 * 10 * delta, 100 + 20 * 40 * delta) == answer
    assert result.objective_value == pytest.approx(answer, abs=1e-6)
    assert result.variable_values["unit_output"][f"unit_output[{selected},0]"] == pytest.approx(20)


def test_explicit_generic_mode_overrides_inherited_template_identity():
    spec = {"sets": {"unit": ["U1", "U2", "U3"], "time": [0, 1, 2, 3]},
            "variables": [{"name": "unit_output", "indices": ["unit", "time"], "lb": 1}],
            "constraints": [], "objective": {"sense": "minimize", "terms": [
                {"var": "unit_output", "foreach": ["unit", "time"], "key": ["unit", "time"], "coef": 1}]}}
    params = {**dispatch_parameters(), "generic_spec": spec}
    model, _ = PyomoModelBuilder().build({"model_code": "economic_dispatch", "build_mode": "generic_linear"}, params)
    result = HiGHSAdapter().solve(model)
    assert result.objective_value == pytest.approx(12, abs=1e-6)
    assert len(result.variable_values["unit_output"]) == 12
    assert set(result.variable_values["unit_output"].values()) == {1.0}


def test_bad_numeric_leaf_rejected_at_exact_axis():
    contract = parameter_input_contract({"code": "load_forecast", "dimension": ["time"], "sample_value": [50, 80, 100, 40]}, {"time": [0, 1, 2, 3]})
    error = validate_parameter_input({"key": "load_forecast", **contract}, [50, "not-a-number", 100, 40])
    assert error and error["field"] == "load_forecast[1]"


def test_blank_optional_editor_metadata_does_not_turn_math_parameter_into_string():
    contract = parameter_input_contract({'code': 'load', 'sample_value': '', 'default': ''}, {})
    assert contract['allowed_formats'] == ['number']
    assert validate_parameter_input({'key': 'load', **contract}, 10) is None
    explicit = parameter_input_contract({'code': 'label', 'type': 'string', 'sample_value': ''}, {})
    assert explicit['allowed_formats'] == ['string']


def test_new_builtin_version_has_user_identity_and_canonical_draft_version(client):
    source = next(model for model in model_service.list_models() if model.template_id == "economic_dispatch" and (model.ui_metadata or {}).get("managed_default_template"))
    source = source.model_copy(update={"model_draft": {"basic_info": {"version": source.version}}})
    package = model_version_service.new_version_package(source)
    assert not package.ui_metadata.get("managed_default_template")
    assert package.model_draft["basic_info"]["version"] == package.version


def test_unbounded_solver_retains_termination_and_no_primal_solution():
    import pyomo.environ as pyo
    model = pyo.ConcreteModel()
    model.production = pyo.Var(within=pyo.NonNegativeReals)
    model.objective = pyo.Objective(expr=-model.production)
    result = HiGHSAdapter().solve(model)
    assert result.status == "unbounded"
    assert result.objective_value is None
    assert "unbounded" in result.raw_termination_condition.lower()
    from app.explainers.generic_explainer import generic_explainer
    explanation = generic_explainer.explain({'solver': {'status': 'FAILED', 'termination_condition': 'unbounded'}})
    assert '无界' in explanation['summary'] and '上界' in explanation['summary']
    assert '构建失败' not in explanation['summary']


def test_single_storage_full_soc_zero_export_cannot_dissipate():
    params = {"site": ["PV1"], "storage": ["B1"], "horizon": 1, "renewable_forecast": {"PV1": [10]},
              "load_forecast": [0], "electricity_price": [0], "grid_export_limit": [0], "storage_capacity": {"B1": 10},
              "initial_soc": {"B1": 10}, "charge_power_max": {"B1": 10}, "discharge_power_max": {"B1": 10}}
    model, context = PyomoModelBuilder().build({"model_code": "renewable_storage_dispatch"}, params)
    result = HiGHSAdapter().solve(model)
    # With no sink and a full device, exclusivity forces all 10 MWh to curtail.
    assert result.objective_value == pytest.approx(10000, abs=1e-6)
    assert result.variable_values["storage_charge"]["storage_charge[B1,0]"] == pytest.approx(0)
    assert result.variable_values["storage_discharge"]["storage_discharge[B1,0]"] == pytest.approx(0)
    assert context["storage_semantics"] == "individual_exclusive"


def test_function_stale_save_preserves_both_revisions(client):
    from uuid import uuid4
    fid = "cloud_conflict_" + uuid4().hex[:8]
    original = client.post("/api/function-assets", json={"function_id": fid, "name": fid, "points": [[0, 0], [1, 1]], "status": "published"}).json()
    first = client.put(f"/api/function-assets/{fid}", json={"points": [[0, 0], [1, 2]], "expected_revision": original["revision"]})
    assert first.status_code == 200
    stale = client.put(f"/api/function-assets/{fid}", json={"points": original["points"], "expected_content_hash": original["content_hash"]})
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "FUNCTION_DRAFT_CONFLICT"
    current = client.get(f"/api/function-assets/{fid}").json()
    assert current["points"] == [[0, 0], [1, 2]] and current["revision"] == 2
    assert client.get(f"/api/function-assets/{fid}/versions/1").json()["points"] == original["points"]


def test_component_can_be_copied_twice_without_losing_formulas(client):
    catalog = client.get("/api/components/catalog").json()
    source = next(row for row in catalog if row.get("generated_constraints") and row.get("status") == "published")
    first = client.post(f"/api/components/{source['component_id']}/copy-version").json()
    second = client.post(f"/api/components/{source['component_id']}/copy-version").json()
    assert first["component_id"] != second["component_id"]
    expected = [(row["constraint_id"], row["expression"], row["indices"]) for row in source["generated_constraints"]]
    for copied in (first, second):
        assert [(row["constraint_id"], row["expression"], row["indices"]) for row in copied["generated_constraints"]] == expected


def test_new_version_persists_and_put_without_version_cannot_regress(client, tmp_path, monkeypatch):
    import json
    from app.storage.memory_store import STORE, MemoryStore
    from tests.test_helpers import test_and_publish_model
    original = client.get("/api/models/MODEL-POWER-ECONOMIC-DISPATCH").json()
    created = client.post(f"/api/models/{original['id']}/versions", json={"name": "synthetic durable native version"})
    assert created.status_code == 200, created.text
    asset = created.json()
    version = asset["version"]
    assert version != original["version"]
    body = deepcopy(asset)
    body.pop("version")
    assert client.put(f"/api/models/{asset['id']}", json=body).json()["version"] == version
    test_and_publish_model(client, asset["id"], asset["parameters"])
    persisted = json.loads(STORE.persistence_path.read_text())
    assert asset["id"] in persisted["models"]
    monkeypatch.setenv("OPTIFORGE_RUNTIME_STORE", str(STORE.persistence_path))
    restored = MemoryStore()
    assert restored.models[asset["id"]].status == "published"
    assert restored.models[asset["id"]].version == version


def test_invalid_request_does_not_create_task_and_legacy_invalid_task_terminates(client):
    from app.storage.memory_store import STORE
    from app.schemas.solve import SolveRequest, TaskRecord
    from app.jobs.job_runner import job_runner
    before = set(STORE.tasks)
    response = client.post("/api/tasks", json={"model_id": "MODEL-POWER-ECONOMIC-DISPATCH", "parameters": {**dispatch_parameters(), "load_forecast": [50, "not-a-number", 100, 40]}, "async_run": False})
    assert response.status_code == 422
    assert set(STORE.tasks) == before
    assert "load_forecast[1]" in response.text
    task = TaskRecord(id="CLOUD-HISTORIC-MALFORMED", request=SolveRequest(payload={"semantic_spec": {"model_code": "economic_dispatch"}, "load_forecast": ["not-a-number"]}))
    STORE.tasks[task.id] = task
    job_runner.run(task.id)
    assert STORE.tasks[task.id].status == "FAILED"
    assert STORE.tasks[task.id].trace["diagnostic_error"] == "ValueError"


def test_task_input_view_reads_frozen_values_after_current_model_changes(client):
    from app.storage.memory_store import STORE
    response = client.post("/api/tasks", json={"model_id": "MODEL-POWER-ECONOMIC-DISPATCH", "parameters": dispatch_parameters(), "async_run": False})
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["status"] == "SUCCESS", task
    assert task["runtime_parameters"]["load_forecast"] == [50, 80, 100, 40]
    current = STORE.models[task["model_id"]]
    STORE.models[current.id] = current.model_copy(update={"parameters": {"load_forecast": [999]}})
    try:
        revisit = client.get(f"/api/tasks/{task['id']}").json()
        assert revisit["runtime_parameters"] == task["runtime_parameters"]
        assert revisit["model_version"] == current.version
        assert revisit["horizon"] == 4
    finally:
        STORE.models[current.id] = current


def test_lp_degenerate_nlp_uses_highs_and_zero_even_with_template_solver(client):
    source = client.get("/api/models/MODEL-POWER-NONLINEAR-HYDRO-POWER-DEMO").json()
    response = client.post("/api/tasks", json={"model_id": source["id"], "parameters": {"k": 0}, "solver": "Ipopt", "async_run": False})
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["status"] == "SUCCESS", task
    assert task["objective_value"] == pytest.approx(0)
    assert task["solver"] == "HiGHS"


def test_unit_facts_keep_leading_and_total_distinct_when_reordered():
    from app.services.result_interpreter import ResultInterpreter
    spec = {"sets": [{"code": "unit", "values": ["U2", "U1"]}, {"code": "time", "values": [0, 1]}],
            "variables": [{"code": "unit_output", "dimension": ["unit", "time"], "unit": "MW"}]}
    values = {"unit_output": {"unit_output[U2,0]": 100, "unit_output[U1,0]": 200, "unit_output[U2,1]": 95, "unit_output[U1,1]": 280}}
    evidence = ResultInterpreter().business_evidence(spec, values)
    assert evidence["unit_output"]["by_unit"]["U1"] == 480
    assert evidence["unit_output"]["total_output"] == 675
    assert "480" in evidence["facts"][0]["text"]


def test_ipopt_timeout_detection_requires_a_termination_message():
    from app.solvers.nlp_adapter import NLPSolverAdapter
    assert not NLPSolverAdapter._cpu_limit_reached('max_cpu_time=20.0\nEXIT: Optimal Solution Found.')
    assert NLPSolverAdapter._cpu_limit_reached('EXIT: Maximum CPU time exceeded.')
    assert NLPSolverAdapter._cpu_limit_reached('Maximum_CpuTime_Exceeded')


def test_retry_records_observed_attempt_without_inventing_legacy_history(client):
    from app.storage.memory_store import STORE
    from app.schemas.solve import SolveRequest, TaskRecord
    from app.services.job_service import job_service
    source = STORE.models['MODEL-POWER-ECONOMIC-DISPATCH']
    task = job_service.create_task(SolveRequest(model_id=source.id, parameters=dispatch_parameters(), async_run=False))
    original_request = deepcopy(task.request.model_dump(mode='json'))
    original_attempt = task.attempt_id
    task.status = 'INTERRUPTED'
    task.error = 'synthetic restart observation'
    assert task.attempt_history == []
    retried = job_service.retry_task(task.id)
    assert retried.id == task.id and retried.attempt_id != original_attempt
    history = STORE.tasks[task.id].attempt_history
    assert len(history) == 1
    assert history[0]['attempt_id'] == original_attempt and history[0]['status'] == 'INTERRUPTED'
    assert history[0]['request'] == original_request


@pytest.mark.parametrize('code', ['economic_dispatch', 'nonlinear_hydro_power_demo'])
def test_copied_native_template_keeps_builder_identity_in_test_and_publish_checks(client, code):
    source_id = 'MODEL-POWER-' + code.upper().replace('_', '-')
    copied = client.post(f'/api/models/{source_id}/copy').json()
    assert copied['semantic_spec']['template_code'] == code
    package = model_service.get_model(copied['id'])
    result = model_service._dry_run_model(package, run_solver=False)
    assert result['structure_check']['status'] == 'passed', result


def test_declared_defaults_match_schema_and_preserve_configured_value_precedence():
    from types import SimpleNamespace
    from app.services.job_service import job_service
    from app.services.invocation_service import invocation_service
    from app.parameter_input_contract import declared_parameter_defaults
    semantic = {'parameters': [{'code': 'price', 'default': 5}, {'code': 'required_input', 'sample': 999, 'default_policy': 'user_required'}]}
    assert invocation_service.input_schema(semantic)[0]['default_policy'] == 'default_allowed'
    assert declared_parameter_defaults(semantic) == {'price': 5}
    model = SimpleNamespace(semantic_spec=semantic, model_draft={}, parameters={'price': 7})
    assert job_service._default_parameters_from_model(model) == {'price': 7}


@pytest.mark.parametrize('delta', [.25, .5, 1])
def test_storage_result_energy_integrates_power_and_matches_soc(delta):
    from app.templates.power_templates import get_template
    from app.explain.result_formatter import SolveResultFormatter
    template = get_template('pv_storage_day_ahead_dispatch')
    params = {**deepcopy(template['sample_runtime_parameters']), 'horizon': 2, 'time': [0, 1], 'time_volume': [0, 1, 2],
              'pv_forecast': [10, 0], 'price': [0, 10], 'schedule': [0, 10], 'grid_limit': [0, 10],
              'delta_t': delta, 'eta_ch': 1, 'eta_dis': 1, 'initial_soc': 0, 'terminal_time': 2, 'terminal_soc_target': 0,
              'storage_power_capacity': 10, 'storage_energy_capacity': 10, 'soc_min': 0, 'soc_max': 1,
              'storage_cycle_cost': 0, 'degradation_cost_yuan_per_mwh': 0, 'curtailment_penalty': 1000}
    params['weights'] = {**params['weights'], 'energy_revenue': 1}
    model, context = PyomoModelBuilder().build(template, params)
    result = HiGHSAdapter().solve(model)
    assert result.status == 'optimal'
    assert result.objective_value == pytest.approx(-100 * delta, abs=1e-6)
    assert result.variable_values['p_ch']['p_ch[0]'] == pytest.approx(10)
    assert result.variable_values['soc']['soc[1]'] == pytest.approx(10 * delta)
    formatted = SolveResultFormatter().format('pv_storage_day_ahead_dispatch', result, context)
    assert formatted['metrics']['storage_charge_energy'] == pytest.approx(10 * delta)
    assert formatted['metrics']['storage_discharge_energy'] == pytest.approx(10 * delta)
