from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent.skill_router import agent_skill_router
from app.agent_skill_registry import agent_skill_registry
from app.main import app
from app.utils import has_highspy, has_pyomo


client = TestClient(app)


def test_agent_skill_registry_loads_skill_directories() -> None:
    skills = client.get("/api/agent/agent-skills").json()
    names = {item["name"] for item in skills}
    assert {"economic_dispatch", "unit_commitment_day_ahead", "storage_dispatch", "renewable_storage_dispatch", "chp_dispatch"} <= names


def test_agent_skill_requires_skill_md() -> None:
    validation = agent_skill_registry.validate_skill("economic_dispatch")
    assert validation["status"] == "valid"
    assert Path("agent_skills/economic_dispatch/SKILL.md").exists()


def test_agent_skill_binds_existing_api_skill() -> None:
    detail = client.get("/api/agent/agent-skills/economic_dispatch").json()
    assert detail["canonical_api_skill_name"] == "run_economic_dispatch"
    assert detail["api_skill_available"] is True


def test_agent_skill_parameter_example_compatibility_route_reuses_agent_skill_service() -> None:
    response = client.get("/api/agent/skills/run_cascade_hydro_dispatch/parameter-example")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["agent_skill_name"] == "cascade_hydro_dispatch"
    assert body["sample_parameters"]["horizon"] == 4
    assert "availability" in body["sample_parameters"]
    dims = {item["key"]: item["dimension"] for item in body["required_parameters"] + body["optional_parameters"]}
    assert dims["availability"] == ["unit", "time"]
    assert dims["local_inflow"] == ["station", "time"]


def test_agent_skill_schema_sync_from_api_skill() -> None:
    detail = client.post("/api/agent/agent-skills/economic_dispatch/sync-schema").json()
    assert detail["input_schema"]
    assert {item["key"] for item in detail["input_schema"]} >= {"load_forecast", "unit_max_output", "fuel_cost"}


def test_agent_skill_parameter_example_does_not_invoke() -> None:
    cid = "CONV-AGENT-SKILL-EXAMPLE"
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "请给我经济调度参数示例"})
    body = res.json()
    assert body["response_type"] == "parameter_example"
    assert body["agent_skill_name"] == "economic_dispatch"
    assert body["api_skill_name"] == "run_economic_dispatch"
    assert body["ready_to_invoke"] is False
    assert body["parameter_draft"] == {}


def test_agent_skill_router_does_not_default_to_economic_dispatch() -> None:
    route = agent_skill_router.route("请给我个参数示例", {}, client.get("/api/agent/agent-skills").json())
    assert route["intent"] == "parameter_example"
    assert route["agent_skill_name"] is None
    assert route["should_invoke"] is False


def test_agent_skill_router_preserves_current_skill_for_help_intent() -> None:
    skills = client.get("/api/agent/agent-skills").json()
    route = agent_skill_router.route("请给我个参数示例", {"agent_skill_name": "unit_commitment_day_ahead", "resolved_skill_name": "run_unit_commitment_day_ahead"}, skills)
    assert route["intent"] == "parameter_example"
    assert route["agent_skill_name"] == "unit_commitment_day_ahead"
    assert route["api_skill_name"] == "run_unit_commitment_day_ahead"


def test_agent_skill_switch_requires_explicit_user_intent() -> None:
    skills = client.get("/api/agent/agent-skills").json()
    current = {"agent_skill_name": "unit_commitment_day_ahead", "resolved_skill_name": "run_unit_commitment_day_ahead", "parameter_draft": {"horizon": 4}}
    unchanged = agent_skill_router.route("给我参数示例", current, skills)
    assert unchanged["agent_skill_name"] == "unit_commitment_day_ahead"
    switched = agent_skill_router.route("切换到储能调度", current, skills)
    assert switched["intent"] == "switch_skill"
    assert switched["agent_skill_name"] == "storage_dispatch"


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_economic_dispatch_agent_skill_full_flow() -> None:
    cid = "CONV-AGENT-SKILL-FLOW"
    first = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30"},
    ).json()
    assert first["agent_skill_name"] == "economic_dispatch"
    assert first["workflow_state"] == "DEFAULT_CONFIRMING"
    confirmed = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "确认使用默认值", "confirm_defaults": True}).json()
    assert confirmed["workflow_state"] == "READY_TO_INVOKE"
    invoked = client.post("/api/agent/confirm-invoke", json={"conversation_id": cid}).json()
    assert invoked["status"] == "SUCCESS"
    explained = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "解释结果"}).json()
    assert explained["response_type"] == "result_explanation"


def test_agent_skill_adapter_builds_api_request() -> None:
    path = Path("agent_skills/economic_dispatch/adapter.py")
    spec = importlib.util.spec_from_file_location("economic_dispatch_adapter_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.build_api_request({"load_forecast": [100], "unit_max_output": {"U1": 100}, "fuel_cost": {"U1": 10}}, {})
    assert result["ok"] is True
    assert result["api_skill_name"] == "run_economic_dispatch"


def test_agent_skill_validation_detects_missing_required_parameter() -> None:
    result = client.post("/api/agent/agent-skills/economic_dispatch/dry-run", json={"parameter_draft": {"load_forecast": [100]}}).json()
    assert result["ok"] is False
    assert set(result["missing_parameters"]) == {"unit_max_output", "fuel_cost"}
