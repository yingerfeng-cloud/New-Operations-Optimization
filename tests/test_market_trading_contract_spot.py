from __future__ import annotations

from copy import deepcopy

import pytest

from app.builders.pyomo_builder import PyomoModelBuilder
from app.explain.result_formatter import SolveResultFormatter
from app.services.model_service import model_service
from app.solvers.highs_adapter import HiGHSAdapter
from app.templates.power_templates import get_template


def _short_contract_sample() -> dict:
    return {
        "horizon": 4,
        "time": [0, 1, 2, 3],
        "time_labels": ["00:00", "00:15", "00:30", "00:45"],
        "delta_t": 0.25,
        "load_forecast": [100, 120, 90, 110],
        "contract_total": 320,
        "contract_price": 360,
        "spot_price_forecast": [420, 520, 310, 460],
        "max_exposure_ratio": [0.4, 0.4, 0.4, 0.4],
        "deviation_penalty": [80, 120, 60, 100],
    }


def _solve(overrides: dict | None = None):
    model_service.seed_default_templates()
    template = get_template("contract_spot_exposure_v1")
    params = _short_contract_sample()
    params.update(overrides or {})
    model, context = PyomoModelBuilder().build(template, params)
    result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    assert result.status == "optimal", result
    formatted = SolveResultFormatter().format("contract_spot_exposure_v1", result, context)
    return template, params, context, result, formatted


def test_contract_spot_exposure_template_sample_solves() -> None:
    template, _params, _context, result, formatted = _solve()

    assert template["problem_type"] == "LP"
    assert template["solver"] == "HiGHS"
    assert result.objective_value is not None
    output = formatted["business_output"]
    assert output["contract_use_curve"]
    assert output["spot_exposure_curve"]
    assert output["spot_exposure_ratio_curve"]
    assert output["execution_policy"] == "advisory_only"
    assert output["requires_human_review"] is True
    assert output["constraint_check"]["contract_total_satisfied"] is True
    assert output["constraint_check"]["spot_exposure_within_limit"] is True


def test_contract_spot_exposure_outputs_required_business_fields() -> None:
    *_rest, formatted = _solve()
    output = formatted["business_output"]

    for key in [
        "contract_use_curve",
        "spot_exposure_curve",
        "spot_exposure_ratio_curve",
        "total_contract_cost",
        "total_spot_expected_cost",
        "total_risk_penalty",
        "total_expected_cost",
        "high_risk_periods",
        "strategy_explanation",
    ]:
        assert key in output
    assert any("不自动下单" in item for item in output["approval_items"])


def test_contract_spot_exposure_objective_changes_with_risk_penalty() -> None:
    *_low_rest, low = _solve({"deviation_penalty": [10, 10, 10, 10]})
    *_high_rest, high = _solve({"deviation_penalty": [500, 500, 500, 500]})

    assert low["metrics"]["objective_value"] != high["metrics"]["objective_value"]


def test_contract_spot_exposure_precheck_reports_business_error() -> None:
    template = get_template("contract_spot_exposure_v1")
    params = _short_contract_sample()
    params["contract_total"] = 100

    with pytest.raises(RuntimeError, match="中长期合约总电量低于现货暴露上限约束要求的最低合约电量"):
        PyomoModelBuilder().build(template, params)


def test_contract_spot_invoke_surfaces_precheck_business_error(client) -> None:
    model_service.seed_default_templates()
    params = get_template("contract_spot_exposure_v1")["sample_runtime_parameters"]
    response = client.post(
        "/api/models/MODEL-POWER-CONTRACT-SPOT-EXPOSURE-V1/invoke",
        json={"parameters": {"contract_total": 100, "time": params["time"], "time_labels": params["time_labels"]}},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    expected = "中长期合约总电量低于现货暴露上限约束要求"
    assert body["status"] in {"FAILED", "INFEASIBLE"}
    assert expected in body["error"]["message"]
    assert "{'message':" not in body["error"]["message"]
    assert expected in str(body["warnings"])
    assert "{'message':" not in str(body["warnings"])
    assert expected in str(body["explanation_structured"]["risk_notes"])
    assert "{'message':" not in str(body["explanation_structured"]["risk_notes"])


def test_contract_spot_precheck_unknown_variable_reports_chinese_error() -> None:
    template = get_template("contract_spot_exposure_v1")
    template["component_spec"] = deepcopy(template["component_spec"])
    template["component_spec"]["precheck_config"] = {
        "checks": [
            {
                "key": "bad_variable_name",
                "expression": "missing_contract_total <= sum(load_forecast[t] for t in time)",
            }
        ]
    }

    with pytest.raises(RuntimeError, match="预校验表达式引用了不存在的变量：missing_contract_total"):
        PyomoModelBuilder().build(template, _short_contract_sample())
