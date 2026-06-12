from __future__ import annotations

import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from app.agent.orchestrator import agent_orchestrator
from app.main import app


client = TestClient(app)


def _cid(name: str) -> str:
    return f"CONV-{name}-{uuid.uuid4().hex[:8].upper()}"


def test_parameter_example_new_conversation() -> None:
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("EXAMPLE-NEW"), "message": "请给我个参数示例"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["response_type"] in {"parameter_example", "skill_selection_required"}
    assert body["ready_to_invoke"] is False
    assert body["parameter_draft"] == {}
    assert "参数已就绪" not in (body.get("agent_message") or body.get("message") or "")


def test_parameter_example_does_not_trigger_ready_to_invoke() -> None:
    cid = _cid("EXAMPLE-NOT-READY")
    task = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我跑经济调度，四个时段负荷100、120、90、110。"})
    assert task.status_code == 200, task.text
    before = task.json()["parameter_draft"]
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "给我一个参数示例"})
    body = res.json()
    assert body["response_type"] == "parameter_example"
    assert body["ready_to_invoke"] is False
    assert body["parameter_draft"] == before


def test_parameter_example_preserves_current_skill() -> None:
    cid = _cid("EXAMPLE-SKILL")
    task = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我跑日前机组组合优化"})
    assert task.status_code == 200, task.text
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "请给我个参数示例"})
    body = res.json()
    assert body["response_type"] == "parameter_example"
    assert body["resolved_skill_name"].startswith("run_unit_commitment_day_ahead")
    assert body["resolved_skill_name"] != "run_economic_dispatch"
    assert body["ready_to_invoke"] is False


def test_parameter_example_after_completed_task() -> None:
    cid = _cid("EXAMPLE-DONE")
    first = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30。"})
    assert first.status_code == 200, first.text
    confirmed = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "确认使用默认值", "confirm_defaults": True})
    assert confirmed.json()["ready_to_invoke"] is True
    client.post("/api/agent/confirm-invoke", json={"conversation_id": cid})
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "请给我个参数示例"})
    body = res.json()
    assert body["response_type"] == "parameter_example"
    assert body["resolved_skill_name"].startswith("run_economic_dispatch")
    assert body["ready_to_invoke"] is False
    detail = client.get(f"/api/agent/conversations/{cid}").json()
    assert detail.get("last_invocation_id")


def test_unit_commitment_parameter_example_not_switch_to_economic_dispatch() -> None:
    cid = _cid("UC-EXAMPLE")
    client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我跑一个日前机组组合优化"})
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "请给我个参数示例"})
    body = res.json()
    assert body["response_type"] == "parameter_example"
    assert body["resolved_skill_name"].startswith("run_unit_commitment_day_ahead")
    assert not body["resolved_skill_name"].startswith("run_economic_dispatch")
    assert "参数已就绪" not in body["agent_message"]


def test_select_skill_returns_none_when_no_scenario_detected() -> None:
    assert agent_orchestrator._select_skill("请给我个参数示例") is None
    assert agent_orchestrator._select_skill("你好") is None


def test_default_values_require_explicit_confirmation() -> None:
    cid = _cid("DEFAULTS")
    first = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30。"})
    body = first.json()
    assert body["ready_to_invoke"] is False
    assert body["requires_default_confirmation"] is True
    assert body["parameter_sources"]["unit_min_output"] == "default_suggested"
    confirmed = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "确认使用默认值", "confirm_defaults": True}).json()
    assert confirmed["ready_to_invoke"] is True
    assert confirmed["parameter_sources"]["unit_min_output"] == "default_confirmed"


def test_delete_conversation_from_history() -> None:
    created = client.post("/api/agent/conversations", json={"title": "delete-from-history"}).json()
    deleted = client.delete(f"/api/agent/conversations/{created['conversation_id']}")
    assert deleted.status_code == 200
    assert client.get(f"/api/agent/conversations/{created['conversation_id']}").status_code == 404


def test_delete_current_conversation_selects_next() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert "deleteConversation(id)" in html
    assert "const deletingCurrent=state.conversationId===id" in html
    assert "const next=state.conversations[0]" in html
    assert "await openConversation(next.conversation_id)" in html
    assert "delete localStorage.agentConversationId" in html


def test_chat_scroll_bottom_behavior() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert "isChatNearBottom" in html
    assert "scrollChatToBottom" in html
    assert "state.forceScrollBottom=true" in html
    assert "openConversation(id)" in html and "state.forceScrollBottom=true;render()" in html
    assert "chat-aside" in html
