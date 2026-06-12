from __future__ import annotations

from fastapi import APIRouter

from app.schemas.solve import SolveRequest, TaskView
from app.services.job_service import job_service

router = APIRouter(prefix="/api", tags=["tasks"])


@router.post("/tasks", response_model=TaskView)
def create_task(req: SolveRequest) -> TaskView:
    return job_service.create_task(req).view()


@router.get("/tasks", response_model=list[TaskView])
def list_tasks() -> list[TaskView]:
    return job_service.list_tasks()


@router.get("/tasks/{task_id}", response_model=TaskView)
def get_task(task_id: str) -> TaskView:
    return job_service.get_task(task_id).view()


@router.post("/tasks/{task_id}/cancel", response_model=TaskView)
def cancel_task(task_id: str) -> TaskView:
    return job_service.cancel_task(task_id)


@router.post("/tasks/{task_id}/retry", response_model=TaskView)
def retry_task(task_id: str) -> TaskView:
    return job_service.retry_task(task_id)
