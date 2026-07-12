from __future__ import annotations

import json
from copy import deepcopy

import pyomo.environ as pyo

from app.builders.pyomo_builder import PyomoModelBuilder
from app.solvers.solver_router import solver_router
from app.templates.power_templates import get_template


def test_hydro_pwl2d_three_station_24_period_performance_record() -> None:
    template = get_template("cascade_hydro_dispatch")
    params = deepcopy(template["sample_runtime_parameters"])
    horizon = 24
    params.update(
        horizon=horizon,
        time=list(range(horizon)),
        time_volume=list(range(horizon + 1)),
        hydro_power_mode="pwl_2d",
        load_tracking_mode="disabled",
        objective_mode="generation_max",
        ramp_smoothing_enabled=False,
        load_forecast=[0.0] * horizon,
    )
    params["local_inflow"] = {
        station: [values[index % len(values)] for index in range(horizon)]
        for station, values in params["local_inflow"].items()
    }
    params["availability"] = {unit: [1.0] * horizon for unit in params["availability"]}
    params["volume_min"] = {station: 85.0 for station in params["station"]}
    params["initial_volume"] = {station: max(90.0, params["initial_volume"][station]) for station in params["station"]}
    params["target_terminal_volume"] = {
        station: max(90.0, params["target_terminal_volume"][station]) for station in params["station"]
    }
    params["gen_flow_min"] = {station: 40.0 for station in params["station"]}
    params["gen_flow_max"] = {station: 160.0 for station in params["station"]}
    params["outflow_min"] = {station: 40.0 for station in params["station"]}
    params["outflow_max"] = {station: 160.0 for station in params["station"]}
    params["ecological_flow_min"] = {station: 40.0 for station in params["station"]}
    params["spill_max"] = {station: 0.0 for station in params["station"]}

    model, context = PyomoModelBuilder().build(template, params)
    problem_type = solver_router.infer_problem_type_from_model(model)
    result = solver_router.solve(
        model,
        problem_type=problem_type,
        requested_solver="HiGHS",
        mip_gap=0.01,
        time_limit_seconds=180,
    )
    size = context["model_size"]
    record = {
        "problem_type": problem_type,
        "variable_count": size["variables"],
        "binary_variable_count": size["binary_variables"],
        "constraint_count": size["constraints"],
        "solve_status": result.status,
        "termination_condition": result.termination_condition,
        "solve_time_seconds": result.solve_time,
        "mip_gap": result.mip_gap,
        "objective_value": result.objective_value,
    }
    print("HYDRO_PWL2D_PERFORMANCE=" + json.dumps(record, ensure_ascii=False, sort_keys=True))

    assert problem_type == "MILP"
    assert result.status in {"optimal", "feasible"}
    assert result.objective_value is not None
    assert result.mip_gap is not None
    assert 1_000 <= size["binary_variables"] <= 5_400
    assert size["variables"] <= 24_000
    assert size["constraints"] <= 24_000
    assert sum(1 for var in model.component_data_objects(pyo.Var, active=True) if var.is_binary()) == size["binary_variables"]
