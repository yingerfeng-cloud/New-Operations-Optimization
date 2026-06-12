from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_pv_storage_intraday_rolling_runs_three_rounds() -> None:
    response = client.post(
        "/api/pv-storage/dispatch/intraday/rolling-run",
        json={
            "template_code": "pv_storage_day_ahead_dispatch_v2",
            "rolling_horizon": 4,
            "execution_step": 1,
            "rounds": 3,
            "current_soc": 20,
        },
    )
    body = response.json()

    assert response.status_code == 200, response.text
    assert body["status"] == "SUCCESS"
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
    created = client.post("/api/pv-storage/dispatch/intraday/rolling-run", json={"rounds": 1}).json()
    history = client.get(f"/api/pv-storage/dispatch/intraday/{created['rolling_job_id']}/history")

    assert history.status_code == 200, history.text
    assert len(history.json()) == 1
