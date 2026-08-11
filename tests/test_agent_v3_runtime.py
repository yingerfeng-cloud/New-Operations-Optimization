from __future__ import annotations

import threading
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict

from app.agent.conversation_store import conversation_store
from app.agent.v3.models import ModelTurn, ToolCall, ToolContext
from app.agent.v3.model_gateway import ConfiguredModelGateway
from app.agent.v3.runtime import AgentV3Runtime
from app.agent.v3.skills.optimization import optimization_task_engine
from app.agent.v3.store import agent_v3_store
from app.agent.v3.tools import ToolDefinition, ToolRegistry
from app.main import app
from app.services.agent_runtime_service import agent_runtime_service
from app.services.llm_service import llm_service
from app.storage.memory_store import STORE


class SequenceGateway:
    def __init__(self, turns: list[ModelTurn]) -> None:
        self.turns = list(turns)
        self.requests: list[list[dict[str, Any]]] = []

    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelTurn:
        self.requests.append(messages)
        return self.turns.pop(0)


class EchoArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str
    task_id: str | None = None
    start_new: bool = False


def _echo_tool(context: ToolContext, arguments: BaseModel) -> dict[str, Any]:
    value = EchoArguments.model_validate(arguments.model_dump()).value
    return {"value": value, "workflow_state": "SUCCESS", "context_task_id": context.task_id}


def _registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name="test_echo",
            description="Test tool",
            argument_model=EchoArguments,
            handler=_echo_tool,
            creates_task=True,
            task_title="Echo task",
        )
    )
    return registry


def test_tool_schema_is_strict_and_provider_compatible() -> None:
    function = _registry().model_specs()[0]["function"]
    parameters = function["parameters"]
    assert function["strict"] is True
    assert parameters["additionalProperties"] is False
    assert set(parameters["required"]) == set(parameters["properties"])


def test_optimization_tool_requires_task_creation_before_missing_input_collection() -> None:
    function = AgentV3Runtime().registry.model_specs()[0]["function"]

    assert function["name"] == "optimization_create_or_continue"
    assert "MUST call" in function["description"]
    assert "even when required parameters are missing" in function["description"]


def test_general_chat_does_not_create_or_resume_optimization_task() -> None:
    conversation = conversation_store.create("General chat")
    with STORE.lock:
        STORE.agent_runs["RUN-OLD"] = {
            "run_id": "RUN-OLD",
            "conversation_id": conversation["conversation_id"],
            "status": "PARAMETER_REVIEW",
            "events": [],
        }
        STORE.conversations[conversation["conversation_id"]]["active_run_id"] = "RUN-OLD"
    gateway = SequenceGateway([ModelTurn(content="当然可以。你想聊什么？")])
    runtime = AgentV3Runtime(gateway=gateway, registry=_registry())

    response = runtime.run_turn(conversation["conversation_id"], "我们聊聊天可以吗？")

    assert response["message"]["text"] == "当然可以。你想聊什么？"
    assert response["tasks"] == []
    assert not STORE.tool_invocations
    assert STORE.agent_runs["RUN-OLD"]["status"] == "PARAMETER_REVIEW"
    assert [event["type"] for event in agent_v3_store.list_events(conversation["conversation_id"])] == [
        "message.completed",
        "message.completed",
    ]


def test_turn_idempotency_replays_without_duplicate_messages_or_model_calls() -> None:
    conversation = conversation_store.create("Idempotent turn")
    gateway = SequenceGateway([ModelTurn(content="hello back")])
    runtime = AgentV3Runtime(gateway=gateway, registry=_registry())

    first = runtime.run_turn(conversation["conversation_id"], "hello", client_turn_id="client-turn-1")
    replay = runtime.run_turn(conversation["conversation_id"], "hello", client_turn_id="client-turn-1")

    assert first["turn_id"] == replay["turn_id"]
    assert replay["idempotent_replay"] is True
    assert len(gateway.requests) == 1
    assert len(conversation_store.get(conversation["conversation_id"])["messages"]) == 2
    with pytest.raises(Exception, match="different content"):
        runtime.run_turn(conversation["conversation_id"], "changed", client_turn_id="client-turn-1")


