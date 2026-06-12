from __future__ import annotations

from copy import deepcopy

from app.builders.pyomo_builder import PyomoModelBuilder
from app.explain.result_formatter import SolveResultFormatter
from app.services.model_service import model_service
from app.solvers.highs_adapter import HiGHSAdapter
from app.templates.power_templates import get_power_templates, get_template


def _solve_v2(overrides: dict | None = None):
    model_service.seed_default_templates()
    template = get_template("pv_storage_day_ahead_dispatch_v2")
    params = deepcopy(template["sample_runtime_parameters"])
    params.update(overrides or {})
    model, context = PyomoModelBuilder().build(template, params)
    result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    assert result.status == "optimal", result
    return template, params, context, result


def test_pv_storage_day_ahead_dispatch_v2_solves_sample() -> None:
    template, params, context, result = _solve_v2()
    formatted = SolveResultFormatter().format("pv_storage_day_ahead_dispatch_v2", result, context)
    metrics = formatted["metrics"]
    values = result.variable_values

    assert template["component_spec"]["model_problem_type"] == "MILP"
    for name in ["p_ch", "p_dis", "soc", "p_grid", "p_pv_curtail", "deviation_pos", "deviation_neg", "deviation_penalty", "u_ch", "u_dis"]:
        assert name in values
    assert metrics["soc_min_actual"] >= params["soc_min"] * params["storage_energy_capacity"] - 1e-5
    assert metrics["soc_max_actual"] <= params["soc_max"] * params["storage_energy_capacity"] + 1e-5
    assert formatted["constraint_check"]["charge_discharge_exclusive"] is True
    assert formatted["constraint_check"]["deviation_penalty_logic"] is True
    explanation = "\n".join(formatted["strategy_explanation"])
    assert "偏差考核成本" in explanation
    assert "SOC" in explanation
    assert "充放电互斥" in explanation


def test_pv_storage_v2_objective_keys_are_supported() -> None:
    template, _, context, _ = _solve_v2()
    active_keys = {term["weight_key"] for term in template["component_spec"]["objective"]["terms"] if term.get("solve_participation") == "solve_active"}

    assert {"deviation_penalty_cost", "battery_degradation"} <= active_keys
    assert "deviation_penalty_cost" in context["metadata"]["objective_weights"]
    assert "battery_degradation" in context["metadata"]["objective_weights"]


def test_pv_storage_v2_templates_expose_required_runtime_schema() -> None:
    templates = get_power_templates()
    required = {
        "deviation_limit": "array",
        "deviation_penalty_price": "number",
        "soc_max": "number",
        "degradation_cost_yuan_per_mwh": "number",
    }

    for code in ["pv_storage_dispatch_v2", "pv_storage_day_ahead_dispatch_v2", "pv_storage_intraday_dispatch_v2"]:
        params = {param["code"]: param for param in templates[code]["parameters"]}
        for key, expected_type in required.items():
            assert params[key]["validation"]["type"] == expected_type
        assert params["deviation_limit"]["validation"]["length_matches"] == "time"
        assert params["soc_max"]["validation"]["greater_than"] == "soc_min"
