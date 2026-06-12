from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_pv_storage_sizing_compare_lite_returns_recommendation() -> None:
    response = client.post(
        "/api/pv-storage/sizing/compare-lite",
        json={
            "candidate_schemes": [
                {"name": "2MW/4MWh", "storage_power_capacity": 2, "storage_energy_capacity": 4},
                {"name": "4MW/8MWh", "storage_power_capacity": 4, "storage_energy_capacity": 8},
                {"name": "6MW/12MWh", "storage_power_capacity": 6, "storage_energy_capacity": 12},
            ],
            "scenario_runtime_parameters": {
                "deviation_penalty_price": 3,
                "degradation_cost_yuan_per_mwh": 5,
            },
            "capex_power": 100,
            "capex_energy": 50,
            "opex_rate": 0.1,
            "annualization_days": 10,
        },
    )
    body = response.json()

    assert response.status_code == 200, response.text
    assert body["status"] == "SUCCESS"
    assert len(body["schemes"]) == 3
    assert body["recommended_scheme"]
    scheme = body["recommended_scheme"]
    assert scheme["scheme_name"]
    expected = (
        scheme["annual_market_revenue"]
        - scheme["annual_deviation_penalty_cost"]
        - scheme["annual_storage_degradation_cost"]
        - scheme["annualized_investment_cost"]
        - scheme["annual_opex_cost"]
    )
    assert scheme["annual_net_benefit"] == pytest.approx(expected)
    assert "daily_storage_degradation_cost" in scheme
    assert "soc_adjusted" in scheme
    assert "adjusted_initial_soc" in scheme


def test_pv_storage_sizing_compare_lite_adjusts_small_capacity_soc() -> None:
    response = client.post(
        "/api/pv-storage/sizing/compare-lite",
        json={
            "candidate_schemes": [
                {"name": "2MW/4MWh", "storage_power_capacity": 2, "storage_energy_capacity": 4},
                {"name": "4MW/8MWh", "storage_power_capacity": 4, "storage_energy_capacity": 8},
                {"name": "20MW/40MWh", "storage_power_capacity": 20, "storage_energy_capacity": 40},
            ],
            "annualization_days": 10,
        },
    )
    body = response.json()

    assert response.status_code == 200, response.text
    assert body["status"] in {"SUCCESS", "PARTIAL_SUCCESS"}
    assert body["recommended_scheme"]
    assert any(row["soc_adjusted"] for row in body["schemes"])