def test_explicit_model_tool_call_creates_audited_task_and_returns_final_answer() -> None:
    conversation = conversation_store.create("Tool use")
    gateway = SequenceGateway(
        [
            ModelTurn(tool_calls=[ToolCall(call_id="call-1", name="test_echo", arguments={"value": "42"})]),
            ModelTurn(content="工具已完成，结果是 42。"),
        ]
    )
    runtime = AgentV3Runtime(gateway=gateway, registry=_registry())

    response = runtime.run_turn(conversation["conversation_id"], "请执行测试工具")

    assert response["message"]["text"] == "工具已完成，结果是 42。"
    assert len(response["tasks"]) == 1
    assert response["tasks"][0]["status"] == "SUCCEEDED"
    assert len(STORE.tool_invocations) == 1
    invocation = next(iter(STORE.tool_invocations.values()))
    assert invocation["status"] == "SUCCEEDED"
    assert invocation["result"]["value"] == "42"
    assert gateway.requests[1][-1]["role"] == "tool"
    event_types = [event["type"] for event in agent_v3_store.list_events(conversation["conversation_id"])]
    assert event_types == [
        "message.completed",
        "task.created",
        "task.updated",
        "tool.started",
        "task.updated",
        "tool.completed",
        "message.completed",
    ]


def test_tool_can_finish_the_turn_with_its_authoritative_business_message() -> None:
    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name="test_terminal_tool",
            description="Test terminal tool",
            argument_model=EchoArguments,
            handler=lambda _context, _arguments: {
                "status": "WAITING_INPUT",
                "agent_message": "请补充负荷预测。",
            },
            creates_task=True,
            task_title="Terminal task",
            final_response_field="agent_message",
        )
    )
    conversation = conversation_store.create("Terminal tool response")
    gateway = SequenceGateway(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        call_id="call-terminal-response",
                        name="test_terminal_tool",
                        arguments={"value": "x"},
                    )
                ]
            )
        ]
    )

    response = AgentV3Runtime(gateway=gateway, registry=registry).run_turn(
        conversation["conversation_id"],
        "创建任务",
    )

    assert response["message"]["text"] == "请补充负荷预测。"
    assert response["tasks"][0]["status"] == "WAITING_INPUT"
    assert len(gateway.requests) == 1


def test_follow_up_tool_call_reuses_the_active_task_instead_of_creating_a_patchwork_task() -> None:
    conversation = conversation_store.create("Continue task")
    first_gateway = SequenceGateway(
        [
            ModelTurn(tool_calls=[ToolCall(call_id="call-first", name="test_echo", arguments={"value": "first"})]),
            ModelTurn(content="还需要补充信息。"),
        ]
    )
    runtime = AgentV3Runtime(gateway=first_gateway, registry=_registry())
    first = runtime.run_turn(conversation["conversation_id"], "开始任务")
    task_id = first["tasks"][0]["task_id"]
    agent_v3_store.update_task(task_id, status="WAITING_INPUT")

    second_gateway = SequenceGateway(
        [
            ModelTurn(tool_calls=[ToolCall(call_id="call-second", name="test_echo", arguments={"value": "supplement"})]),
            ModelTurn(content="已补充。"),
        ]
    )
    runtime.gateway = second_gateway
    second = runtime.run_turn(conversation["conversation_id"], "补充参数")

    assert second["tasks"][0]["task_id"] == task_id
    assert len(agent_v3_store.list_tasks(conversation["conversation_id"])) == 1
    assert task_id not in second_gateway.requests[0][1]["content"]
    assert "continue the current task automatically" in second_gateway.requests[0][1]["content"]
    assert any(message.get("tool_calls") for message in second_gateway.requests[0])
    assert any(message.get("role") == "tool" for message in second_gateway.requests[0])


def test_gateway_failure_closes_turn_with_visible_error_and_failed_event() -> None:
    class RaisingGateway:
        def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelTurn:
            raise RuntimeError("provider unavailable")

    conversation = conversation_store.create("Failure")
    runtime = AgentV3Runtime(gateway=RaisingGateway(), registry=_registry())

    with pytest.raises(RuntimeError, match="provider unavailable"):
        runtime.run_turn(conversation["conversation_id"], "hello")

    restored = conversation_store.get(conversation["conversation_id"])
    assert restored["status"] == "CHAT_ERROR"
    assert restored["messages"][-1]["metadata"]["delivery_status"] == "failed"
    assert restored["messages"][-1]["metadata"]["error_code"] == "TURN_FAILED"
    assert agent_v3_store.list_events(conversation["conversation_id"])[-1]["type"] == "turn.failed"


