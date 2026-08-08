from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _cid(label: str) -> str:
    return f"CONV-RUN-{label}-{uuid.uuid4().hex[:8].upper()}"


def test_analyze_creates_restorable_run_with_events() -> None:
    cid = _cid("RESTORE")
    response = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我做储能调度"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["run_id"].startswith("RUN-")
    assert body["run"]["conversation_id"] == cid
    assert body["run"]["status"] in {"PARAMETER_REVIEW", "APPROVAL_REQUIRED", "READY"}
    assert body["run"]["events"]

    detail = client.get(f"/api/agent/conversations/{cid}")
    assert detail.status_code == 200, detail.text
    restored = detail.json()
    assert restored["active_run"]["run_id"] == body["run_id"]
    assert restored["runs"][0]["parameter_draft"] == body["run"]["parameter_draft"]

    events = client.get(f"/api/agent/runs/{body['run_id']}/events")
    assert events.status_code == 200, events.text
    assert [event["sequence"] for event in events.json()] == sorted(event["sequence"] for event in events.json())


def test_confirm_invoke_is_idempotent_per_run() -> None:
    cid = _cid("IDEMPOTENT")
    sample = {
        "electricity_price": [220, 180, 520, 610],
        "storage_capacity": {"B1": 120},
        "charge_power_max": {"B1": 40},
        "discharge_power_max": {"B1": 40},
        "charge_efficiency": {"B1": 0.94},
        "discharge_efficiency": {"B1": 0.92},
        "initial_soc": {"B1": 50},
    }
    prepared = client.post(
        "/api/agent/apply-sample-parameters",
        json={"conversation_id": cid, "agent_skill_name": "storage_dispatch", "sample_parameters": sample},
    )
    assert prepared.status_code == 200, prepared.text
    run_id = prepared.json()["run_id"]
    payload = {"conversation_id": cid, "run_id": run_id, "idempotency_key": f"invoke:{run_id}"}

    first = client.post("/api/agent/confirm-invoke", json=payload)
    assert first.status_code == 200, first.text
    second = client.post("/api/agent/confirm-invoke", json=payload)
    assert second.status_code == 200, second.text
    assert second.json()["idempotent_replay"] is True
    assert second.json()["invocation_id"] == first.json()["invocation_id"]
    assert second.json()["run"]["status"] == "SUCCEEDED"


def test_delete_conversation_cascades_to_agent_runs() -> None:
    cid = _cid("DELETE")
    analyzed = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我做储能调度"})
    assert analyzed.status_code == 200, analyzed.text
    run_id = analyzed.json()["run_id"]

    deleted = client.delete(f"/api/agent/conversations/{cid}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted_run_count"] == 1
    assert client.get(f"/api/agent/conversations/{cid}").status_code == 404
    assert client.get(f"/api/agent/runs/{run_id}").status_code == 404
