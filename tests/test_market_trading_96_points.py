from __future__ import annotations

from copy import deepcopy

import pytest

from app.builders.pyomo_builder import PyomoModelBuilder
from app.explain.result_formatter import SolveResultFormatter
from app.services.template_service import template_library
from app.solvers.highs_adapter import HiGHSAdapter
from app.templates.power_templates import get_template


_SOLVE_CACHE: dict[str, tuple[dict, dict, dict]] = {}


def _solve_template(code: str):
    if code in _SOLVE_CACHE:
        return deepcopy(_SOLVE_CACHE[code])
    template = get_template(code)
    params = deepcopy(template["sample_runtime_parameters"])
    model, context = PyomoModelBuilder().build(template, params)
    result = HiGHSAdapter().solve(model, time_limit_seconds=60)
    assert result.status == "optimal", result
    formatted = SolveResultFormatter().format(code, result, context)
    _SOLVE_CACHE[code] = (template, params, formatted)
    return deepcopy(_SOLVE_CACHE[code])


def test_market_trading_default_samples_are_96_point_day_ahead() -> None:
    for code in ["contract_spot_exposure_v1", "retail_da_spot_bidding_v1"]:
        template = get_template(code)
        sample = template["sample_runtime_parameters"]

        assert sample["horizon"] == 96
        assert sample["delta_t"] == 0.25
        assert sample["time"] == list(range(96))
        assert len(sample["time_labels"]) == 96
        assert sample["time_labels"][0] == "00:00"
        assert sample["time_labels"][-1] == "23:45"

        time_set = next(item for item in template["sets"] if item["code"] == "time")
        assert time_set["time_granularity"] == 15
        assert template_library._template_time_granularity(template) == "15min"

    retail_sample = get_template("retail_da_spot_bidding_v1")["sample_runtime_parameters"]
    assert retail_sample["time_volume"] == list(range(97))


def test_contract_spot_constraint_check_is_derived_from_metrics() -> None:
    _template, _params, formatted = _solve_template("contract_spot_exposure_v1")
    output = formatted["business_output"]
    checks = output["constraint_check"]

    assert "contract_total_gap" in checks
    assert "max_spot_exposure_violation" in checks
    assert isinstance(checks["contract_total_gap"], (int, float))
    assert isinstance(checks["max_spot_exposure_violation"], (int, float))
    assert checks["contract_total_satisfied"] == (checks["contract_total_gap"] <= 1e-5)
    assert checks["spot_exposure_within_limit"] == (checks["max_spot_exposure_violation"] <= 1e-5)


def test_market_trading_chart_labels_use_quarter_hour_time_labels() -> None:
    for code, curve_key in [
        ("contract_spot_exposure_v1", "contract_use_curve"),
        ("retail_da_spot_bidding_v1", "spot_buy_curve"),
    ]:
        _template, _params, formatted = _solve_template(code)

        assert formatted["chart"]["labels"][0] == "00:00"
        assert formatted["chart"]["labels"][-1] == "23:45"
        assert formatted["business_output"][curve_key][0]["time_label"] == "00:00"
        assert formatted["business_output"][curve_key][-1]["time_label"] == "23:45"


def test_retail_da_default_terminal_soc_and_no_load_cut() -> None:
    template, params, formatted = _solve_template("retail_da_spot_bidding_v1")
    output = formatted["business_output"]
    checks = output["constraint_check"]

    assert template["problem_type"] == "MILP"
    assert output["total_load_cut"] <= 1e-5
    assert formatted["metrics"]["terminal_soc_gap"] <= 1e-5
    assert checks["terminal_soc_satisfied"] is True
    assert checks["load_shift_energy_balanced"] is True
    assert checks["charge_discharge_exclusive"] is True
    assert checks["soc_within_bounds"] is True
    assert formatted["metrics"]["soc_min_actual"] > params["storage_soc_min"] + 1e-5


def test_retail_da_constraint_check_is_derived_from_result_metrics() -> None:
    _template, _params, formatted = _solve_template("retail_da_spot_bidding_v1")
    checks = formatted["business_output"]["constraint_check"]

    for key in [
        "shift_balance_gap",
        "soc_min_actual",
        "soc_max_actual",
        "charge_discharge_conflict_count",
        "terminal_soc_gap",
    ]:
        assert key in checks
        assert isinstance(checks[key], (int, float))
    assert checks["terminal_soc_satisfied"] == (checks["terminal_soc_gap"] <= 1e-5)


def test_component_builder_reports_chinese_error_for_parameter_length_mismatch() -> None:
    template = get_template("retail_da_spot_bidding_v1")
    params = deepcopy(template["sample_runtime_parameters"])
    params["spot_price_forecast"] = params["spot_price_forecast"][:-1]

    with pytest.raises(RuntimeError, match="参数 spot_price_forecast 长度不一致"):
        PyomoModelBuilder().build(template, params)
