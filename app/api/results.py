from __future__ import annotations

from fastapi import APIRouter

from app.services.result_service import result_service

router = APIRouter(prefix="/api", tags=["results"])


@router.get("/tasks/{task_id}/result")
def get_task_result(task_id: str) -> dict:
    return result_service.get_result(task_id)


@router.get("/results")
def list_results() -> list[dict]:
    return result_service.list_results()
