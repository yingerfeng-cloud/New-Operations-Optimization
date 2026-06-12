from __future__ import annotations

from fastapi import APIRouter

from app.services.rolling_service import RollingRunRequest, rolling_service

router = APIRouter(prefix="/api/rolling", tags=["rolling"])


@router.post("/run")
def run_rolling(req: RollingRunRequest) -> dict:
    return rolling_service.run(req)


@router.get("/{rolling_job_id}")
def get_rolling(rolling_job_id: str) -> dict:
    return rolling_service.get(rolling_job_id)


@router.get("/{rolling_job_id}/history")
def get_rolling_history(rolling_job_id: str) -> list[dict]:
    return rolling_service.history(rolling_job_id)
