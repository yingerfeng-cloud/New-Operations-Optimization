from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.storage.memory_store import STORE
from app.utils import has_highspy, has_pyomo


client = TestClient(app)


def test_llm_test_disabled_is_safe(monkeypatch) -> None:
    with STORE.lock:
        STORE.llm_config.clear()
        STORE.llm_config.update({"provider": "disabled", "enabled": False, "api_key": "should-not-leak"})
    res = client.post("/api/llm/test")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["enabled"] is False
    assert "should-not-leak" not in res.text


def test_agent_default_confirmation_message_saved() -> None:
    cid = f"CONV-DEFAULT-MSG-{uuid.uuid4().hex[:8].upper()}"
    first = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "帮我跑经济调度，四个时段负荷100、120、90、110。", "skill_name": "run_economic_dispatch"},
    )
    assert first.status_code == 200, first.text
    confirmed = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "确认使用默认值", "confirm_defaults": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    with STORE.lock:
        conversation = STORE.conversations[cid]
    texts = [item["text"] for item in conversation.get("messages", [])]
    assert "确认使用默认值" in texts
    assert (
        "已识别到优化任务，但参数还不完整，请继续补充。" in texts
        or "默认值已确认，参数已就绪，可以确认调用。" in texts
    )
    if conversation.get("missing_required"):
        assert any(item.get("key") in {"unit_max_output", "fuel_cost"} for item in conversation.get("missing_required", []))
    else:
        assert any(str(value).endswith("_confirmed") for value in conversation.get("parameter_sources", {}).values())


def test_agent_manual_skill_selection_effective() -> None:
    cid = f"CONV-MANUAL-{uuid.uuid4().hex[:8].upper()}"
    res = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "只分析这个请求", "skill_name": "run_economic_dispatch"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["selected_skill"] == "run_economic_dispatch"
    assert body["resolved_skill_name"].startswith("run_economic_dispatch")


def test_agent_casual_chat_does_not_enter_optimization_flow() -> None:
    cid = f"CONV-CHAT-{uuid.uuid4().hex[:8].upper()}"
    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "你好"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["response_type"] == "chat"
    assert body["resolved_skill_name"] is None
    assert body["parameter_draft"] == {}
    assert body["requires_default_confirmation"] is False
    assert body["ready_to_invoke"] is False


