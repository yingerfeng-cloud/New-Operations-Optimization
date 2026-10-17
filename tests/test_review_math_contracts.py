"""Known-answer regressions for the 2026-10-17 review (not success-only probes)."""
from copy import deepcopy
from uuid import uuid4

import pytest
import pyomo.environ as pyo

from app.builders.component_model_builder import ComponentModelBuilder
from app.model_components.formula_components import normalize_component_payload
from app.solvers.highs_adapter import HiGHSAdapter
from app.solvers.solver_router import solver_router
from app.storage.memory_store import STORE
from app.templates.power_templates import get_template
from tests.test_helpers import test_and_publish_model
from tests.test_piecewise_curve_components import _piecewise_component, _model_spec


@pytest.mark.parametrize("labels", [["B", "A"], [20, 10], ["20", "10"]])
@pytest.mark.parametrize("mapping", [False, True])
def test_parameter_axes_ignore_unrelated_set_order(client, labels, mapping):
    for unrelated in (labels, list(reversed(labels))):
        code = "review_cost_" + uuid4().hex[:8]
        costs = {str(labels[0]): 10, str(labels[1]): 20} if mapping else [10, 20]
        payload = {
            "name": "Review parameter axes", "scene": "review", "problem_type": "LP",
            "semantic_spec": {
                "model_code": code,
                "sets": [{"code": "unrelated", "values": unrelated}, {"code": "site", "values": labels}],
                "parameters": [{"code": "cost", "dimension": ["site"], "sample_value": costs, "validation": {"required": True}}],
                "variables": [{"code": "allocation", "dimension": ["site"], "domain": "NonNegativeReals"}],
            },
            "parameters": {"cost": costs},
            "generic_spec": {
                "sense": "minimize", "sets": {"unrelated": unrelated, "site": labels}, "parameters": {},
                "variables": [{"name": "allocation", "indices": ["site"]}],
                "constraints": [{"name": "one", "terms": [{"var": "allocation", "foreach": ["site"], "key": ["site"]}], "sense": "==", "rhs": 1}],
                "objective": {"terms": [{"var": "allocation", "foreach": ["site"], "key": ["site"], "coef_param": "cost", "param_key": ["site"]}]},
            },
        }
        created = client.post("/api/models", json=payload)
        assert created.status_code == 200, created.text
        model_id = created.json()["id"]
        test_and_publish_model(client, model_id, {"cost": costs})
        result = client.post(f"/api/models/{model_id}/invoke", json={"parameters": {"cost": costs}, "options": {"mode": "sync", "explain": False}})
        assert result.status_code == 200, result.text
        data = result.json()
        allocation = data["variable_values"]["allocation"]
        # Independent accounting in the declared site order.
        assert allocation[str(labels[0])] == pytest.approx(1)
        assert sum(allocation[str(label)] * cost for label, cost in zip(labels, [10, 20])) == pytest.approx(10)
        assert data["objective_value"] == pytest.approx(10)


@pytest.mark.parametrize("seconds", [900, 3600])
def test_hydro_published_objective_matches_independent_accounting(client, seconds):
    copied = client.post("/api/models/MODEL-POWER-CASCADE-HYDRO-DISPATCH/copy").json()
    params = deepcopy(get_template("cascade_hydro_dispatch")["sample_runtime_parameters"])
    params.update(time_step_seconds=seconds, ramp_smoothing_enabled=False)
    copied["parameters"] = params
    if seconds == 3600:
        for source in (copied, copied["semantic_spec"], copied["component_spec"]):
            source.setdefault("ui_metadata", {}).setdefault("time_dimension", {})["interval_minutes"] = 60
    updated = client.put(f"/api/models/{copied['id']}", json=copied)
    assert updated.status_code == 200, updated.text
    test_and_publish_model(client, copied["id"], params)
    response = client.post(f"/api/models/{copied['id']}/invoke", json={"parameters": params, "options": {"mode": "sync", "explain": False}})
    assert response.status_code == 200, response.text
    body = response.json()
    values = body["variable_values"]
    energy = sum(values["station_power"].values()) * seconds / 3600
    revenue = energy * params["electricity_price"]
    weights = params["weights"]
    expected = (
        weights["load_deviation"] * (sum(values["load_dev_pos"].values()) + sum(values["load_dev_neg"].values()))
        + weights["spill"] * sum(values["q_spill"].values())
        + weights["terminal_volume"] * (sum(values["terminal_dev_pos"].values()) + sum(values["terminal_dev_neg"].values()))
        - weights["generation"] * energy - weights["revenue"] * revenue
    )
    assert body["objective_value"] == pytest.approx(expected, abs=0.01)


