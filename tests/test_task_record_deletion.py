from fastapi import HTTPException
import pytest

from app.schemas.solve import SolveRequest, TaskRecord
from app.services.job_service import job_service
from app.storage.memory_store import STORE


@pytest.fixture(autouse=True)
def isolate_task_records(monkeypatch: pytest.MonkeyPatch):
    task_ids = {"OPT-DELETE-DONE", "OPT-DELETE-RUNNING"}
    monkeypatch.setattr(STORE, "save_runtime", lambda: None)
    yield
    with STORE.lock:
        for task_id in task_ids:
            STORE.tasks.pop(task_id, None)
            STORE.results.pop(task_id, None)


def test_delete_terminal_task_removes_task_and_result() -> None:
    task_id = "OPT-DELETE-DONE"
    with STORE.lock:
        STORE.tasks[task_id] = TaskRecord(id=task_id, request=SolveRequest(), status="SUCCESS")
        STORE.results[task_id] = {"task_id": task_id, "objective_value": 1}

    job_service.delete_task(task_id)

    assert task_id not in STORE.tasks
    assert task_id not in STORE.results


def test_delete_running_task_requires_cancellation_first() -> None:
    task_id = "OPT-DELETE-RUNNING"
    with STORE.lock:
        STORE.tasks[task_id] = TaskRecord(id=task_id, request=SolveRequest(), status="RUNNING")

    with pytest.raises(HTTPException) as error:
        job_service.delete_task(task_id)

    assert error.value.status_code == 409
    assert task_id in STORE.tasks