def test_agent_casual_chat_inside_task_preserves_task_without_prompting_defaults() -> None:
    cid = f"CONV-CHAT-TASK-{uuid.uuid4().hex[:8].upper()}"
    task = client.post(
        "/api/agent/analyze",
        json={
            "conversation_id": cid,
            "message": "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30。",
        },
    )
    assert task.status_code == 200, task.text
    assert task.json()["requires_default_confirmation"] is True
    assert task.json()["ready_to_invoke"] is False

    hello = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "你好"})
    assert hello.status_code == 200, hello.text
    body = hello.json()
    assert body["response_type"] == "chat"
    assert body["resolved_skill_name"].startswith("run_economic_dispatch")
    assert body["parameter_draft"]
    assert body["requires_default_confirmation"] is False
    assert "默认值" not in body["agent_message"]

    detail = client.get(f"/api/agent/conversations/{cid}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["resolved_skill_name"].startswith("run_economic_dispatch")
    assert detail.json()["parameter_draft"]["load_forecast"] == [100, 120, 90, 110]


def test_agent_capability_question_inside_task_is_not_parameter_analysis() -> None:
    cid = f"CONV-CAPABILITY-{uuid.uuid4().hex[:8].upper()}"
    task = client.post(
        "/api/agent/analyze",
        json={
            "conversation_id": cid,
            "message": "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30。",
        },
    )
    assert task.status_code == 200, task.text
    assert task.json()["ready_to_invoke"] is False
    assert task.json()["requires_default_confirmation"] is True

    res = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "你能做什么呢"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["response_type"] == "chat"
    assert "参数已就绪" not in body["agent_message"]
    assert "Skill" in body["agent_message"]
    detail = client.get(f"/api/agent/conversations/{cid}").json()
    assert detail["resolved_skill_name"].startswith("run_economic_dispatch")


def test_extract_debug_does_not_pollute_chat_state() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    match = re.search(r"async function testExtractOnly\([^)]*\)\{(?P<body>.*?)\nasync function analyzeInput", html, re.S)
    assert match, "testExtractOnly must exist"
    body = match.group("body")
    assert "state.extractDebugResult" in body
    assert "state.llmExtractTestResult" in body
    assert "state.chatMessages" not in body
    assert "state.conversationId=" not in body


def test_skill_status_callable_consistency() -> None:
    res = client.get("/api/agent/skills")
    assert res.status_code == 200, res.text
    skills = res.json()
    assert skills
    for skill in skills:
        assert skill["status"] in {"published", "draft", "deprecated"}
        assert skill["skill_status"] in {"enabled", "disabled"}
        assert isinstance(skill["callable"], bool)
        if skill["callable"]:
            assert skill["skill_status"] == "enabled"


def test_agent_status_platform_unavailable(monkeypatch) -> None:
    from app.api import agent as agent_api

    class UnavailablePlatform:
        base_url = "http://127.0.0.1:1"

        def health(self):
            raise HTTPException(status_code=503, detail="unavailable")

        def list_skills(self):
            raise HTTPException(status_code=503, detail="unavailable")

    monkeypatch.setattr(agent_api, "platform_client", UnavailablePlatform())
    res = client.get("/api/agent/status")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["agent"]["ok"] is True
    assert body["platform"]["reachable"] is False
    assert body["platform"]["skill_count"] == 0
    assert body["llm"]["fallback_mode"] in {"rule_based", "llm"}


def test_agent_console_wrong_service_not_found_hint() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert "当前连接的是 ${state.health.service}，不是 Agent 服务" in html
    assert "Agent Console 请连接 Agent 服务，例如 http://127.0.0.1:8091/api" in html
    assert "当前 API Base 不是 Agent 服务或 Agent 服务未启用 LLM 配置接口，请检查 API Base。" in html
    assert "disabledWhenWrong" in html


def test_create_conversation() -> None:
    res = client.post("/api/agent/conversations", json={"title": "新会话"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["conversation_id"].startswith("CONV-")
    assert body["title"] == "新会话"
    assert body["status"] == "CHAT_IDLE"


def test_list_conversations() -> None:
    created = client.post("/api/agent/conversations", json={"title": "列表测试"})
    assert created.status_code == 200, created.text
    res = client.get("/api/agent/conversations")
    assert res.status_code == 200, res.text
    assert any(item["conversation_id"] == created.json()["conversation_id"] for item in res.json())


def test_get_conversation_detail() -> None:
    cid = f"CONV-DETAIL-{uuid.uuid4().hex[:8].upper()}"
    analyzed = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "帮我跑经济调度，四个时段负荷100、120、90、110。", "skill_name": "run_economic_dispatch"},
    )
    assert analyzed.status_code == 200, analyzed.text
    detail = client.get(f"/api/agent/conversations/{cid}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["conversation_id"] == cid
    assert body["messages"]
    assert "parameter_draft" in body


def test_delete_conversation() -> None:
    created = client.post("/api/agent/conversations", json={"title": "删除测试"})
    cid = created.json()["conversation_id"]
    deleted = client.delete(f"/api/agent/conversations/{cid}")
    assert deleted.status_code == 200, deleted.text
    missing = client.get(f"/api/agent/conversations/{cid}")
    assert missing.status_code == 404


def test_chat_history_persisted_after_refresh() -> None:
    cid = f"CONV-HISTORY-{uuid.uuid4().hex[:8].upper()}"
    analyzed = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "帮我跑经济调度，四个时段负荷100、120、90、110。", "skill_name": "run_economic_dispatch"},
    )
    assert analyzed.status_code == 200, analyzed.text
    listed = client.get("/api/agent/conversations")
    assert any(item["conversation_id"] == cid for item in listed.json())
    detail = client.get(f"/api/agent/conversations/{cid}").json()
    assert any(item["role"] == "user" for item in detail["messages"])
    assert any(item["role"] == "agent" for item in detail["messages"])


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_agent_multiturn_economic_dispatch_success() -> None:
    cid = f"CONV-ED-{uuid.uuid4().hex[:8].upper()}"
    first = client.post(
        "/api/agent/analyze",
        json={
            "conversation_id": cid,
            "message": "帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30。",
            "skill_name": "run_economic_dispatch",
        },
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["requires_default_confirmation"] is True
    assert first_body["ready_to_invoke"] is False
    assert first_body["parameter_sources"]["unit_min_output"] == "default_suggested"
    confirmed = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "确认使用默认值", "confirm_defaults": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["ready_to_invoke"] is True
    assert confirmed.json()["parameter_sources"]["unit_min_output"] == "default_confirmed"
    invoked = client.post("/api/agent/confirm-invoke", json={"conversation_id": cid})
    assert invoked.status_code == 200, invoked.text
    body = invoked.json()
    assert body["status"] == "SUCCESS"
    assert float(body["result"]["objective_value"]) == pytest.approx(5900.0)
    assert "unit_output" in body["result"]["variable_values"]

    explained = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "解释上一次优化结果，并给出风险和下一步动作。"},
    )
    assert explained.status_code == 200, explained.text
    explain_body = explained.json()
    assert explain_body["response_type"] == "result_explanation"
    assert "参数已就绪" not in explain_body["agent_message"]
    assert "风险" in explain_body["agent_message"]
    assert explain_body["explanation"]["skill"]["skill_name"].startswith("run_economic_dispatch")


def test_llm_config_wrong_base_shows_agent_service_hint() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert "保存配置前检查当前服务是否为 optimization-agent" not in html
    assert "当前连接的是非 Agent 服务，请先连接 Agent 服务。" in html
    assert "当前 API Base 不是 Agent 服务或 Agent 服务未启用 LLM 配置接口，请检查 API Base。" in html


def test_runtime_store_no_api_key_in_package() -> None:
    data_dir = Path("data")
    for path in data_dir.glob("runtime_store*.json"):
        if path.name != "runtime_store.example.json":
            path.unlink()
    files = sorted(data_dir.glob("runtime_store*.json"))
    assert [item.name for item in files] == ["runtime_store.example.json"]
    text = files[0].read_text(encoding="utf-8").lower()
    assert "api_key" not in text
    assert '"enabled": false' in text


def test_chat_scroll_to_bottom_after_message() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert 'id="chatThread"' in html
    assert "scrollChatToBottom" in html
    assert "el.scrollHeight-el.scrollTop-el.clientHeight<80" in html
    assert "state.forceScrollBottom=true" in html
    assert "addThinkingMessage" in html
    assert "正在思考" in html
    assert "chat-layout" in html
    assert "task-progress" in html
    assert "oninput=\"state.message=this.value\"" in html
    assert "isInvokeConfirmationText" in html
    assert "isResultExplanationText" in html
    assert "invokeCurrentTask" in html
    assert "explainCurrentResult" in html
    assert "formatExplanationResponse" in html
    assert "compactResultInMessage" in html
    assert "workflowCard" in html
    assert "意图识别" in html
