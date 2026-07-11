from __future__ import annotations

from copy import deepcopy

from fastapi.testclient import TestClient

from app.builders.pyomo_builder import PyomoModelBuilder
from app.explain.result_formatter import SolveResultFormatter
from app.main import app
from app.services.function_asset_service import function_asset_service
from app.solvers.solver_router import solver_router
from app.templates.power_templates import get_power_templates, get_template


client = TestClient(app)


def _short_params() -> dict:
    params = deepcopy(get_template("cascade_hydro_dispatch_v1")["sample_runtime_parameters"])
    params["horizon"] = 4
    params["time"] = list(range(4))
    params["time_volume"] = list(range(5))
    for key in ("load_forecast",):
        params[key] = params[key][:4]
    for key in ("local_inflow", "inflow", "availability"):
        params[key] = {name: values[:4] for name, values in params[key].items()}
    return params


def _solve_case():
    template = get_template("cascade_hydro_dispatch_v1")
    params = _short_params()
    model, context = PyomoModelBuilder().build(template, params)
    result = solver_router.solve(model, problem_type="MILP", requested_solver="HiGHS", time_limit_seconds=30)
    formatted = SolveResultFormatter().format("cascade_hydro_dispatch_v1", result, context)
    return template, params, model, context, result, formatted


def test_cascade_hydro_v1_is_deprecated_compatibility_alias() -> None:
    template = get_power_templates()["cascade_hydro_dispatch_v1"]
    assert template["deprecated"] is True
    assert template["replacement_model_code"] == "cascade_hydro_dispatch"
    assert template["build_mode"] == "component_based"
    assert template["sample_runtime_parameters"]["hydro_power_mode"] == "pwl_2d"
    assert len(template["sample_runtime_parameters"]["time"]) == 24


def test_cascade_hydro_v1_function_assets_are_strict_and_multi_triangle() -> None:
    assets = {asset.function_id: asset for asset in function_asset_service.list_assets()}
    assert assets["cascade_hydro_level_storage_v1"].interpolation_mode == "segment_binary"
    assert assets["cascade_hydro_tailwater_outflow_v1"].interpolation_mode == "segment_binary"
    surface = assets["cascade_hydro_power_surface_v1"]
    assert len(surface.points_2d) == 16
    assert len(surface.triangles) == 18


def test_cascade_hydro_v1_uses_unified_component_builder_and_milp() -> None:
    _, _, model, context, result, _ = _solve_case()
    assert context["build_mode"] == "component_based"
    assert "function_mapping_2d_component" in context["component_types"]
    assert solver_router.infer_problem_type_from_model(model) == "MILP"
    assert result.status == "optimal"


def test_cascade_hydro_v1_result_explanation_is_unified() -> None:
    _, _, _, context, result, formatted = _solve_case()
    output = formatted["business_output"]
    assert formatted["metrics"]["total_generation_MWh"] > 0
    assert output["load_tracking"]
    assert output["water_balance_check"]
    assert output["function_asset_interpolation"]
    assert output["milp_size"]["binary_variables"] == context["model_size"]["binary_variables"]
    assert max(abs(row["balance_error_million_m3"]) for row in output["water_balance_check"]) <= 1e-6


def test_cascade_hydro_v1_optimize_api_runs_compatibility_chain() -> None:
    response = client.post(
        "/api/optimize/run",
        json={"model_code": "cascade_hydro_dispatch_v1", "runtime_parameters": _short_params(), "async_run": False, "time_limit_seconds": 30},
    )
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["status"] == "SUCCESS", task
    result = client.get(f"/api/optimize/result/{task['id']}")
    assert result.status_code == 200, result.text
    assert result.json()["solver_config"]["problem_type"] == "MILP"


def test_cascade_hydro_v1_model_service_publish_and_invoke() -> None:
    clone = client.post("/api/templates/cascade_hydro_dispatch_v1/clone")
    assert clone.status_code == 200, clone.text
    model_id = clone.json()["id"]
    publish = client.post(f"/api/models/{model_id}/publish")
    assert publish.status_code == 200, publish.text
    assert publish.json()["problem_type"] == "MILP"
    invoke = client.post(
        f"/api/models/{model_id}/invoke",
        json={"parameters": _short_params(), "options": {"mode": "sync", "time_limit_seconds": 30}},
    )
    assert invoke.status_code == 200, invoke.text
    body = invoke.json()
    assert body["status"] == "SUCCESS", body
    assert body["business_result"]["function_asset_interpolation"]
