from __future__ import annotations

from copy import deepcopy

import pyomo.environ as pyo
import pytest

from app.builders.pyomo_builder import PyomoModelBuilder
from app.explain.result_formatter import SolveResultFormatter
from app.services.function_asset_service import function_asset_service, get_function_asset_surface
from app.services.pwl_modeling_service import pwl_modeling_service
from app.solvers.solver_router import solver_router
from app.templates.power_templates import get_template


def _solve(params: dict, template_code: str = "cascade_hydro_dispatch"):
    template = get_template(template_code)
    model, context = PyomoModelBuilder().build(template, params)
    problem_type = solver_router.infer_problem_type_from_model(model)
    result = solver_router.solve(model, problem_type=problem_type, requested_solver="HiGHS", time_limit_seconds=30)
    return model, context, result


def _base_params() -> dict:
    params = deepcopy(get_template("cascade_hydro_dispatch")["sample_runtime_parameters"])
    params["ramp_smoothing_enabled"] = False
    return params


def _total_power(result, params: dict) -> list[float]:
    values = result.variable_values["station_power"]
    return [sum(values[f"station_power[{station},{time}]"] for station in params["station"]) for time in params["time"]]


def _total_deviation(result, params: dict) -> float:
    return sum(
        result.variable_values["load_dev_pos"][f"load_dev_pos[{time}]"]
        + result.variable_values["load_dev_neg"][f"load_dev_neg[{time}]"]
        for time in params["time"]
    )


def test_hydro_load_disabled_mode_ignores_forecast() -> None:
    first = _base_params()
    first.update(load_tracking_mode="disabled", objective_mode="load_tracking", load_forecast=[0] * 4)
    second = deepcopy(first)
    second["load_forecast"] = [10_000] * 4
    _, _, result_a = _solve(first)
    _, _, result_b = _solve(second)
    assert _total_power(result_a, first) == pytest.approx(_total_power(result_b, second))


def test_hydro_load_forecast_affects_soft_tracking() -> None:
    low = _base_params()
    low.update(load_tracking_mode="soft", objective_mode="load_tracking", load_forecast=[100] * 4)
    high = deepcopy(low)
    high["load_forecast"] = [300] * 4
    _, _, result_low = _solve(low)
    _, _, result_high = _solve(high)
    assert _total_power(result_low, low) == pytest.approx([100] * 4, abs=1e-5)
    assert _total_power(result_high, high) == pytest.approx([300] * 4, abs=1e-5)


def test_hydro_load_penalty_sensitivity() -> None:
    low = _base_params()
    low.update(load_tracking_mode="soft", objective_mode="comprehensive", load_forecast=[100] * 4)
    low["weights"]["load_deviation"] = 0
    high = deepcopy(low)
    high["weights"]["load_deviation"] = 10_000
    _, _, result_low = _solve(low)
    _, _, result_high = _solve(high)
    assert _total_deviation(result_high, high) <= _total_deviation(result_low, low)
    assert _total_deviation(result_high, high) == pytest.approx(0, abs=1e-5)


def test_hydro_hard_load_balance_and_infeasible_reason() -> None:
    feasible = _base_params()
    feasible.update(load_tracking_mode="hard", load_forecast=[100] * 4)
    _, _, result = _solve(feasible)
    assert _total_power(result, feasible) == pytest.approx([100] * 4, abs=1e-5)

    impossible = deepcopy(feasible)
    impossible["load_forecast"] = [10_000] * 4
    _, _, infeasible = _solve(impossible)
    assert infeasible.status == "infeasible"
    assert "不可行" in infeasible.message


def _solve_1d(x_value: float):
    points = [[0, 0], [10, 20], [20, 25], [30, 60]]
    model = pyo.ConcreteModel()
    model.i = pyo.Set(initialize=[0])
    model.x = pyo.Var(model.i)
    model.y = pyo.Var(model.i)
    model.x[0].fix(x_value)
    metadata = pwl_modeling_service.add_piecewise_1d(
        model, base_name="strict_curve", index_sets=[model.i], index_count=1, points=points,
        x_expr=lambda values: model.x[values[0]], y_expr=lambda values: model.y[values[0]],
        interpolation_mode="segment_binary",
    )
    model.objective = pyo.Objective(expr=model.y[0])
    result = solver_router.solve(model, problem_type="MILP", requested_solver="HiGHS", time_limit_seconds=30)
    return model, metadata, result


