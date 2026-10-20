"""Keep observed attempts without synthesizing history for old tasks."""
from copy import deepcopy


def archive_attempt(task, *, status=None, error=None):
    if any(row["attempt_id"] == task.attempt_id for row in task.attempt_history):
        return
    task.attempt_history.append({
        "attempt_id": task.attempt_id, "status": status or task.status,
        "created_at": task.created_at, "started_at": task.started_at, "finished_at": task.finished_at,
        "error": error if error is not None else task.error,
        "request": task.request.model_dump(mode="json"), "result": deepcopy(task.result),
        "trace": deepcopy(task.trace), "logs": list(task.logs), "run_metrics": deepcopy(task.run_metrics),
    })
