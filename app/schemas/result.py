from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SolverRunResult(BaseModel):
    status: str
    objective_value: float | None = None
    solve_time: float = 0.0
    variable_values: dict[str, Any] = Field(default_factory=dict)
    solver_log: str = ""
    raw_termination_condition: str = ""


class SolveResult(BaseModel):
    job_id: str | None = None
    model_id: str | None = None
    status: str
    objective_value: float | None = None
    solve_time: float = 0.0
    variable_values: dict[str, Any] = Field(default_factory=dict)
    solver_log: str = ""
    metrics: dict[str, Any] = Field(default_factory=dict)
    series: list[dict[str, Any]] = Field(default_factory=list)
    chart: dict[str, Any] = Field(default_factory=dict)
    diagnosis: list[dict[str, Any]] = Field(default_factory=list)
    business_output: dict[str, Any] = Field(default_factory=dict)
    business_explanation: dict[str, Any] | str = Field(default_factory=dict)
