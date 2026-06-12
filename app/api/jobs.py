from __future__ import annotations

from fastapi import APIRouter

from app.services.result_service import result_service

router = APIRouter(prefix="/api/jobs", tags=["job-monitoring"])


@router.get("/{job_id}/trace")
def get_job_trace(job_id: str) -> dict:
    return result_service.trace(job_id)


@router.get("/{job_id}/logs")
def get_job_logs(job_id: str) -> list[str]:
    return result_service.logs(job_id)


@router.get("/{job_id}/metrics")
def get_job_metrics(job_id: str) -> dict:
    return result_service.metrics(job_id)
