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


def _solve_case():
    function_asset_service.seed_default_assets()
    template = get_template("cascade_hydro_dispatch_v1")
    params = deepcopy(template["sample_runtime_parameters"])
    model, context = PyomoModelBuilder().build(template, params)
    result = solver_router.solve(model, problem_type="MILP", requested_solver="HiGHS", time_limit_seconds=30)
    formatted = SolveResultFormatter().format("cascade_hydro_dispatch_v1", result, context)
    return template, params, model, context, result, formatted


def test_cascade_hydro_v1_sample_data_and_template_exist() -> None:
    templates = get_power_templates()
    assert "cascade_hydro_dispatch_v1" in templates
    template = templates["cascade_hydro_dispatch_v1"]
    sample = template["sample_runtime_parameters"]
    assert template["model_problem_type"] == "MILP"
    assert template["solver"] == "HiGHS"
    assert sample["reservoir"] == ["R1", "R2"]
    assert len(sample["time"]) == 24
    assert set(sample["function_asset_bindings"]) == {"level_storage", "tailwater_outflow", "power_surface"}


def test_cascade_hydro_v1_function_assets_exist_in_center() -> None:
    assets = {asset.function_id: asset for asset in function_asset_service.list_assets()}
    assert assets["cascade_hydro_level_storage_v1"].function_type == "piecewise_1d"
    assert assets["cascade_hydro_tailwater_outflow_v1"].function_type == "piecewise_1d"
    assert assets["cascade_hydro_power_surface_v1"].function_type == "piecewise_2d"
    assert assets["cascade_hydro_power_surface_v1"].triangles


def test_cascade_hydro_v1_pyomo_model_builds_and_router_diagnoses_milp() -> None:
    template = get_template("cascade_hydro_dispatch_v1")
    model, context = PyomoModelBuilder().build(template, deepcopy(template["sample_runtime_parameters"]))
    assert context["model_code"] == "cascade_hydro_dispatch_v1"
    assert context["model_size"]["binary_variables"] > 0
    assert solver_router.infer_problem_type_from_model(model) == "MILP"
    route = solver_router.route("MILP", "HiGHS")
    assert route["ok"] is True
    assert route["selected_solver"] == "HiGHS"


def test_cascade_hydro_v1_highs_solves_and_objective_is_reasonable() -> None:
    _, _, _, context, result, formatted = _solve_case()
    assert result.status == "optimal"
    assert result.objective_value is not None
    assert formatted["metrics"]["total_generation_MWh"] > 0
    assert formatted["metrics"]["total_spill_million_m3"] >= 0
    assert formatted["metrics"]["binary_variable_count"] == context["model_size"]["binary_variables"]


def test_cascade_hydro_v1_water_balance_has_no_obvious_violation() -> None:
    _, _, _, _, _, formatted = _solve_case()
    assert formatted["water_balance_check"]
    assert formatted["metrics"]["max_water_balance_error"] <= 1e-5
    assert max(abs(row["balance_error"]) for row in formatted["water_balance_check"]) <= 1e-5


def test_cascade_hydro_v1_result_explanation_contains_required_outputs() -> None:
    _, _, _, _, _, formatted = _solve_case()
    business_output = formatted["business_output"]
    assert "total_generation_MWh" in formatted["metrics"]
    assert "total_spill_million_m3" in formatted["metrics"]
    assert business_output["station_summary"]
    assert business_output["storage_curve"]
    assert business_output["outflow_curve"]
    assert business_output["power_curve"]
    assert business_output["water_balance_check"]
    assert business_output["function_asset_interpolation"]
    first_interp = business_output["function_asset_interpolation"][0]
    assert first_interp["level_storage"]["function_asset_id"] == "cascade_hydro_level_storage_v1"
    assert first_interp["tailwater_outflow"]["function_asset_id"] == "cascade_hydro_tailwater_outflow_v1"
    assert first_interp["power_surface"]["function_asset_id"] == "cascade_hydro_power_surface_v1"
    assert "selected_triangle" in first_interp["power_surface"]


def test_cascade_hydro_v1_optimize_api_runs_complete_chain() -> None:
    template = get_template("cascade_hydro_dispatch_v1")
    response = client.post(
        "/api/optimize/run",
        json={
            "model_code": "cascade_hydro_dispatch_v1",
            "runtime_parameters": deepcopy(template["sample_runtime_parameters"]),
            "async_run": False,
            "time_limit_seconds": 30,
        },
    )
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["status"] == "SUCCESS", task
    result = client.get(f"/api/optimize/result/{task['id']}")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["solver_config"]["problem_type"] == "MILP"
    assert body["metrics"]["total_generation_MWh"] > 0
    assert "function_asset_interpolation" in body["business_output"]


def test_cascade_hydro_v1_model_service_publish_and_invoke() -> None:
    clone = client.post("/api/templates/cascade_hydro_dispatch_v1/clone")
    assert clone.status_code == 200, clone.text
    model_id = clone.json()["id"]

    publish = client.post(f"/api/models/{model_id}/publish")
    assert publish.status_code == 200, publish.text
    assert publish.json()["status"] == "published"
    assert publish.json()["problem_type"] == "MILP"

    params = deepcopy(get_template("cascade_hydro_dispatch_v1")["sample_runtime_parameters"])
    invoke = client.post(
        f"/api/models/{model_id}/invoke",
        json={"parameters": params, "options": {"mode": "sync", "time_limit_seconds": 30}},
    )
    assert invoke.status_code == 200, invoke.text
    body = invoke.json()
    assert body["status"] == "SUCCESS", body
    assert body["business_result"]["overview"]["total_generation_MWh"] > 0
    assert body["business_result"]["function_asset_interpolation"]