def test_gateway_timeout_is_recorded_as_one_localized_retryable_failure() -> None:
    class TimeoutGateway:
        def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelTurn:
            raise HTTPException(
                status_code=504,
                detail={"code": "LLM_TIMEOUT", "message": "LLM response timed out", "retryable": True},
            )

    conversation = conversation_store.create("Timeout")
    runtime = AgentV3Runtime(gateway=TimeoutGateway(), registry=_registry())

    with pytest.raises(HTTPException) as raised:
        runtime.run_turn(conversation["conversation_id"], "hello")

    assert raised.value.status_code == 504
    restored = conversation_store.get(conversation["conversation_id"])
    failure_messages = [
        item for item in restored["messages"]
        if (item.get("metadata") or {}).get("delivery_status") == "failed"
    ]
    assert len(failure_messages) == 1
    assert failure_messages[0]["text"] == "Agent 响应超时，本轮未能完成。请稍后重试。"
    assert failure_messages[0]["metadata"] == {
        "delivery_status": "failed",
        "error_code": "LLM_TIMEOUT",
        "retryable": True,
    }


def test_terminal_task_is_not_resurrected_and_runtime_creates_a_new_task() -> None:
    conversation = conversation_store.create("Terminal task")
    task = agent_v3_store.create_task(conversation["conversation_id"], "TURN-OLD", "Echo", "test_echo")
    agent_v3_store.update_task(task["task_id"], status="SUCCEEDED", result={"value": "old"})
    gateway = SequenceGateway(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        call_id="call-terminal",
                        name="test_echo",
                        arguments={"value": "new", "task_id": task["task_id"]},
                    )
                ]
            ),
            ModelTurn(content="That task is already complete; I did not overwrite it."),
        ]
    )

    AgentV3Runtime(gateway=gateway, registry=_registry()).run_turn(conversation["conversation_id"], "reuse it")

    restored = agent_v3_store.get_task(task["task_id"])
    assert restored["status"] == "SUCCEEDED"
    assert restored["result"] == {"value": "old"}
    tasks = agent_v3_store.list_tasks(conversation["conversation_id"])
    assert len(tasks) == 2
    assert tasks[-1]["task_id"] != task["task_id"]
    assert tasks[-1]["result"]["value"] == "new"
    invocation = next(iter(STORE.tool_invocations.values()))
    assert invocation["status"] == "SUCCEEDED"


def test_cancelled_task_rejects_late_completion_with_atomic_status_guard() -> None:
    conversation = conversation_store.create("Cancellation wins")
    task = agent_v3_store.create_task(conversation["conversation_id"], "TURN-CANCEL", "Echo", "test_echo")
    agent_v3_store.update_task(task["task_id"], status="RUNNING")
    agent_v3_store.cancel_task(task["task_id"])

    late = agent_v3_store.update_task(
        task["task_id"],
        unless_status={"CANCELLED"},
        status="SUCCEEDED",
        result={"value": "late"},
    )

    assert late["status"] == "CANCELLED"
    assert late["result"] is None


def test_events_keep_immutable_entity_snapshots() -> None:
    conversation = conversation_store.create("Immutable events")
    task = agent_v3_store.create_task(conversation["conversation_id"], "TURN-SNAPSHOT", "Echo", "test_echo")
    created_event = agent_v3_store.list_events(conversation["conversation_id"])[0]
    agent_v3_store.update_task(task["task_id"], status="SUCCEEDED")

    restored_event = agent_v3_store.list_events(conversation["conversation_id"])[0]
    assert created_event["payload"]["task"]["status"] == "PENDING"
    assert restored_event["payload"]["task"]["status"] == "PENDING"