def test_hydro_1d_pwl_adjacent_breakpoints_and_interpolation() -> None:
    _, metadata, result = _solve_1d(15)
    lambdas = result.variable_values[metadata["lambda_variable"]]
    selected = result.variable_values[metadata["segment_binary_variable"]]
    assert result.variable_values["y"]["y[0]"] == pytest.approx(22.5)
    assert selected[f"{metadata['segment_binary_variable']}[0,1]"] == pytest.approx(1)
    assert lambdas[f"{metadata['lambda_variable']}[0,1]"] == pytest.approx(0.5)
    assert lambdas[f"{metadata['lambda_variable']}[0,2]"] == pytest.approx(0.5)
    assert lambdas[f"{metadata['lambda_variable']}[0,0]"] == pytest.approx(0)
    assert lambdas[f"{metadata['lambda_variable']}[0,3]"] == pytest.approx(0)


def test_hydro_1d_pwl_exact_breakpoint() -> None:
    _, metadata, result = _solve_1d(20)
    assert result.variable_values["y"]["y[0]"] == pytest.approx(25)
    assert result.variable_values[metadata["lambda_variable"]][f"{metadata['lambda_variable']}[0,2]"] == pytest.approx(1)


def test_hydro_1d_pwl_out_of_domain() -> None:
    _, _, result = _solve_1d(31)
    assert result.status == "infeasible"


def test_hydro_2d_pwl_multiple_triangles_and_local_vertices() -> None:
    surface = get_function_asset_surface("cascade_hydro_power_surface_v1")
    assert len(surface["points_2d"]) == 16
    assert len(surface["triangles"]) == 18

    model = pyo.ConcreteModel()
    model.i = pyo.Set(initialize=[0, 1])
    model.x = pyo.Var(model.i)
    model.y = pyo.Var(model.i)
    model.z = pyo.Var(model.i)
    model.x[0].fix(60); model.y[0].fix(40)
    model.x[1].fix(140); model.y[1].fix(60)
    metadata = pwl_modeling_service.add_piecewise_2d(
        model, base_name="surface", index_sets=[model.i], index_count=1,
        points=surface["points_2d"], triangles=surface["triangles"],
        x_expr=lambda values: model.x[values[0]], y_expr=lambda values: model.y[values[0]], z_expr=lambda values: model.z[values[0]],
    )
    model.objective = pyo.Objective(expr=sum(model.z[i] for i in model.i))
    result = solver_router.solve(model, problem_type="MILP", requested_solver="HiGHS", time_limit_seconds=30)
    selected_values = result.variable_values[metadata["binary_variable"]]
    selected = [
        next(k for k in range(18) if selected_values[f"{metadata['binary_variable']}[{i},{k}]"] > 0.5)
        for i in model.i
    ]
    assert selected[0] != selected[1]
    lambdas = result.variable_values[metadata["lambda_variable"]]
    for i, triangle in enumerate(selected):
        assert sum(lambdas[f"{metadata['lambda_variable']}[{i},{triangle},{j}]"] for j in range(3)) == pytest.approx(1)
        assert all(
            lambdas[f"{metadata['lambda_variable']}[{i},{other},{j}]"] == pytest.approx(0)
            for other in range(18) if other != triangle for j in range(3)
        )
    assert result.variable_values["z"]["z[1]"] > result.variable_values["z"]["z[0]"]


def test_hydro_2d_pwl_domain_validation() -> None:
    params = _base_params()
    params["hydro_power_mode"] = "pwl_2d"
    with pytest.raises(RuntimeError, match="函数资产定义域不覆盖模型运行边界"):
        PyomoModelBuilder().build(get_template("cascade_hydro_dispatch"), params)


@pytest.mark.parametrize("mode,expected", [("linear", "LP"), ("pwl_1d", "MILP"), ("pwl_2d", "MILP")])
def test_hydro_unified_power_modes(mode: str, expected: str) -> None:
    params = _base_params()
    params["hydro_power_mode"] = mode
    if mode != "linear":
        params["gen_flow_min"] = {station: 40 for station in params["station"]}
        params["gen_flow_max"] = {station: 160 for station in params["station"]}
    if mode == "pwl_2d":
        params["volume_min"] = {station: 85 for station in params["station"]}
        params["initial_volume"] = {station: max(90, params["initial_volume"][station]) for station in params["station"]}
        params["target_terminal_volume"] = {station: max(90, params["target_terminal_volume"][station]) for station in params["station"]}
        params["outflow_min"] = {station: 40 for station in params["station"]}
        params["outflow_max"] = {station: 160 for station in params["station"]}
        params["ecological_flow_min"] = {station: 40 for station in params["station"]}
    model, _, result = _solve(params)
    assert solver_router.infer_problem_type_from_model(model) == expected
    assert result.status == "optimal"


