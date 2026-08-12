from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.storage.memory_store import STORE
from app.services.result_presentation import apply_result_presentation


class ResultService:
    def get_result(self, task_id: str) -> dict[str, Any]:
        with STORE.lock:
            task = STORE.tasks.get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        if task.status != "SUCCESS" and not task.result:
            raise HTTPException(status_code=409, detail=f"Task is not completed: {task.status}")
        return apply_result_presentation(task.result or {})

    def list_results(self) -> list[dict[str, Any]]:
        with STORE.lock:
            rows: list[tuple[str, dict[str, Any]]] = []
            for job_id, stored in sorted(STORE.results.items(), key=lambda item: item[0], reverse=True):
                summary = stored.get("summary") if isinstance(stored, dict) else None
                payload = stored.get("result") if isinstance(stored, dict) else None
                if not isinstance(payload, dict):
                    payload = stored if isinstance(stored, dict) else {}
                status = payload.get("status")
                if not status and isinstance(summary, dict):
                    status = summary.get("status")
                if status and status != "SUCCESS":
                    continue
                row = dict(summary) if isinstance(summary, dict) else {}
                for key in ("objective_value", "model_id", "model_code", "status", "finished_at"):
                    value = payload.get(key)
                    if value is not None:
                        row[key] = value
                finished_at = payload.get("finished_at") or row.get("finished_at") or ""
                rows.append((str(finished_at), {"job_id": job_id, "task_id": job_id, **row}))
            rows.sort(key=lambda item: (item[0], item[1]["job_id"]), reverse=True)
            return [row for _, row in rows]

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