def test_approval_is_bound_to_task_content_revision_and_current_turn() -> None:
    conversation = conversation_store.create("Approval revision")
    task = agent_v3_store.create_task(conversation["conversation_id"], "TURN-FIRST", "Echo", "test_echo")
    task = agent_v3_store.update_task(
        task["task_id"],
        event_turn_id="TURN-SECOND",
        status="APPROVAL_REQUIRED",
        result={"workflow_state": "READY_TO_INVOKE", "value": "v1"},
    )
    first_approval = agent_v3_store.create_approval(
        task["task_id"],
        "Approve v1?",
        {"action": "confirm_invoke"},
        turn_id="TURN-SECOND",
    )
    task = agent_v3_store.update_task(
        task["task_id"],
        event_turn_id="TURN-THIRD",
        result={"workflow_state": "READY_TO_INVOKE", "value": "v2"},
    )
    second_approval = agent_v3_store.create_approval(
        task["task_id"],
        "Approve v2?",
        {"action": "confirm_invoke"},
        turn_id="TURN-THIRD",
    )

    assert agent_v3_store.get_approval(first_approval["approval_id"])["status"] == "SUPERSEDED"
    assert second_approval["task_revision"] == task["revision"]
    assert second_approval["turn_id"] == "TURN-THIRD"


def test_delete_waits_for_inflight_turn_and_leaves_no_orphan_records() -> None:
    entered = threading.Event()
    release = threading.Event()

    class BlockingGateway:
        def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelTurn:
            entered.set()
            release.wait(timeout=5)
            return ModelTurn(content="done")

    conversation = conversation_store.create("Concurrent delete")
    runtime = AgentV3Runtime(gateway=BlockingGateway(), registry=_registry())
    turn_thread = threading.Thread(target=runtime.run_turn, args=(conversation["conversation_id"], "hello"))
    turn_thread.start()
    assert entered.wait(timeout=2)
    delete_result: list[dict[str, Any]] = []
    delete_thread = threading.Thread(
        target=lambda: delete_result.append(runtime.delete_conversation(conversation["conversation_id"])),
    )
    delete_thread.start()
    release.set()
    turn_thread.join(timeout=5)
    delete_thread.join(timeout=5)

    assert delete_result[0]["deleted"] is True
    assert not agent_v3_store.list_tasks(conversation["conversation_id"])
    assert not [row for row in STORE.tool_invocations.values() if row.get("conversation_id") == conversation["conversation_id"]]
    assert conversation["conversation_id"] not in STORE.agent_events


def test_v3_api_returns_honest_response_when_model_is_disabled() -> None:
    with STORE.lock:
        STORE.llm_config.clear()
        STORE.llm_config.update({"provider": "disabled", "enabled": False, "model": ""})
    client = TestClient(app)
    created = client.post("/api/agent/conversations", json={"title": "Disabled model"})
    assert created.status_code == 200
    conversation_id = created.json()["conversation_id"]

    response = client.post(
        f"/api/agent/v3/conversations/{conversation_id}/turns",
        json={"message": "你好"},
    )

    assert response.status_code == 200, response.text
    assert "尚未启用通用语言模型" in response.json()["message"]["text"]
    events = client.get(f"/api/agent/v3/conversations/{conversation_id}/events")
    assert events.status_code == 200
    assert [event["type"] for event in events.json()] == ["message.completed", "message.completed"]


def test_deleting_conversation_removes_v3_tasks_events_and_tool_invocations() -> None:
    conversation = conversation_store.create("Delete cascade")
    gateway = SequenceGateway(
        [
            ModelTurn(tool_calls=[ToolCall(call_id="call-delete", name="test_echo", arguments={"value": "x"})]),
            ModelTurn(content="done"),
        ]
    )
    AgentV3Runtime(gateway=gateway, registry=_registry()).run_turn(conversation["conversation_id"], "run")

    result = conversation_store.delete(conversation["conversation_id"])

    assert result["deleted_task_count"] == 1
    assert result["deleted_tool_invocation_count"] == 1
    assert not [row for row in STORE.agent_tasks.values() if row.get("conversation_id") == conversation["conversation_id"]]
    assert conversation["conversation_id"] not in STORE.agent_events
    assert not [row for row in STORE.tool_invocations.values() if row.get("conversation_id") == conversation["conversation_id"]]


