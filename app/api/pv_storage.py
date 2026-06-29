from __future__ import annotations

import uuid
from copy import deepcopy
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.builders.pyomo_builder import PyomoModelBuilder
from app.explain.result_formatter import SolveResultFormatter
from app.services.rolling_service import RollingRunRequest, rolling_service
from app.services.model_service import model_service
from app.templates.power_templates import get_template
from app.solvers.solver_router import SolverRouteError, solver_router

router = APIRouter(prefix="/api/pv-storage", tags=["pv-storage"])


class IntradayRollingRequest(BaseModel):
    template_code: str = "pv_storage_day_ahead_dispatch_v2"
    rolling_horizon: int = 4
    execution_step: int = 1
    rounds: int = 3
    current_soc: float = 20
    time_step_hours: float = 1
    forecast_series: dict[str, Any] = Field(default_factory=dict)
    price_series: dict[str, Any] = Field(default_factory=dict)
    schedule_series: dict[str, Any] = Field(default_factory=dict)
    grid_limit_series: dict[str, Any] = Field(default_factory=dict)
    deviation_limit_series: dict[str, Any] = Field(default_factory=dict)
    storage_parameters: dict[str, Any] = Field(default_factory=dict)
    runtime_parameters: dict[str, Any] = Field(default_factory=dict)


class SizingScheme(BaseModel):
    name: str
    storage_power_capacity: float
    storage_energy_capacity: float


class SizingCompareLiteRequest(BaseModel):
    candidate_schemes: list[SizingScheme]
    scenario_runtime_parameters: dict[str, Any] = Field(default_factory=dict)
    capex_power: float = 0
    capex_energy: float = 0
    opex_rate: float = 0.02
    annualization_days: int = 365


@router.post("/dispatch/intraday/rolling-run")
def run_intraday_rolling(req: IntradayRollingRequest) -> dict[str, Any]:
    model_service.seed_default_templates()
    runtime = _rolling_runtime(req)
    result = rolling_service.run(
        RollingRunRequest(
            model_template_code=req.template_code,
            horizon=req.rolling_horizon,
            step_size=req.execution_step,
            rounds=req.rounds,
            runtime_parameters=runtime,
        )
    )
    result["entrypoint"] = "pv_storage_intraday_rolling"
    return result


@router.get("/dispatch/intraday/{rolling_job_id}")
def get_intraday_rolling(rolling_job_id: str) -> dict[str, Any]:
    return rolling_service.get(rolling_job_id)


@router.get("/dispatch/intraday/{rolling_job_id}/history")
def get_intraday_rolling_history(rolling_job_id: str) -> list[dict[str, Any]]:
    return rolling_service.history(rolling_job_id)


