from __future__ import annotations

from app.builders.pyomo_builder import PyomoModelBuilder
from app.explain.result_formatter import SolveResultFormatter
from app.services.model_service import model_service
from app.solvers.highs_adapter import HiGHSAdapter
from app.templates.power_templates import get_template


def _short_da_bidding_sample() -> dict:
    return {
        "horizon": 4,
        "time": [0, 1, 2, 3],
        "time_volume": [0, 1, 2, 3, 4],
        "time_labels": ["00:00", "00:15", "00:30", "00:45"],
        "delta_t": 0.25,
        "load_forecast": [100, 125, 95, 115],
        "spot_price_forecast": [260, 520, 360, 610],
        "contract_energy": [70, 75, 65, 70],
        "contract_price": [360, 360, 360, 360],
        "bid_min": [0, 0, 0, 0],
        "bid_max": [80, 80, 70, 80],
        "deviation_penalty": [500, 700, 450, 650],
        "storage_capacity": 80,
        "storage_soc_init": 35,
        "storage_soc_min": 10,
        "storage_soc_max": 70,
        "terminal_soc_target": 35,
        "terminal_soc_penalty": 1000,
        "charge_max": 25,
        "discharge_max": 25,
        "charge_efficiency": 0.95,
        "discharge_efficiency": 0.92,
        "storage_cycle_cost": 8,
        "flex_up": [16, 8, 8, 10],
        "flex_down": [6, 14, 8, 16],
        "cut_limit": [0, 0, 0, 0],
        "shift_cost": [8, 12, 10, 14],
        "cut_cost": [1000, 1000, 1000, 1000],
    }


def _solve(overrides: dict | None = None):
    model_service.seed_default_templates()
    template = get_template("retail_da_spot_bidding_v1")
    params = _short_da_bidding_sample()
    params.update(overrides or {})
    model, context = PyomoModelBuilder().build(template, params)
    result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    assert result.status == "optimal", result
    formatted = SolveResultFormatter().format("retail_da_spot_bidding_v1", result, context)
    return template, params, context, result, formatted


def test_retail_da_spot_bidding_template_sample_solves() -> None:
    template, _params, _context, result, formatted = _solve()

    assert template["problem_type"] == "MILP"
    assert template["solver"] == "HiGHS"
    assert result.objective_value is not None
    output = formatted["business_output"]
    assert output["spot_buy_curve"]
    assert output["contract_energy_curve"]
    assert output["load_forecast_curve"]
    assert output["adjusted_load_curve"]
    assert output["soc_curve"]
    assert output["execution_policy"] == "advisory_only"
    assert output["requires_human_review"] is True


def test_retail_da_spot_bidding_outputs_required_business_fields() -> None:
    *_rest, formatted = _solve()
    output = formatted["business_output"]

    for key in [
        "spot_buy_curve",
        "contract_energy_curve",
        "load_forecast_curve",
        "adjusted_load_curve",
        "charge_curve",
        "discharge_curve",
        "soc_curve",
        "load_shift_out_curve",
        "load_shift_in_curve",
        "load_cut_curve",
        "deviation_short_curve",
        "deviation_long_curve",
        "total_expected_cost",
        "contract_cost",
        "spot_purchase_cost",
        "storage_cycle_cost_total",
        "flex_load_cost",
        "cut_load_cost",
        "deviation_risk_cost",
        "high_price_periods",
        "high_exposure_periods",
        "risk_summary",
        "strategy_explanation",
    ]:
        assert key in output
    assert output["day_ahead_bid_advice"]
    assert output["cost_breakdown"]["total_expected_cost"] == output["total_expected_cost"]
    assert "trade_api_endpoint" not in output
    assert "order_endpoint" not in output


def test_retail_da_spot_bidding_respects_flex_and_shift_balance() -> None:
    _template, params, _context, _result, formatted = _solve()
    output = formatted["business_output"]
    by_time = {row["time"]: row for row in formatted["series"]}

    for index, time_label in enumerate(params["time"]):
        row = by_time[time_label]
        assert row["load_shift_out"] <= params["flex_down"][index] + 1e-6
        assert row["load_shift_in"] <= params["flex_up"][index] + 1e-6
        assert row["load_cut"] <= params["cut_limit"][index] + 1e-6
    assert output["constraint_check"]["load_shift_energy_balanced"] is True
    assert output["constraint_check"]["charge_discharge_exclusive"] is True


def test_retail_da_spot_bidding_objective_changes_with_spot_price() -> None:
    *_low_rest, low = _solve({"spot_price_forecast": [100, 100, 100, 100]})
    *_high_rest, high = _solve({"spot_price_forecast": [700, 700, 700, 700]})

    assert low["metrics"]["objective_value"] != high["metrics"]["objective_value"]
