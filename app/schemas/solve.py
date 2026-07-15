from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.utils import now_text


TaskStatus = Literal[
    "PENDING",
    "QUEUED",
    "RUNNING",
    "VALIDATING",
    "BUILDING_MODEL",
    "SOLVING",
    "FORMATTING_RESULT",
    "SUCCESS",
    "FAILED",
    "INFEASIBLE",
    "TIMEOUT",
    "CANCELLED",
    "INTERRUPTED",
]


class SolveRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    scene: str = "power optimization"
    model: str = "unit commitment day-ahead"
    model_code: str | None = None
    model_id: str | None = None
    horizon: int | None = None
    interval_minutes: int | None = None
    solver: str = "HiGHS"
    mode: str = "business_semantic"
    mip_gap: float = 0.001
    time_limit_seconds: int = 300
    thread_num: int | None = None
    presolve: bool = True
    async_run: bool = True
    max_retries: int = 0
    objective_config: dict[str, Any] = Field(default_factory=dict)
    constraint_config: dict[str, Any] = Field(default_factory=dict)
    runtime_parameters: dict[str, Any] = Field(default_factory=dict)
    solver_config: dict[str, Any] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)


class TaskView(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    id: str
    model_id: str | None = None
    resolved_model_id: str | None = None
    resolved_model_code: str | None = None
    resolution_warning: str | None = None
    scene: str
    model: str
    solver: str
    status: TaskStatus
    progress: int
    gap: str
    cost: float
    risk: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    duration_seconds: float | None = None
    retry_count: int = 0
    error: str | None = None
    recent_logs: list[str] = Field(default_factory=list)
    trace: dict[str, Any] = Field(default_factory=dict)


@dataclass
class TaskRecord:
    id: str
    request: SolveRequest
    status: TaskStatus = "PENDING"
    progress: int = 5
    gap: str = "-"
    cost: float = 0.0
    risk: str = "low"
    created_at: str = field(default_factory=now_text)
    started_at: str | None = None
    finished_at: str | None = None
    duration_seconds: float | None = None
    retry_count: int = 0
    max_retries: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    trace: dict[str, Any] = field(default_factory=dict)
    logs: list[str] = field(default_factory=list)
    run_metrics: dict[str, Any] = field(default_factory=dict)

    def view(self) -> TaskView:
        return TaskView(
            id=self.id,
            model_id=self.request.model_id,
            resolved_model_id=self.request.model_id,
            resolved_model_code=(self.request.payload or {}).get("resolved_model_code") or self.request.model_code,
            resolution_warning=(self.request.payload or {}).get("resolution_warning"),
            scene=self.request.scene,
            model=self.request.model,
            solver=self.request.solver,
            status=self.status,
            progress=self.progress,
            gap=self.gap,
            cost=round(float(self.cost), 2),
            risk=self.risk,
            created_at=self.created_at,
            started_at=self.started_at,
            finished_at=self.finished_at,
            duration_seconds=self.duration_seconds,
            retry_count=self.retry_count,
            error=self.error,
            recent_logs=self.logs[-5:],
            trace=dict(self.trace),
        )


class TaskRecordState(BaseModel):
    id: str
    request: SolveRequest
    status: TaskStatus = "PENDING"
    progress: int = 5
    gap: str = "-"
    cost: float = 0.0
    risk: str = "low"
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    duration_seconds: float | None = None
    retry_count: int = 0
    max_retries: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    trace: dict[str, Any] = Field(default_factory=dict)
    logs: list[str] = Field(default_factory=list)
    run_metrics: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_record(cls, record: TaskRecord) -> "TaskRecordState":
        return cls(**{name: getattr(record, name) for name in cls.model_fields})

    def to_record(self) -> TaskRecord:
        data = self.model_dump()
        data["request"] = self.request
        return TaskRecord(**data)