@router.post("/sizing/compare-lite")
def sizing_compare_lite(req: SizingCompareLiteRequest) -> dict[str, Any]:
    if len(req.candidate_schemes) < 1:
        raise HTTPException(status_code=422, detail="candidate_schemes is required")
    model_service.seed_default_templates()
    template = get_template("pv_storage_day_ahead_dispatch_v2")
    rows = []
    for scheme in req.candidate_schemes:
        runtime = {
            **deepcopy(template.get("sample_runtime_parameters", {})),
            **deepcopy(req.scenario_runtime_parameters),
            "storage_power_capacity": scheme.storage_power_capacity,
            "storage_energy_capacity": scheme.storage_energy_capacity,
            "capex_power": req.capex_power,
            "capex_energy": req.capex_energy,
        }
        soc_upper = scheme.storage_energy_capacity * float(runtime.get("soc_max", 1) or 1)
        original_initial_soc = float(runtime.get("initial_soc", 0) or 0)
        original_terminal_soc_target = float(runtime.get("terminal_soc_target", 0) or 0)
        adjusted_initial_soc = min(original_initial_soc, soc_upper)
        adjusted_terminal_soc_target = min(original_terminal_soc_target, soc_upper)
        runtime["initial_soc"] = adjusted_initial_soc
        runtime["terminal_soc_target"] = adjusted_terminal_soc_target
        soc_adjusted = adjusted_initial_soc != original_initial_soc or adjusted_terminal_soc_target != original_terminal_soc_target
        soc_adjustment = {
            "soc_adjusted": soc_adjusted,
            "original_initial_soc": original_initial_soc,
            "adjusted_initial_soc": adjusted_initial_soc,
            "original_terminal_soc_target": original_terminal_soc_target,
            "adjusted_terminal_soc_target": adjusted_terminal_soc_target,
        }
        try:
            model, context = PyomoModelBuilder().build(template, runtime)
            problem_type = str(template.get("model_problem_type") or template.get("problem_type") or "LP")
            solve_result = solver_router.solve(model, problem_type=problem_type, time_limit_seconds=30)
            if solve_result.status != "optimal":
                reason = solve_result.message or "当前候选方案不可行，请检查 SOC、容量、功率和计划约束。"
                rows.append({"name": scheme.name, "status": solve_result.status, "feasible": False, "reason": reason, **soc_adjustment})
                continue
            formatted = SolveResultFormatter().format("pv_storage_day_ahead_dispatch_v2", solve_result, context)
            metrics = formatted.get("metrics", {})
            daily_market_revenue = float(metrics.get("market_revenue", 0) or 0)
            daily_deviation_penalty_cost = float(metrics.get("deviation_penalty_cost", 0) or 0)
            daily_storage_degradation_cost = float(metrics.get("storage_degradation_cost", 0) or 0)
            investment_cost = req.capex_power * scheme.storage_power_capacity + req.capex_energy * scheme.storage_energy_capacity
            annual_market_revenue = daily_market_revenue * req.annualization_days
            annual_deviation_penalty_cost = daily_deviation_penalty_cost * req.annualization_days
            annual_storage_degradation_cost = daily_storage_degradation_cost * req.annualization_days
            annualized_investment_cost = investment_cost
            annual_opex_cost = investment_cost * req.opex_rate
            annual_net_benefit = (
                annual_market_revenue
                - annual_deviation_penalty_cost
                - annual_storage_degradation_cost
                - annualized_investment_cost
                - annual_opex_cost
            )
            payback_years = investment_cost / max(annual_net_benefit, 0) if annual_net_benefit > 0 and investment_cost else None
            rows.append(
                {
                    "scheme_name": scheme.name,
                    "name": scheme.name,
                    "status": "SUCCESS",
                    "feasible": True,
                    "storage_power_capacity": scheme.storage_power_capacity,
                    "storage_energy_capacity": scheme.storage_energy_capacity,
                    "daily_market_revenue": round(daily_market_revenue, 6),
                    "daily_deviation_penalty_cost": round(daily_deviation_penalty_cost, 6),
                    "daily_storage_degradation_cost": round(daily_storage_degradation_cost, 6),
                    "annual_market_revenue": round(annual_market_revenue, 6),
                    "annual_deviation_penalty_cost": round(annual_deviation_penalty_cost, 6),
                    "annual_storage_degradation_cost": round(annual_storage_degradation_cost, 6),
                    "annualized_investment_cost": round(annualized_investment_cost, 6),
                    "annual_opex_cost": round(annual_opex_cost, 6),
                    "annual_cost": round(annualized_investment_cost + annual_opex_cost, 6),
                    "annual_net_benefit": round(annual_net_benefit, 6),
                    "payback_years": round(payback_years, 6) if payback_years is not None else None,
                    "metrics": metrics,
                    **soc_adjustment,
                }
            )
        except SolverRouteError as exc:
            rows.append({"name": scheme.name, "status": exc.payload.get("status", "solver_unavailable"), "feasible": False, "reason": exc.payload.get("message"), "solver_error": exc.payload, **soc_adjustment})
        except Exception as exc:
            reason = str(exc)
            if original_initial_soc > soc_upper or original_terminal_soc_target > soc_upper:
                reason = "初始 SOC 或期末 SOC 目标超过当前候选储能容量上限，已尝试按 SOC 上限自动修正后仍不可行。"
            rows.append({"name": scheme.name, "status": "FAILED", "feasible": False, "reason": reason, **soc_adjustment})
    feasible = [row for row in rows if row.get("feasible")]
    recommended = max(feasible, key=lambda row: row.get("annual_net_benefit", float("-inf")), default=None)
    status = "SUCCESS" if len(feasible) == len(rows) else ("PARTIAL_SUCCESS" if feasible else "FAILED")
    message = "所有候选方案均不可行" if status == "FAILED" else ""
    return {"comparison_id": f"SIZING-{uuid.uuid4().hex[:10].upper()}", "status": status, "message": message, "schemes": rows, "recommended_scheme": recommended}


def _rolling_runtime(req: IntradayRollingRequest) -> dict[str, Any]:
    runtime = {**req.runtime_parameters, **req.storage_parameters}
    runtime["initial_soc"] = req.current_soc
    runtime["delta_t"] = req.time_step_hours
    mapping = {
        "pv_forecast": req.forecast_series,
        "price": req.price_series,
        "schedule": req.schedule_series,
        "grid_limit": req.grid_limit_series,
        "deviation_limit": req.deviation_limit_series,
    }
    for key, value in mapping.items():
        if value:
            runtime[key] = value.get(key) or value.get("values") or value
    return runtime
