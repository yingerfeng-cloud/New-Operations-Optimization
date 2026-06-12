from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from typing import Any

from app.semantic.semantic_validator import RuntimeParameterValidator
from app.services.rolling_service import RollingRunRequest, RollingService
from app.templates.power_templates import get_template


def test_app_compileall_acceptance() -> None:
    result = subprocess.run([sys.executable, "-m", "compileall", "-q", "app"], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_v2_runtime_parameter_validation_rejects_bad_closing_params() -> None:
    template = get_template("pv_storage_day_ahead_dispatch_v2")
    params = dict(template["sample_runtime_parameters"])
    params["deviation_limit"] = [0.5]
    params["soc_max"] = params["soc_min"]

    errors = RuntimeParameterValidator().validate(template, params)

    assert errors
    text = " ".join(error["error"] for error in errors)
    assert "deviation_limit" in text or "soc_max" in text


def test_rolling_service_reports_partial_success_and_soc_handoff(monkeypatch) -> None:
    @dataclass
    class Task:
        id: str
        status: str

    class JobStub:
        calls = 0

        def create_task(self, request: Any) -> Task:
            self.calls += 1
            return Task(id=f"TASK-{self.calls}", status="SUCCESS" if self.calls == 1 else "FAILED")

        def get_task(self, task_id: str) -> Task:
            return Task(id=task_id, status="SUCCESS" if task_id == "TASK-1" else "FAILED")

    class ResultStub:
        def get_result(self, task_id: str) -> dict[str, Any]:
            if task_id == "TASK-1":
                return {
                    "status": "SUCCESS",
                    "business_output": {
                        "dispatch_plan": [{"time": 0, "p_ch": 1, "p_dis": 0, "p_grid": 10, "soc": 21}],
                        "variable_values": {"soc": {"soc[0]": 20, "soc[1]": 21}},
                    },
                    "metrics": {"market_revenue": 10},
                }
            return {"status": "FAILED", "business_output": {}, "metrics": {}}

    monkeypatch.setattr("app.services.rolling_service.job_service", JobStub())
    monkeypatch.setattr("app.services.rolling_service.result_service", ResultStub())

    result = RollingService().run(
        RollingRunRequest(
            model_template_code="pv_storage_day_ahead_dispatch_v2",
            horizon=2,
            step_size=1,
            rounds=2,
            runtime_parameters={"initial_soc": 20},
        )
    )

    assert result["status"] == "PARTIAL_SUCCESS"
    assert result["history_results"][0]["end_soc"] == 21
    assert result["history_results"][1]["initial_soc"] == 21
    assert result["history_results"][1]["status"] == "FAILED"
