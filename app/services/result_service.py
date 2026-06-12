from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.storage.memory_store import STORE


class ResultService:
    def get_result(self, task_id: str) -> dict[str, Any]:
        with STORE.lock:
            task = STORE.tasks.get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        if task.status != "SUCCESS" and not task.result:
            raise HTTPException(status_code=409, detail=f"Task is not completed: {task.status}")
        return task.result or {}

    def list_results(self) -> list[dict[str, Any]]:
        with STORE.lock:
            return [{"job_id": job_id, **result.get("summary", {})} for job_id, result in sorted(STORE.results.items(), key=lambda item: item[0], reverse=True)]

    def trace(self, task_id: str) -> dict[str, Any]:
        task = self._task(task_id)
        return task.trace

    def logs(self, task_id: str) -> list[str]:
        task = self._task(task_id)
        return task.logs

    def metrics(self, task_id: str) -> dict[str, Any]:
        task = self._task(task_id)
        return task.run_metrics

    def _task(self, task_id: str):
        with STORE.lock:
            task = STORE.tasks.get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        return task


result_service = ResultService()