def test_invalid_model_tool_arguments_do_not_destroy_an_existing_business_task() -> None:
    conversation = conversation_store.create("Invalid call")
    task = agent_v3_store.create_task(conversation["conversation_id"], "TURN-OLD", "Echo", "test_echo")
    agent_v3_store.update_task(task["task_id"], status="WAITING_INPUT")
    gateway = SequenceGateway(
        [
            ModelTurn(tool_calls=[ToolCall(call_id="call-invalid", name="test_echo", arguments={})]),
            ModelTurn(content="工具参数无效，请重新提供。"),
        ]
    )

    response = AgentV3Runtime(gateway=gateway, registry=_registry()).run_turn(conversation["conversation_id"], "继续")

    assert response["message"]["text"] == "工具参数无效，请重新提供。"
    assert agent_v3_store.get_task(task["task_id"])["status"] == "WAITING_INPUT"
    invocation = next(
        row
        for row in STORE.tool_invocations.values()
        if row.get("conversation_id") == conversation["conversation_id"]
        and row.get("call_id") == "call-invalid"
    )
    assert invocation["status"] == "FAILED"


def test_runtime_persistence_keeps_optimization_run_link_and_interrupts_ghost_work() -> None:
    normalized = STORE._normalize_deprecated_markers(
        {"optimization_run_id": "RUN-KEEP", "legacy_run_id": "RUN-DROP"}
    )
    assert normalized == {"optimization_run_id": "RUN-KEEP", "legacy_run_id": "RUN-DROP"}
    with STORE.lock:
        STORE.agent_tasks["TASK-GHOST"] = {"task_id": "TASK-GHOST", "status": "RUNNING"}
        STORE.tool_invocations["TOOL-GHOST"] = {"invocation_id": "TOOL-GHOST", "status": "RUNNING"}

    assert STORE._interrupt_recovered_agent_v3_work() is True
    assert STORE.agent_tasks["TASK-GHOST"]["status"] == "FAILED"
    assert STORE.tool_invocations["TOOL-GHOST"]["status"] == "FAILED"


def test_optimization_engine_uses_a_private_task_context(monkeypatch) -> None:
    conversation = conversation_store.create("Task isolation")
    task = agent_v3_store.create_task(
        conversation["conversation_id"],
        "TURN-A",
        "Optimization A",
        "optimization_create_or_continue",
    )
    observed: list[dict[str, Any]] = []
    monkeypatch.setattr(
        agent_runtime_service,
        "analyze",
        lambda body: observed.append(dict(body)) or {
            "conversation_id": body["conversation_id"],
            "workflow_state": "PARAM_COLLECTING",
            "parameter_draft": {"source": "task-a"},
        },
    )
    result = optimization_task_engine.analyze(
        ToolContext(
            conversation_id=conversation["conversation_id"],
            turn_id="TURN-A",
            call_id="CALL-A",
            task_id=task["task_id"],
            user_message="exact user input",
        ),
        "run_task_a",
    )

    internal_id = observed[0]["conversation_id"]
    assert internal_id.startswith("CTX-")
    assert observed[0]["message"] == "exact user input"
    assert conversation_store.get(internal_id)["agent_task_id"] == task["task_id"]
    assert conversation_store.get(conversation["conversation_id"]).get("parameter_draft") is None
    assert result["conversation_id"] == conversation["conversation_id"]


def test_malformed_provider_tool_arguments_are_returned_for_runtime_audit(monkeypatch) -> None:
    monkeypatch.setattr(llm_service, "enabled", lambda: True)
    monkeypatch.setattr(
        llm_service,
        "chat_with_tools",
        lambda messages, tools: {
            "content": "",
            "tool_calls": [
                {"id": "call-bad-json", "function": {"name": "test_echo", "arguments": "{not-json"}},
            ],
        },
    )

    turn = ConfiguredModelGateway().complete([], _registry().model_specs())

    assert turn.tool_calls[0].arguments == {}
    assert "valid JSON" in str(turn.tool_calls[0].argument_error)


