from __future__ import annotations

import time
from typing import Any

from pydantic import BaseModel

from app.schemas.solve import SolveRequest
from app.services.forecast_mock_service import forecast_mock_service
from app.services.job_service import job_service
from app.services.result_service import result_service
from app.services.template_service import template_library


class DemoRunRequest(BaseModel):
    scenario: str
    use_sample_data: bool = True
    business_goal: str = ""


class DemoService:
    def run(self, req: DemoRunRequest) -> dict[str, Any]:
        scenario = forecast_mock_service.infer_scenario(req.scenario, req.business_goal)
        template = template_library.get_template(scenario)
        forecast_inputs = forecast_mock_service.get_forecast_inputs(scenario, use_sample_data=req.use_sample_data)
        runtime = {**template.get("sample_runtime_parameters", {}), **forecast_inputs}
        task = job_service.create_task(SolveRequest(model_code=scenario, horizon=runtime.get("horizon"), parameters=runtime, async_run=False))
        current = self._wait(task.id)
        solve_result = result_service.get_result(task.id)
        explanation = solve_result.get("business_explanation", {})
        summary = explanation.get("summary") if isinstance(explanation, dict) else str(explanation)
        warnings = self._warnings(scenario, solve_result)
        return {
            "scenario": scenario,
            "business_goal": req.business_goal,
            "forecast_inputs": forecast_inputs,
            "solve_result": solve_result,
            "business_summary": summary,
            "suggested_actions": self._suggested_actions(scenario, solve_result),
            "warnings": warnings,
            "job_status": current.status,
        }

    def _wait(self, task_id: str):
        for _ in range(600):
            current = job_service.get_task(task_id)
            if current.status in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
                return current
            time.sleep(0.2)
        return job_service.get_task(task_id)

    def _suggested_actions(self, scenario: str, result: dict[str, Any]) -> list[str]:
        if scenario == "storage_dispatch":
            return ["执行首时段储能计划", "持续滚动更新SOC和电价预测", "收益低于阈值时保持待机"]
        if scenario == "unit_commitment_day_ahead":
            return ["提交机组启停计划给调度复核", "关注备用裕度低的时段", "接入最新预测后滚动重算"]
        return ["复核优化结果", "进入下一轮滚动优化"]

    def _warnings(self, scenario: str, result: dict[str, Any]) -> list[str]:
        if result.get("diagnosis"):
            return [item.get("message", "") for item in result["diagnosis"]]
        output = result.get("business_output", {})
        if scenario == "storage_dispatch":
            checks = output.get("constraint_check", {})
            warnings = []
            if checks.get("soc_hits_lower_bound"):
                warnings.append("SOC触及下限，需避免连续高价放电后可用电量不足。")
            if checks.get("charge_discharge_conflict"):
                warnings.append("存在充放电互斥冲突，请复核模型结果。")
            return warnings
        if scenario == "unit_commitment_day_ahead":
            tight = [row for row in output.get("reserve_margin", []) if row.get("reserve_slack", 0) <= 10]
            return ["备用裕度接近下限，建议调度员重点复核。"] if tight else []
        return []


demo_service = DemoService()
