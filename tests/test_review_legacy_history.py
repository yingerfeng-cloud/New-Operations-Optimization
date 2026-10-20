from copy import deepcopy

from app.storage.memory_store import STORE
from tests.test_helpers import test_and_publish_model
from tests.test_review_execution_contracts import _curve_model
from app.templates.power_templates import get_template


def test_unrecoverable_published_history_is_not_filled_during_copy(client):
    _, model_id = _curve_model(client)
    test_and_publish_model(client, model_id, {"horizon": 1})
    with STORE.lock:
        old = STORE.models[model_id].model_copy(update={"function_dependencies": {}})
        STORE.models[model_id] = old
        STORE.save_runtime()
    before = old.model_dump()
    count = len(STORE.models)
    for path in ("copy", "versions"):
        response = client.post(f"/api/models/{model_id}/{path}", json={})
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "MODEL_DEPENDENCIES_UNPINNED"
    assert STORE.models[model_id].model_dump() == before
    assert len(STORE.models) == count


def test_old_result_without_prepared_definition_cannot_start_a_fake_replay(client):
    response = client.post("/api/tasks", json={"model_code": "economic_dispatch", "parameters": deepcopy(get_template("economic_dispatch")["sample_runtime_parameters"])})
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["status"] == "SUCCESS", task
    original = STORE.tasks[task["id"]]
    result = deepcopy(original.result)
    original.request.payload = {"horizon": 1}
    count = len(STORE.tasks)
    response = client.post(f"/api/tasks/{task['id']}/replay")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "TASK_HISTORY_UNREPLAYABLE"
    assert STORE.tasks[task["id"]].result == result
    assert len(STORE.tasks) == count
