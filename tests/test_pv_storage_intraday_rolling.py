from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.templates.power_templates import get_template
from app.storage.memory_store import STORE

client = TestClient(app)
TRIAL_MODEL_ID = "MODEL-POWER-PV-STORAGE-DAY-AHEAD-DISPATCH-V2"


def forecasts():
    sample = get_template("pv_storage_day_ahead_dispatch_v2")["sample_runtime_parameters"]
    data = {key: value + value[-2:] for key, value in sample.items() if isinstance(value, list) and key not in {"time", "time_volume"}}
    data["pv_forecast"] = [10, 20, 30, 40, 50, 60]
    return data


def test_pv_storage_intraday_rolling_runs_three_rounds() -> None:
    response = client.post(
        "/api/pv-storage/dispatch/intraday/rolling-run",
        json={
            "template_code": "pv_storage_day_ahead_dispatch_v2",
            "model_id": "MODEL-POWER-PV-STORAGE-DAY-AHEAD-DISPATCH-V2",
            "rolling_horizon": 4,
            "execution_step": 1,
            "rounds": 3,
            "current_soc": 20,
            "runtime_parameters": forecasts(),
        },
    )
    body = response.json()

    assert response.status_code == 200, response.text
    assert body["status"] == "SUCCESS", body
    assert len(body["history_results"]) == 3
    assert body["history"] == body["history_results"]
    first = body["history_results"][0]
    second = body["history_results"][1]
    assert first["status"] == "SUCCESS"
    assert len(first["executed_steps"]) == 1
    assert first["next_instruction"]["target_soc"] == first["end_soc"]
    assert "SOC" in first["next_instruction"]["reason"]
    assert "Execute" not in first["next_instruction"]["reason"]
    assert first["execute_steps"] == [0]
    assert second["initial_soc"] == first["final_soc"]


def test_pv_storage_intraday_history_can_be_queried() -> None:
    created = client.post("/api/pv-storage/dispatch/intraday/rolling-run", json={"rounds": 1, "model_id": "MODEL-POWER-PV-STORAGE-DAY-AHEAD-DISPATCH-V2"}).json()
    history = client.get(f"/api/pv-storage/dispatch/intraday/{created['rolling_job_id']}/history")

    assert history.status_code == 200, history.text
    assert len(history.json()) == 1


def test_windows_advance_and_pin_model_and_carry_soc():
    data = forecasts()
    response = client.post("/api/pv-storage/dispatch/intraday/rolling-run", json={"model_id": TRIAL_MODEL_ID, "rolling_horizon": 4, "rounds": 3, "runtime_parameters": data})
    assert response.status_code == 200, response.text
    rows = response.json()["history_results"]
    assert [row["status"] for row in rows] == ["SUCCESS"] * 3
    for index, row in enumerate(rows):
        assert row["model_id"] == TRIAL_MODEL_ID
        assert row["task_id"] == row["job_id"]
        assert row["task_id"]
        assert row["failure_reason"] is None
        task = STORE.tasks[row["task_id"]]
        assert task.request.model_id == TRIAL_MODEL_ID
        assert task.request.parameters["pv_forecast"] == data["pv_forecast"][index:index + 4]
        if index: assert row["initial_soc"] == rows[index - 1]["end_soc"]


def test_insufficient_forecasts_fail_without_reusing_previous_window():
    response = client.post("/api/pv-storage/dispatch/intraday/rolling-run", json={"model_id": TRIAL_MODEL_ID, "rolling_horizon": 4, "rounds": 3})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PARTIAL_SUCCESS"
    assert body["history_results"][0]["status"] == "SUCCESS"
    for row in body["history_results"][1:]:
        assert row["model_id"] == TRIAL_MODEL_ID
        assert row["task_id"] is None
        assert row["failure_reason"]["details"]["code"] == "INSUFFICIENT_FORECAST_DATA"
        assert row["executed_steps"] == []
        assert row["next_instruction"] is None


def test_trial_rolling_requires_explicit_id():
    response = client.post("/api/pv-storage/dispatch/intraday/rolling-run", json={"template_code": "pv_storage_day_ahead_dispatch_v2", "rounds": 1})
    assert response.status_code == 409, response.text


def test_published_rolling_routes_by_code_to_the_published_version():
    from tests.test_helpers import test_and_publish_model

    code = 'pv_storage_day_ahead_dispatch_v2'
    cloned = client.post(f'/api/templates/{code}/clone')
    assert cloned.status_code == 200, cloned.text
    model_id = cloned.json()['id']
    published = test_and_publish_model(client, model_id, get_template(code)['sample_runtime_parameters'])
    assert published.status_code == 200, published.text
    response = client.post('/api/pv-storage/dispatch/intraday/rolling-run', json={'template_code': code, 'rolling_horizon': 4, 'rounds': 1})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['status'] == 'SUCCESS', body
    assert body['model_id'] == model_id
    assert body['history_results'][0]['model_id'] == model_id
    assert STORE.models[TRIAL_MODEL_ID].status == 'trial'
