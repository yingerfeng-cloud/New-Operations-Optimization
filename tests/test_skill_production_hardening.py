from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent.conversation_store import conversation_store
from app.main import app
from app.utils import has_highspy, has_pyomo


client = TestClient(app)
AGENT_SKILLS = [
    "economic_dispatch",
    "unit_commitment_day_ahead",
    "storage_dispatch",
    "renewable_storage_dispatch",
    "chp_dispatch",
    "cascade_hydro_dispatch",
]


def test_skill_run_rejects_empty_parameters_in_production_mode() -> None:
    for skill_name in ["run_economic_dispatch", "run_storage_dispatch", "run_unit_commitment_day_ahead"]:
        response = client.post(f"/api/skills/{skill_name}/run", json={"parameters": {}})
        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert detail["status"] == "PARAMETER_INVALID"
        assert detail["missing_required"]


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_skill_run_allows_sample_only_when_use_sample_data_true() -> None:
    response = client.post(
        "/api/skills/run_economic_dispatch/run",
        json={"parameters": {}, "options": {"use_sample_data": True, "mode": "sync", "explain": True}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SUCCESS"


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_agent_confirm_invoke_passes_confirmed_parameters() -> None:
    cid = "CONV-CONFIRMED-PARAMETERS"
    first = client.post(
        "/api/agent/analyze",
        json={
            "conversation_id": cid,
            "message": "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30",
        },
    )
    assert first.status_code == 200, first.text
    confirmed = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "确认使用默认值", "confirm_defaults": True})
    assert confirmed.status_code == 200, confirmed.text
    invoked = client.post("/api/agent/confirm-invoke", json={"conversation_id": cid})
    assert invoked.status_code == 200, invoked.text
    body = invoked.json()
    assert body["status"] == "SUCCESS"
    with_defaults = body["result"]["parameter_summary"] if "parameter_summary" in body["result"] else None
    conversation = client.get(f"/api/agent/conversations/{cid}").json()
    assert {"unit_min_output", "ramp_up_limit", "ramp_down_limit"} <= set(conversation["parameter_draft"])
    assert with_defaults is None or "unit_min_output" in with_defaults


def test_agent_skill_packages_all_have_adapter_and_tests() -> None:
    for name in AGENT_SKILLS:
        root = Path("agent_skills") / name
        assert (root / "adapter.py").exists()
        assert (root / "prompts" / "parameter_collection.md").exists()
        assert (root / "prompts" / "default_confirmation.md").exists()
        assert (root / "prompts" / "result_explanation.md").exists()
        assert (root / "prompts" / "error_handling.md").exists()
        assert (root / "tests" / "sample_input.json").exists()
        assert (root / "tests" / "missing_parameters.json").exists()
        assert (root / "tests" / "expected_request.json").exists()
        assert json.loads((root / "input_schema.json").read_text(encoding="utf-8"))
        assert json.loads((root / "output_schema.json").read_text(encoding="utf-8"))


def test_agent_skill_dry_run_request() -> None:
    sample = json.loads(Path("agent_skills/storage_dispatch/tests/sample_input.json").read_text(encoding="utf-8"))
    response = client.post("/api/agent/agent-skills/storage_dispatch/dry-run-request", json={"parameters": sample})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["api_skill_name"] == "run_storage_dispatch"
    assert body["request"]["parameters"]["electricity_price"]


def test_agent_skill_dry_run_dialog() -> None:
    response = client.post(
        "/api/agent/agent-skills/economic_dispatch/dry-run-dialog",
        json={"message": "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["intent"] == "optimization_request"
    assert {"load_forecast", "unit_max_output", "fuel_cost"} <= set(body["extracted_parameters"])
    assert body["requires_default_confirmation"] is True
    assert "request_preview" in body


def test_api_skill_description_is_business_chinese() -> None:
    skill = client.get("/api/skills/run_economic_dispatch").json()
    assert "经济调度优化能力" in skill["description"]
    assert "Call published optimization model" not in skill["description"]
    assert "Agent only collects" not in skill["description"]


def test_default_policy_user_required_not_auto_confirmed() -> None:
    analyzed = client.post("/api/skills/run_storage_dispatch/analyze-input", json={"partial_parameters": {}}).json()
    missing = {item["key"] for item in analyzed["missing_required"]}
    defaults = {item["key"] for item in analyzed["can_use_default"]}
    assert {"electricity_price", "storage_capacity", "charge_power_max", "discharge_power_max"} <= missing
    assert "electricity_price" not in defaults


def test_storage_dispatch_requires_user_business_inputs() -> None:
    response = client.post("/api/agent/analyze", json={"conversation_id": "CONV-STORAGE-REQUIRES-INPUT", "message": "帮我跑储能调度"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ready_to_invoke"] is False
    missing = {item["key"] for item in body["missing_required"]}
    assert {"electricity_price", "storage_capacity", "charge_power_max", "discharge_power_max"} <= missing


def _seed_switch_conversation(cid: str) -> dict:
    conversation_store.upsert(
        cid,
        {
            "agent_skill_name": "economic_dispatch",
            "resolved_skill_name": "run_economic_dispatch",
            "selected_skill": "run_economic_dispatch",
            "parameter_draft": {"load_forecast": [100, 120], "unit_max_output": {"U1": 100}, "fuel_cost": {"U1": 10}},
            "parameter_sources": {"load_forecast": "user_provided", "unit_max_output": "user_provided", "fuel_cost": "user_provided"},
            "status": "PARAM_COLLECTING",
            "messages": [],
        },
    )
    switched = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "切换到储能调度"})
    assert switched.status_code == 200, switched.text
    assert switched.json()["response_type"] == "switch_skill_confirmation"
    return switched.json()


def test_confirm_switch_clear() -> None:
    cid = "CONV-SWITCH-CLEAR"
    _seed_switch_conversation(cid)
    response = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "确认清空"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["intent"] == "confirm_switch_clear"
    assert body["resolved_skill_name"] == "run_storage_dispatch"
    assert body["parameter_draft"] == {}
    assert client.get(f"/api/agent/conversations/{cid}").json().get("pending_switch") is None


def test_cancel_switch() -> None:
    cid = "CONV-SWITCH-CANCEL"
    _seed_switch_conversation(cid)
    response = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "取消切换"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["intent"] == "cancel_switch"
    detail = client.get(f"/api/agent/conversations/{cid}").json()
    assert detail["resolved_skill_name"] == "run_economic_dispatch"
    assert detail["parameter_draft"]["load_forecast"] == [100, 120]
    assert detail.get("pending_switch") is None


def test_switch_migrate_only_compatible_parameters() -> None:
    cid = "CONV-SWITCH-MIGRATE"
    _seed_switch_conversation(cid)
    response = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "迁移参数"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["intent"] == "confirm_switch_migrate"
    assert body["resolved_skill_name"] == "run_storage_dispatch"
    assert "load_forecast" not in body["parameter_draft"]
    assert set(body["dropped_parameters"]) >= {"load_forecast", "unit_max_output", "fuel_cost"}
