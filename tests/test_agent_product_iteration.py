from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.storage.memory_store import STORE
from app.utils import has_highspy, has_pyomo


client = TestClient(app)


def _reset_llm() -> None:
    with STORE.lock:
        STORE.llm_config.clear()


def test_llm_config_disabled_forces_enabled_false() -> None:
    _reset_llm()
    res = client.put("/api/llm/config", json={"provider": "disabled", "enabled": True, "model": "doubao-seed-1-6-251015", "api_key": "secret"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provider"] == "disabled"
    assert body["enabled"] is False
    assert body["api_key_configured"] is False
    assert body["model"] == ""


def test_llm_config_enabled_requires_provider_model_key(monkeypatch) -> None:
    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("ARK_API_KEY", "")
    monkeypatch.setenv("LLM_MODEL", "")
    monkeypatch.setenv("ARK_MODEL", "")
    _reset_llm()
    missing_key = client.put("/api/llm/config", json={"provider": "volcengine_ark", "enabled": True, "model": "doubao"})
    assert missing_key.status_code == 422
    missing_model = client.put("/api/llm/config", json={"provider": "openai_compatible", "enabled": True, "api_key": "secret"})
    assert missing_model.status_code == 422


def test_llm_config_api_key_configured_when_provider_enabled() -> None:
    _reset_llm()
    res = client.put("/api/llm/config", json={"provider": "volcengine_ark", "enabled": True, "model": "doubao", "api_key": "secret"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provider"] == "volcengine_ark"
    assert body["enabled"] is True
    assert body["api_key_configured"] is True
    assert "secret" not in res.text


def test_agent_chat_input_message_sent_correctly() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert 'id="chatInput"' in html
    assert "document.getElementById('chatInput')" in html
    assert "document.querySelector('.chat-main textarea')" not in html
    assert "state.lastRequest={apiBase:state.apiBase" in html
    assert "state.lastResponse={response_type:analysisResponse.response_type" in html


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_agent_economic_dispatch_from_console_flow() -> None:
    cid = f"CONV-CONSOLE-{uuid.uuid4().hex[:8].upper()}"
    message = "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30。"
    analyzed = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": message})
    assert analyzed.status_code == 200, analyzed.text
    body = analyzed.json()
    assert body["intent"] == "optimization_request"
    assert body["workflow_state"] == "DEFAULT_CONFIRMING"
    assert body["resolved_skill_name"].startswith("run_economic_dispatch")
    confirmed = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "确认使用默认值", "confirm_defaults": True})
    assert confirmed.json()["workflow_state"] == "READY_TO_INVOKE"
    invoked = client.post("/api/agent/confirm-invoke", json={"conversation_id": cid})
    assert invoked.status_code == 200, invoked.text
    assert float(invoked.json()["result"]["objective_value"]) == pytest.approx(5900.0)


def test_agent_analysis_not_overwritten_by_generic_reply() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert "analysisSummaryText(state.analysis)" in html
    assert "系统未识别为优化任务，请检查请求消息是否正确发送。" in html
    assert "response_type=analysis" not in html


def test_skill_info_modal_contains_structured_sections() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    for text in ["Skill 概览", "调用入口", "输入参数结构", "输出结构", "高级信息"]:
        assert text in html
    assert "复制 curl 示例" in html
    assert "在 Agent 中调试" in html
    assert "原始 JSON" in html


def test_skill_schema_can_be_viewed() -> None:
    res = client.get("/api/agent/skills/run_economic_dispatch")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["input_schema"]
    assert body["output_schema"]
    assert body["canonical_skill_name"]
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert "input_schema JSON" in html
    assert "output_schema JSON" in html


def test_one_published_model_version_generates_one_skill() -> None:
    models = [m for m in client.get("/api/models").json() if m["status"] in {"published", "tested"}]
    skills = client.get("/api/skills").json()
    skill_names = [s["skill_name"] for s in skills]
    assert len(skill_names) == len(set(skill_names))
    model_ids = {s["model_id"] for s in skills}
    assert {m["id"] for m in models}.issubset(model_ids)


def test_skill_alias_and_canonical_name() -> None:
    skill = client.get("/api/skills/run_economic_dispatch").json()
    assert skill["canonical_skill_name"]
    assert "run_economic_dispatch" in skill["skill_aliases"]
    assert skill["skill_name"] == skill["canonical_skill_name"]
    assert "allowed_callers" in skill
