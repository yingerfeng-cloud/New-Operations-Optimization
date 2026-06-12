from __future__ import annotations

from copy import deepcopy
from typing import Any


class ForecastMockService:
    """Small deterministic forecast provider for demo and agent workflows."""

    def get_forecast_inputs(self, scenario: str, *, horizon: int | None = None, use_sample_data: bool = True) -> dict[str, Any]:
        if scenario == "storage_dispatch":
            return self._storage_dispatch(horizon or 4)
        if scenario == "unit_commitment_day_ahead":
            return self._unit_commitment(horizon or 4)
        if scenario in {"储能", "储能优化", "峰谷套利"}:
            return self._storage_dispatch(horizon or 4)
        if scenario in {"机组组合", "日前机组组合", "启停计划"}:
            return self._unit_commitment(horizon or 4)
        return {}

    def infer_scenario(self, scenario: str | None, business_goal: str | None) -> str:
        if scenario in {"storage_dispatch", "unit_commitment_day_ahead", "economic_dispatch", "renewable_storage_dispatch", "chp_dispatch"}:
            return scenario
        text = f"{scenario or ''} {business_goal or ''}".lower()
        if any(token in text for token in ["storage", "soc", "储能", "充放电", "峰谷", "套利", "电价"]):
            return "storage_dispatch"
        if any(token in text for token in ["unit", "commitment", "机组", "启停", "日前", "备用", "出力"]):
            return "unit_commitment_day_ahead"
        return scenario or "storage_dispatch"

    def _storage_dispatch(self, horizon: int) -> dict[str, Any]:
        base = {
            "storage": ["B1"],
            "horizon": 4,
            "electricity_price": [220, 180, 520, 610],
            "load_forecast": [86, 78, 118, 132],
            "renewable_forecast": [28, 35, 22, 12],
            "storage_capacity": {"B1": 120},
            "soc_min": {"B1": 10},
            "charge_power_max": {"B1": 40},
            "discharge_power_max": {"B1": 40},
            "charge_efficiency": {"B1": 0.94},
            "discharge_efficiency": {"B1": 0.92},
            "initial_soc": {"B1": 50},
        }
        return self._resize(base, horizon, ["electricity_price", "load_forecast", "renewable_forecast"])

    def _unit_commitment(self, horizon: int) -> dict[str, Any]:
        base = {
            "unit": ["U1", "U2", "U3"],
            "horizon": 4,
            "load_forecast": [120, 180, 210, 160],
            "renewable_forecast": [20, 30, 40, 20],
            "initial_unit_status": {"U1": 1, "U2": 0, "U3": 0},
            "initial_unit_output": {"U1": 80, "U2": 0, "U3": 0},
            "unit_min_output": {"U1": 50, "U2": 30, "U3": 20},
            "unit_max_output": {"U1": 180, "U2": 120, "U3": 80},
            "fuel_cost": {"U1": 280, "U2": 330, "U3": 420},
            "startup_cost": {"U1": 6000, "U2": 3500, "U3": 1500},
            "ramp_up_limit": {"U1": 80, "U2": 60, "U3": 40},
            "ramp_down_limit": {"U1": 80, "U2": 60, "U3": 40},
            "reserve_ratio": 0.1,
        }
        return self._resize(base, horizon, ["load_forecast", "renewable_forecast"])

    def _resize(self, base: dict[str, Any], horizon: int, keys: list[str]) -> dict[str, Any]:
        data = deepcopy(base)
        data["horizon"] = horizon
        for key in keys:
            values = list(data[key])
            if horizon <= len(values):
                data[key] = values[:horizon]
                continue
            while len(values) < horizon:
                values.append(values[-1])
            data[key] = values
        return data


forecast_mock_service = ForecastMockService()
