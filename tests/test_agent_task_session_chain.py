from __future__ import annotations

import uuid
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _cid(name: str) -> str:
    return f"CONV-{name}-{uuid.uuid4().hex[:8].upper()}"


def test_parameter_example_does_not_modify_task_session() -> None:
    cid = _cid("EXAMPLE-NO-TASK")
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "给我储能调度参数示例"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["response_type"] == "parameter_example"
    assert body["agent_skill_name"] == "storage_dispatch"
    assert body["applied_to_task"] is False
    assert body["task_session"] is None
    conv = client.get(f"/api/agent/conversations/{cid}").json()
    assert not conv.get("parameter_draft")
    assert not conv.get("missing_required")


def test_apply_sample_parameters_updates_task_session() -> None:
    cid = _cid("APPLY-SAMPLE")
    sample = {
        "electricity_price": [220, 180, 520, 610],
        "storage_capacity": {"B1": 120},
        "charge_power_max": {"B1": 40},
        "discharge_power_max": {"B1": 40},
        "charge_efficiency": {"B1": 0.94},
        "discharge_efficiency": {"B1": 0.92},
        "initial_soc": {"B1": 50},
    }
    res = client.post(
        "/api/agent/apply-sample-parameters",
        json={"conversation_id": cid, "agent_skill_name": "storage_dispatch", "sample_parameters": sample},
    )
    assert res.status_code == 200, res.text
    task = res.json()["task_session"]
    assert task["parameter_draft"] == sample
    assert set(task["parameter_sources"].values()) == {"sample_only"}
    assert task["workflow_state"] == "READY_TO_INVOKE"
    assert task["ready_to_invoke"] is True


def test_storage_json_parameter_supplement() -> None:
    cid = _cid("STORAGE-JSON")
    first = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我做储能调度"})
    assert first.status_code == 200, first.text
    msg = """参数是 {
      "electricity_price": [220,180,520,610],
      "storage_capacity": {"B1":120},
      "charge_power_max": {"B1":40},
      "discharge_power_max": {"B1":40}
    }"""
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": msg})
    assert res.status_code == 200, res.text
    task = res.json()["task_session"]
    draft = task["parameter_draft"]
    assert draft["electricity_price"] == [220, 180, 520, 610]
    assert draft["storage_capacity"] == {"B1": 120}
    assert draft["charge_power_max"] == {"B1": 40}
    assert draft["discharge_power_max"] == {"B1": 40}
    assert task["workflow_state"] == "DEFAULT_CONFIRMING"


def test_storage_natural_language_parameter_supplement() -> None:
    cid = _cid("STORAGE-NL")
    first = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我做储能调度"})
    assert first.status_code == 200, first.text
    msg = "电价 220 180 520 610，储能容量B1 120，最大充电功率40，最大放电功率40"
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": msg})
    assert res.status_code == 200, res.text
    task = res.json()["task_session"]
    draft = task["parameter_draft"]
    assert draft["electricity_price"] == [220, 180, 520, 610]
    assert draft["storage_capacity"] == {"B1": 120}
    assert draft["charge_power_max"] == {"B1": 40}
    assert draft["discharge_power_max"] == {"B1": 40}
    assert task["workflow_state"] == "DEFAULT_CONFIRMING"


def test_confirm_defaults_rejects_when_missing_required() -> None:
    cid = _cid("DEFAULT-REJECT")
    first = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我做储能调度"})
    assert first.status_code == 200, first.text
    res = client.post("/api/agent/confirm-defaults", json={"conversation_id": cid, "task_session_id": first.json()["task_session"]["task_session_id"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "PARAMETER_INCOMPLETE"
    assert body["task_session"]["workflow_state"] == "PARAM_COLLECTING"


def test_ready_to_invoke_only_after_missing_empty_and_defaults_confirmed() -> None:
    cid = _cid("READY-AFTER-DEFAULTS")
    client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我做储能调度"})
    msg = "电价 220 180 520 610，储能容量B1 120，最大充电功率40，最大放电功率40"
    collecting = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": msg}).json()
    assert collecting["task_session"]["workflow_state"] == "DEFAULT_CONFIRMING"
    assert collecting["task_session"]["ready_to_invoke"] is False
    confirmed = client.post("/api/agent/confirm-defaults", json={"conversation_id": cid, "task_session_id": collecting["task_session"]["task_session_id"]}).json()
    assert confirmed["task_session"]["workflow_state"] == "READY_TO_INVOKE"
    assert confirmed["task_session"]["ready_to_invoke"] is True
