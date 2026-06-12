from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.agent.parameter_extractor import parameter_extractor
from app.agent.platform_client import OptimizationPlatformClient
from app.main import app
from app.storage.memory_store import STORE
from app.utils import has_highspy, has_pyomo
from tests.test_model_skill_invocation import minimal_dispatch_payload


client = TestClient(app)


def economic_input_schema() -> list[dict]:
    return [
        {
            "key": "load_forecast",
            "name": "负荷预测",
            "dimension": ["time"],
            "type": "dict",
            "sample_value": {"T1": 100, "T2": 120, "T3": 90},
            "sets": {"time": ["T1", "T2", "T3"]},
            "required": True,
        },
        {"key": "unit_max_output", "dimension": ["unit"], "type": "dict", "sample_value": {"U1": 80, "U2": 100}, "sets": {"unit": ["U1", "U2"]}, "required": True},
        {"key": "fuel_cost", "dimension": ["unit"], "type": "dict", "sample_value": {"U1": 10, "U2": 20}, "sets": {"unit": ["U1", "U2"]}, "required": True},
    ]


def test_parameter_extractor_chinese_economic_dispatch() -> None:
    message = "帮我跑一下 U1、U2 两台机组三个时段的经济调度，负荷是100、120、90，U1最大80成本10，U2最大100成本20。"
    params = parameter_extractor.extract(message, economic_input_schema())
    assert params["load_forecast"] == {"T1": 100, "T2": 120, "T3": 90}
    assert params["unit_max_output"] == {"U1": 80, "U2": 100}
    assert params["fuel_cost"] == {"U1": 10, "U2": 20}


def test_parameter_extractor_chinese_three_units() -> None:
    message = "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30。"
    schema = economic_input_schema()
    schema[0]["sample_value"] = {"T1": 0, "T2": 0, "T3": 0, "T4": 0}
    schema[1]["sample_value"] = {"U1": 0, "U2": 0, "U3": 0}
    schema[2]["sample_value"] = {"U1": 0, "U2": 0, "U3": 0}
    params = parameter_extractor.extract(message, schema)
    assert params["load_forecast"] == {"T1": 100, "T2": 120, "T3": 90, "T4": 110}
    assert params["unit_max_output"] == {"U1": 80, "U2": 100, "U3": 60}
    assert params["fuel_cost"] == {"U1": 10, "U2": 20, "U3": 30}


def test_agent_analyze_invalid_load_length_not_ready() -> None:
    payload = minimal_dispatch_payload()
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    model_id = created.json()["id"]
    assert client.post(f"/api/models/{model_id}/publish").status_code == 200
    skill = client.get("/api/skills/run_economic_dispatch").json()
    analyzed = client.post(
        f"/api/skills/{skill['canonical_skill_name']}/analyze-input",
        json={"partial_parameters": {"load_forecast": {"T1": 100, "T2": 120, "T3": 90, "T4": 1}, "fuel_cost": {"U1": 10, "U2": 20}, "unit_max_output": {"U1": 80, "U2": 100}}},
    )
    assert analyzed.status_code == 200, analyzed.text
    body = analyzed.json()
    assert body["ready"] is False
    assert any(item["key"] == "load_forecast" for item in body["invalid_parameters"])


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_agent_confirm_uses_resolved_skill_not_alias() -> None:
    payload = minimal_dispatch_payload()
    payload["id"] = f"MODEL-ALIAS-{uuid.uuid4().hex[:8].upper()}"
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    model_id = created.json()["id"]
    assert client.post(f"/api/models/{model_id}/publish").status_code == 200

    message = "帮我跑一下 U1、U2 两台机组三个时段的经济调度，负荷是100、120、90，U1最大80成本10，U2最大100成本20。"
    analyzed = client.post("/api/agent/analyze", json={"conversation_id": "CONV-ALIAS-FIX", "message": message, "skill_name": "run_economic_dispatch"})
    assert analyzed.status_code == 200, analyzed.text
    body = analyzed.json()
    assert body["resolved_skill_name"]
    assert body["model_id"]
    with STORE.lock:
        conversation = STORE.conversations["CONV-ALIAS-FIX"]
    assert conversation["resolved_skill_name"] == body["resolved_skill_name"]
    assert conversation["model_id"] == body["model_id"]

    invoked = client.post("/api/agent/confirm-invoke", json={"conversation_id": "CONV-ALIAS-FIX"})
    assert invoked.status_code == 200, invoked.text
    result = invoked.json()
    assert result["status"] == "SUCCESS"
    assert result["result"]["model_id"] == body["model_id"]
    with STORE.lock:
        conversation_after = STORE.conversations["CONV-ALIAS-FIX"]
    assert conversation_after["model_id"] == body["model_id"]


def test_platform_client_no_fallback_in_production(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK", "false")
    platform = OptimizationPlatformClient(base_url="http://127.0.0.1:1")
    with pytest.raises(HTTPException) as exc:
        platform.list_skills()
    assert exc.value.status_code == 503