def test_failed_approval_action_can_be_retried(monkeypatch) -> None:
    conversation = conversation_store.create("Retry approval")
    task = agent_v3_store.create_task(
        conversation["conversation_id"],
        "TURN-RETRY",
        "Optimization",
        "optimization_create_or_continue",
    )
    task = agent_v3_store.update_task(
        task["task_id"],
        status="APPROVAL_REQUIRED",
        result={"workflow_state": "DEFAULT_CONFIRMING", "parameter_draft": {"x": 1}},
        optimization_run_id="RUN-RETRY",
    )
    approval = agent_v3_store.create_approval(
        task["task_id"],
        "Confirm?",
        {"action": "confirm_defaults", "optimization_run_id": "RUN-RETRY"},
    )
    calls = 0

    def flaky_defaults(body: dict[str, Any]) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("temporary failure")
        return {"workflow_state": "READY_TO_INVOKE", "ready_to_invoke": True, "run_id": body["run_id"]}

    monkeypatch.setattr(agent_runtime_service, "confirm_defaults", flaky_defaults)
    runtime = AgentV3Runtime(gateway=SequenceGateway([]), registry=_registry())

    with pytest.raises(RuntimeError, match="temporary failure"):
        runtime.resolve_approval(approval["approval_id"], "approve")
    assert agent_v3_store.get_approval(approval["approval_id"])["status"] == "FAILED"
    assert agent_v3_store.get_task(task["task_id"])["status"] == "APPROVAL_REQUIRED"

    retried = runtime.resolve_approval(approval["approval_id"], "approve")

    assert calls == 2
    assert retried["approval"]["status"] == "APPROVED"
    assert retried["task"]["status"] == "APPROVAL_REQUIRED"


def test_approval_resolution_is_resumable_and_separates_defaults_from_execution(monkeypatch) -> None:
    conversation = conversation_store.create("Approval flow")
    task = agent_v3_store.create_task(
        conversation["conversation_id"],
        "TURN-APPROVAL",
        "Optimization",
        "optimization_create_or_continue",
    )
    task = agent_v3_store.update_task(
        task["task_id"],
        status="APPROVAL_REQUIRED",
        optimization_run_id="RUN-APPROVAL",
    )
    approval = agent_v3_store.create_approval(
        task["task_id"],
        "确认默认值？",
        {"action": "confirm_defaults", "optimization_run_id": "RUN-APPROVAL"},
    )
    defaults_calls: list[dict[str, Any]] = []

    def confirm_defaults(body: dict[str, Any]) -> dict[str, Any]:
        defaults_calls.append(body)
        return {
            "conversation_id": body["conversation_id"],
            "run_id": body["run_id"],
            "workflow_state": "READY_TO_INVOKE",
            "ready_to_invoke": True,
        }

    monkeypatch.setattr(
        agent_runtime_service,
        "confirm_defaults",
        confirm_defaults,
    )
    runtime = AgentV3Runtime(gateway=SequenceGateway([]), registry=_registry())

    defaults_result = runtime.resolve_approval(approval["approval_id"], "approve")

    assert defaults_result["approval"]["status"] == "APPROVED"
    assert defaults_result["task"]["status"] == "APPROVAL_REQUIRED"
    assert defaults_result["next_approval"]["payload"]["action"] == "confirm_invoke"
    replay = runtime.resolve_approval(approval["approval_id"], "approve")
    assert len(defaults_calls) == 1
    assert replay["approval"]["status"] == "APPROVED"

    client = TestClient(app)
    restored = client.get(f"/api/agent/conversations/{conversation['conversation_id']}")
    assert restored.status_code == 200
    assert restored.json()["agent_tasks"][0]["task_id"] == task["task_id"]
    assert restored.json()["pending_approvals"][0]["approval_id"] == defaults_result["next_approval"]["approval_id"]

    monkeypatch.setattr(
        agent_runtime_service,
        "confirm_invoke",
        lambda body: {
            "conversation_id": body["conversation_id"],
            "run_id": body["run_id"],
            "workflow_state": "SUCCESS",
            "status": "SUCCESS",
            "result": {"objective_value": 1.0},
        },
    )
    invoke_result = runtime.resolve_approval(defaults_result["next_approval"]["approval_id"], "approve")

    assert invoke_result["task"]["status"] == "SUCCEEDED"
    assert invoke_result["next_approval"] is None
    assert agent_v3_store.get_task(task["task_id"])["result"]["result"]["objective_value"] == 1.0
