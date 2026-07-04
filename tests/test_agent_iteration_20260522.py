from __future__ import annotations

import uuid
from fastapi.testclient import TestClient

from app.main import app
from app.services.agent_skill_service import agent_skill_service


client = TestClient(app)


def _cid(name: str) -> str:
    return f"CONV-{name}-{uuid.uuid4().hex[:8].upper()}"


def test_how_to_use_returns_step_guide() -> None:
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("HOWTO"), "message": "我该怎么用呢"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["response_type"] == "how_to_use"
    text = body["agent_message"]
    for word in ["选择场景", "提供参数", "确认默认值", "确认调用", "查看结果"]:
        assert word in text


def test_required_parameters_without_current_skill() -> None:
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("REQ-ALL"), "message": "我需要提供哪些参数"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["response_type"] in {"skill_selection_required", "required_parameters_overview"}
    text = body["agent_message"]
    for name in ["经济调度", "日前机组组合", "储能调度", "梯级水电调度"]:
        assert name in text


def test_required_parameters_with_current_skill() -> None:
    cid = _cid("REQ-UC")
    first = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我跑日前机组组合"})
    assert first.status_code == 200, first.text
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "我需要提供哪些参数"})
    body = res.json()
    assert body["response_type"] == "required_parameters"
    assert body["agent_skill_name"] == "unit_commitment_day_ahead"
    assert body["api_skill_name"].startswith("run_unit_commitment_day_ahead")
    assert body["required_parameters"]


def test_cascade_hydro_station_keyword() -> None:
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("HYDRO"), "message": "帮我做梯级电站调度"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["intent"] == "optimization_request"
    assert body["agent_skill_name"] == "cascade_hydro_dispatch"
    assert body["api_skill_name"].startswith("run_cascade_hydro_dispatch")
    assert body["ready_to_invoke"] is False


def test_cascade_hydro_availability_query() -> None:
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("HYDRO-AVAIL"), "message": "没有梯级电站调度模型吗"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["response_type"] == "skill_availability"
    assert body["intent"] == "skill_availability_query"
    assert body["agent_skill_name"] == "cascade_hydro_dispatch"
    assert body["api_skill_name"] == "run_cascade_hydro_dispatch"
    assert body["skill_available"] is True
    assert "有的" in body["agent_message"]


def test_cascade_hydro_mojibake_removed() -> None:
    skill = agent_skill_service.get_skill("cascade_hydro_dispatch")
    bad = ["鐢", "璋", "搴", "鍖", "绯"]
    names = [str(item.get("name") or "") for item in skill["input_schema"]]
    assert "电站清单" in names
    assert "区间来水过程" in names
    assert "目标函数权重" in names
    for name in names:
        assert not any(token in name for token in bad), name


def test_missing_required_has_priority_over_default_confirmation() -> None:
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("STORAGE"), "message": "帮我做储能调度"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["missing_required"]
    assert body["workflow_state"] == "PARAM_COLLECTING"
    assert body["workflow_state"] != "DEFAULT_CONFIRMING"
    assert body["ready_to_invoke"] is False


def test_dynamic_skill_list_display_names() -> None:
    names = [item["display_name"] for item in agent_skill_service.list_skills()]
    for expected in ["经济调度", "日前机组组合", "储能调度", "风光储协同", "电热协同", "梯级水电调度"]:
        assert expected in names
    assert all("Agent Skill" not in name for name in names)
