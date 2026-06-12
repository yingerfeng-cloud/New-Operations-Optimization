from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app.schemas.solve import SolveRequest
from app.services.job_service import job_service
from app.services.result_service import result_service
from app.services.template_service import template_library
from app.storage.memory_store import STORE


class RollingRunRequest(BaseModel):
    model_template_code: str
    horizon: int = 24
    step_size: int = 1
    rounds: int = 1
    runtime_parameters: dict[str, Any] = Field(default_factory=dict)


class RollingService:
    def run(self, req: RollingRunRequest) -> dict[str, Any]:
        template = template_library.get_template(req.model_template_code)
        rolling_id = f"ROLL-{uuid.uuid4().hex[:10].upper()}"
        job = {
            "rolling_job_id": rolling_id,
            "model_template_code": req.model_template_code,
            "horizon": req.horizon,
            "step_size": req.step_size,
            "current_round": 0,
            "status": "RUNNING",
            "history_results": [],
        }
        with STORE.lock:
            STORE.rolling_jobs[rolling_id] = job
        sample = {**template.get("sample_runtime_parameters", {}), **req.runtime_parameters, "horizon": req.horizon}
        current_soc = sample.get("initial_soc", sample.get("current_soc"))
        success_count = 0
        for round_index in range(req.rounds):
            window_start = round_index * req.step_size
            window_end = window_start + req.horizon
            runtime = self._window(sample, window_start, req.horizon)
            if current_soc is not None:
                runtime["initial_soc"] = current_soc
            result: dict[str, Any] = {}
            task_id = ""
            status = "FAILED"
            try:
                task = job_service.create_task(SolveRequest(model_code=req.model_template_code, horizon=req.horizon, parameters=runtime, async_run=False))
                task_id = task.id
                for _ in range(120):
                    current = job_service.get_task(task.id)
                    if current.status in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
                        break
                    time.sleep(0.1)
                result = result_service.get_result(task.id)
                status = str(result.get("status", current.status))
            except Exception as exc:
                result = {"status": "FAILED", "error": str(exc)}
            entry = {
                "round": round_index + 1,
                "job_id": task_id,
                "status": status,
                "window_start": window_start,
                "window_end": window_end,
                "execute_steps": list(range(window_start, window_start + req.step_size)),
                "executed_steps": self._executed_steps(result, runtime, req.step_size),
                "summary": result.get("business_explanation", {}).get("summary", "") if isinstance(result.get("business_explanation"), dict) else "",
                "metrics": result.get("metrics", {}),
                "initial_soc": current_soc,
            }
            next_soc = self._executed_soc(result, runtime, req.step_size, current_soc)
            entry["end_soc"] = next_soc
            entry["final_soc"] = next_soc
            entry["next_instruction"] = self._next_instruction(entry["executed_steps"], next_soc)
            if status == "SUCCESS":
                success_count += 1
                current_soc = next_soc
            job["history_results"].append(entry)
            job["current_round"] = round_index + 1
        if success_count == req.rounds:
            job["status"] = "SUCCESS"
        elif success_count > 0:
            job["status"] = "PARTIAL_SUCCESS"
        else:
            job["status"] = "FAILED"
        with STORE.lock:
            STORE.rolling_jobs[rolling_id] = job
        job["history"] = job["history_results"]
        return job

    def get(self, rolling_job_id: str) -> dict[str, Any]:
        with STORE.lock:
            job = STORE.rolling_jobs.get(rolling_job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Rolling job not found")
        return job

    def history(self, rolling_job_id: str) -> list[dict[str, Any]]:
        return self.get(rolling_job_id)["history_results"]

    def _window(self, params: dict[str, Any], start: int, horizon: int) -> dict[str, Any]:
        result = dict(params)
        for key, value in params.items():
            if isinstance(value, list) and len(value) >= start + horizon:
                result[key] = value[start : start + horizon]
        return result

    def _executed_steps(self, result: dict[str, Any], runtime: dict[str, Any], step_size: int) -> list[dict[str, Any]]:
        business = result.get("business_result") or result.get("business_output") or {}
        rows = business.get("dispatch_plan") or business.get("dispatch_series") or result.get("dispatch_plan") or []
        out = []
        for row in list(rows)[: max(step_size, 0)]:
            if not isinstance(row, dict):
                continue
            out.append(
                {
                    "time": row.get("time"),
                    "p_ch": float(row.get("p_ch", 0) or 0),
                    "p_dis": float(row.get("p_dis", 0) or 0),
                    "p_grid": float(row.get("p_grid", 0) or 0),
                    "soc": float(row.get("soc", runtime.get("initial_soc", 0)) or 0),
                    "deviation_penalty": float(row.get("deviation_penalty", 0) or 0),
                }
            )
        if out:
            return out
        times = runtime.get("time") or list(range(step_size))
        return [{"time": times[index] if index < len(times) else index, "p_ch": 0.0, "p_dis": 0.0, "p_grid": 0.0, "soc": float(runtime.get("initial_soc", 0) or 0), "deviation_penalty": 0.0} for index in range(max(step_size, 0))]

    def _next_instruction(self, executed_steps: list[dict[str, Any]], target_soc: Any) -> dict[str, Any]:
        first = executed_steps[0] if executed_steps else {}
        charge = float(first.get("p_ch", 0) or 0)
        discharge = float(first.get("p_dis", 0) or 0)
        if charge > 1e-6:
            reason = f"当前时段建议充电 {round(charge, 6)} MW，用于吸收光伏出力并降低计划偏差；执行后的 SOC 将作为下一轮初始 SOC。"
        elif discharge > 1e-6:
            reason = f"当前时段建议放电 {round(discharge, 6)} MW，用于支撑计划出力并提升上网收益；执行后的 SOC 将作为下一轮初始 SOC。"
        else:
            reason = "当前时段建议储能静置，维持 SOC 安全水平；执行后的 SOC 将作为下一轮滚动优化的初始 SOC。"
        return {
            "time": first.get("time"),
            "charge_power": charge,
            "discharge_power": discharge,
            "target_soc": float(target_soc or first.get("soc", 0) or 0),
            "grid_output": float(first.get("p_grid", 0) or 0),
            "reason": reason,
        }

    def _executed_soc(self, result: dict[str, Any], runtime: dict[str, Any], step_size: int, fallback: Any) -> Any:
        business = result.get("business_result") or result.get("business_output") or {}
        variable_values = business.get("variable_values") or result.get("variable_values") or {}
        soc_values = variable_values.get("soc") if isinstance(variable_values, dict) else {}
        if isinstance(soc_values, dict):
            time_volume = runtime.get("time_volume") or list(range(int(runtime.get("horizon", 0)) + 1))
            target_index = min(max(step_size, 0), max(len(time_volume) - 1, 0))
            if time_volume:
                label = f"soc[{time_volume[target_index]}]"
                if label in soc_values:
                    return float(soc_values[label] or 0)
        return fallback


rolling_service = RollingService()