def test_hydro_v1_backward_compatibility_uses_unified_components() -> None:
    template = get_template("cascade_hydro_dispatch_v1")
    params = deepcopy(template["sample_runtime_parameters"])
    params["horizon"] = 4
    params["time"] = list(range(4))
    params["time_volume"] = list(range(5))
    params["load_forecast"] = params["load_forecast"][:4]
    params["local_inflow"] = {key: value[:4] for key, value in params["local_inflow"].items()}
    params["inflow"] = deepcopy(params["local_inflow"])
    params["availability"] = {key: value[:4] for key, value in params["availability"].items()}
    model, context, result = _solve(params, "cascade_hydro_dispatch_v1")
    assert context["model_code"] == "cascade_hydro_dispatch_v1"
    assert context["build_mode"] == "component_based"
    assert solver_router.infer_problem_type_from_model(model) == "MILP"
    assert result.status == "optimal"


def test_hydro_result_explanation_contains_load_pwl_and_balances() -> None:
    params = _base_params()
    params.update(load_tracking_mode="soft", load_forecast=[100] * 4)
    _, context, result = _solve(params)
    formatted = SolveResultFormatter().format("cascade_hydro_dispatch", result, context)
    output = formatted["business_output"]
    assert output["objective_breakdown"]["load_deviation_penalty_value"] >= 0
    assert output["load_tracking"][0]["load_dev_pos_MW"] >= 0
    assert max(abs(row["balance_error_million_m3"]) for row in output["water_balance_check"]) <= 1e-6


def test_hydro_load_deviation_direction_and_explanation() -> None:
    excess = _base_params()
    excess.update(load_tracking_mode="soft", objective_mode="load_tracking", load_forecast=[10] * 4)
    excess["gen_flow_min"] = {station: 100 for station in excess["station"]}
    _, excess_context, excess_result = _solve(excess)
    excess_output = SolveResultFormatter().format("cascade_hydro_dispatch", excess_result, excess_context)["business_output"]
    assert all(row["load_dev_pos_MW"] > 0 and row["load_dev_neg_MW"] == pytest.approx(0) for row in excess_output["load_tracking"])
    assert all("超发" in row["load_dev_pos_description"] for row in excess_output["load_tracking"])

    shortage = _base_params()
    shortage.update(load_tracking_mode="soft", objective_mode="load_tracking", load_forecast=[10_000] * 4)
    _, shortage_context, shortage_result = _solve(shortage)
    shortage_output = SolveResultFormatter().format("cascade_hydro_dispatch", shortage_result, shortage_context)["business_output"]
    assert all(row["load_dev_neg_MW"] > 0 and row["load_dev_pos_MW"] == pytest.approx(0) for row in shortage_output["load_tracking"])
    assert all("缺额" in row["load_dev_neg_description"] for row in shortage_output["load_tracking"])


def test_hydro_2d_asset_uses_q_gen_and_rejects_q_out_binding() -> None:
    asset = next(item for item in function_asset_service.list_assets() if item.function_id == "cascade_hydro_power_surface_v1")
    assert asset.input_schema[0]["code"] == "q_gen"
    assert asset.input_schema[0]["name"] == "发电流量"

    template = deepcopy(get_template("cascade_hydro_dispatch"))
    mapping = next(
        item for item in template["component_spec"]["components"]
        if item.get("type") == "function_mapping_2d_component"
    )
    mapping["x"] = "q_out[s,t]"
    params = deepcopy(template["sample_runtime_parameters"])
    params["hydro_power_mode"] = "pwl_2d"
    params["volume_min"] = {station: 85 for station in params["station"]}
    params["initial_volume"] = {station: max(90, params["initial_volume"][station]) for station in params["station"]}
    params["target_terminal_volume"] = {station: max(90, params["target_terminal_volume"][station]) for station in params["station"]}
    params["outflow_min"] = {station: 40 for station in params["station"]}
    params["outflow_max"] = {station: 160 for station in params["station"]}
    with pytest.raises(RuntimeError, match="应绑定 q_gen.*当前绑定为 q_out"):
        PyomoModelBuilder().build(template, params)


def test_hydro_function_asset_metadata_is_production_safe() -> None:
    assets = {item.function_id: item for item in function_asset_service.list_assets()}
    for function_id in ("cascade_hydro_level_storage_v1", "cascade_hydro_tailwater_outflow_v1", "cascade_hydro_power_flow_v1"):
        asset = assets[function_id]
        assert asset.interpolation_mode == "segment_binary"
        assert asset.out_of_domain_policy == "reject"
        assert asset.allow_extrapolation is False
        assert asset.domain["x_min"] < asset.domain["x_max"]