@pytest.mark.parametrize("points,sense", [([[0, 0], [10, 100], [20, 110]], "minimize"), ([[0, 0], [10, 100], [20, 260]], "maximize")])
@pytest.mark.parametrize("power,expected", [(10, 100), (5, 50)])
def test_dynamic_piecewise_is_exact(points, sense, power, expected):
    component = _piecewise_component(points)
    definition = normalize_component_payload(component)
    with STORE.lock:
        STORE.custom_components[component["component_id"]] = {**definition, "status": "published"}
    spec = _model_spec(component)
    spec["objective"]["sense"] = sense
    model, context = ComponentModelBuilder().build(spec, {"time": [0, 1], "cost_curve": points})
    for t in model.time:
        model.p[t].fix(power)
    solved = HiGHSAdapter().solve(model)
    assert solved.status == "optimal"
    assert pyo.value(model.cost[0]) == pytest.approx(expected)
    assert solver_router.infer_problem_type_from_model(model) == "MILP"
    assert context["metadata"]["piecewise_constraints"][0]["compiler"] == "piecewise_1d_segment_binary"


@pytest.mark.parametrize("kind", ["QP", "MIQP"])
def test_unverified_quadratic_adapter_is_not_advertised(kind):
    route = solver_router.route(kind, "HiGHS")
    assert not route["ok"]
    assert route["error_code"] == "SOLVER_UNSUPPORTED_PROBLEM_TYPE"


def test_parameter_axes_preserve_each_axis_in_multidimensional_arrays():
    from app.builders.generic_linear_builder import GenericLinearBuilder
    spec = {
        "sets": {"unrelated": [10, 20], "site": [20, 10], "tariff": ["B", "A"]},
        "parameter_dimensions": {"cost": ["site", "tariff"]},
        "parameters": {"cost": [[1, 10], [20, 30]]},
        "variables": [{"name": "allocation", "indices": ["site", "tariff"]}],
        "constraints": [{"name": "one", "terms": [{"var": "allocation", "foreach": ["site", "tariff"], "key": ["site", "tariff"]}], "sense": "==", "rhs": 1}],
        "objective": {"terms": [{"var": "allocation", "foreach": ["site", "tariff"], "key": ["site", "tariff"], "coef_param": "cost"}]},
    }
    model, _ = GenericLinearBuilder().build(spec)
    result = HiGHSAdapter().solve(model)
    assert result.variable_values["allocation"]["20,B"] == pytest.approx(1)
    assert result.objective_value == pytest.approx(1)


@pytest.mark.parametrize("points,sense", [([[0, 0], [10, 100], [20, 110]], "minimize"), ([[0, 0], [10, 100], [20, 260]], "maximize")])
def test_exact_piecewise_passes_component_and_model_publication(client, points, sense):
    component = _piecewise_component(points)
    component["component_id"] = "review_piecewise_" + uuid4().hex[:8]
    component["constraints"][0]["piecewise_method"] = "binary_segment"
    component["constraints"].append({"constraint_id": "fixed_power", "expression": "p[t] == 10", "indices": [{"set": "time", "alias": "t"}], "solve_participation": "solve_active"})
    registered = client.post("/api/components/catalog", json=component)
    assert registered.status_code == 200, registered.text
    published = client.post(f"/api/components/{component['component_id']}/publish")
    assert published.status_code == 200, published.text
    spec = _model_spec(component)
    spec["model_code"] = "review_piecewise_" + uuid4().hex[:8]
    spec["objective"]["sense"] = sense
    created = client.post("/api/models", json={"name": "Review exact PWL", "scene": "review", "build_mode": "component_based", "problem_type": "MILP", "model_problem_type": "MILP", "parameters": {"horizon": 2}, "component_spec": spec, "semantic_spec": {**spec, "parameters": [], "variables": [{"code": "p", "dimension": ["time"]}, {"code": "cost", "dimension": ["time"]}]}})
    assert created.status_code == 200, created.text
    model_id = created.json()["id"]
    test_and_publish_model(client, model_id, {"horizon": 2})
    result = client.post(f"/api/models/{model_id}/invoke", json={"parameters": {"horizon": 2}, "options": {"mode": "sync", "explain": False}})
    assert result.status_code == 200, result.text
    assert result.json()["objective_value"] == pytest.approx(200)
    assert result.json()["variable_values"]["cost"]["cost[0]"] == pytest.approx(100)


def test_hydro_rejects_conflicting_duration_with_field_diagnostic(client):
    response = client.post("/api/optimize/run", json={"model_code": "cascade_hydro_dispatch", "parameters": {"time_step_seconds": 3600}})
    assert response.status_code == 422
    assert response.json()["detail"]["errors"][0]["field"] == "time_step_seconds"
