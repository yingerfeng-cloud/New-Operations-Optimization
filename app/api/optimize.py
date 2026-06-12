from __future__ import annotations

from fastapi import APIRouter

from app.schemas.solve import SolveRequest, TaskView
from app.services.job_service import job_service
from app.services.result_service import result_service

router = APIRouter(prefix="/api/optimize", tags=["optimize"])


@router.post("/run", response_model=TaskView)
def optimize_run(req: SolveRequest) -> TaskView:
    return job_service.create_task(req).view()


@router.get("/jobs", response_model=list[TaskView])
def list_optimize_jobs() -> list[TaskView]:
    return job_service.list_tasks()


@router.get("/jobs/{job_id}", response_model=TaskView)
def get_optimize_job(job_id: str) -> TaskView:
    return job_service.get_task(job_id).view()


@router.get("/result/{job_id}")
def optimize_result(job_id: str) -> dict:
    return result_service.get_result(job_id)
