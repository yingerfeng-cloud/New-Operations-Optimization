from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Header, Query
from fastapi.responses import StreamingResponse

from app.agent.conversation_store import conversation_store
from app.agent.orchestrator import agent_orchestrator
from app.agent.platform_client import platform_client
from app.agent.platform_gateway import service_mode
from app.agent.run_store import agent_run_store
from app.agent.v3.models import AgentApprovalRequest, AgentTurnRequest
from app.agent.v3.runtime import agent_v3_runtime
from app.agent.v3.store import agent_v3_store
from app.schemas.agent import (
    AgentAnalyzeRequest,
    AgentApplySampleParametersRequest,
    AgentConfirmDefaultsRequest,
    AgentConfirmInvokeRequest,
    AgentConversationCreateRequest,
    AgentConversationUpdateRequest,
    AgentExplainResultRequest,
)
from app.services.agent_service import AgentOptimizeRequest
from app.services.agent_runtime_service import agent_runtime_service
from app.services.agent_skill_service import agent_skill_service
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/optimize")
def agent_optimize(req: AgentOptimizeRequest) -> dict:
    return agent_orchestrator.optimize(req)


@router.post("/analyze")
def agent_analyze(body: AgentAnalyzeRequest) -> dict:
    payload = body.to_payload()
    return agent_v3_runtime.run_legacy_operation(
        payload.get("conversation_id"),
        lambda: agent_runtime_service.analyze(payload),
    )


@router.post("/confirm-invoke")
def agent_confirm_invoke(body: AgentConfirmInvokeRequest) -> dict:
    payload = body.to_payload()
    return agent_v3_runtime.run_legacy_operation(
        payload.get("conversation_id"),
        lambda: agent_runtime_service.confirm_invoke(payload),
    )


@router.post("/confirm-defaults")
def agent_confirm_defaults(body: AgentConfirmDefaultsRequest) -> dict:
    payload = body.to_payload()
    return agent_v3_runtime.run_legacy_operation(
        payload.get("conversation_id"),
        lambda: agent_runtime_service.confirm_defaults(payload),
    )


@router.post("/apply-sample-parameters")
def agent_apply_sample_parameters(body: AgentApplySampleParametersRequest) -> dict:
    payload = body.to_payload()
    return agent_v3_runtime.run_legacy_operation(
        payload.get("conversation_id"),
        lambda: agent_runtime_service.apply_sample_parameters(payload),
    )


@router.post("/explain-result")
def agent_explain_result(body: AgentExplainResultRequest) -> dict:
    payload = body.to_payload()
    return agent_v3_runtime.run_legacy_operation(
        payload.get("conversation_id"),
        lambda: agent_runtime_service.explain_result(payload),
    )


@router.post("/conversations")
def agent_create_conversation(body: AgentConversationCreateRequest | None = None) -> dict:
    return conversation_store.create(body.title if body else None)


@router.get("/conversations")
def agent_list_conversations() -> list[dict]:
    rows = conversation_store.list()
    for row in rows:
        tasks = agent_v3_store.list_tasks(str(row.get("conversation_id")))
        active_tasks = [task for task in tasks if task.get("status") not in {"SUCCEEDED", "FAILED", "CANCELLED"}]
        latest = (active_tasks or tasks)[-1] if tasks else None
        row["active_task_id"] = latest.get("task_id") if latest else None
        row["active_task_status"] = latest.get("status") if latest else None
    return rows


@router.get("/conversations/{conversation_id}")
def agent_get_conversation(conversation_id: str) -> dict:
    detail = conversation_store.get_public(conversation_id)
    tasks = agent_v3_store.list_tasks(conversation_id)
    active_tasks = [task for task in tasks if task.get("status") not in {"SUCCEEDED", "FAILED", "CANCELLED"}]
    selected_task = (active_tasks or tasks)[-1] if tasks else None
    runs = []
    for task in tasks:
        run_id = task.get("optimization_run_id")
        if not run_id:
            continue
        try:
            run = agent_runtime_service.get_run(str(run_id))
        except Exception:
            continue
        run["conversation_id"] = conversation_id
        runs.append(run)
    linked_run_ids = {str(run.get("run_id")) for run in runs}
    # Compatibility runs created through the old /analyze API are visible
    # only when they belong to the public conversation. V3 task runs execute
    # in private contexts and are resolved exclusively through their task.
    legacy_runs = agent_run_store.list_for_conversation(conversation_id)
    runs.extend(run for run in legacy_runs if str(run.get("run_id")) not in linked_run_ids)
    active_run = next(
        (run for run in reversed(runs) if selected_task and run.get("run_id") == selected_task.get("optimization_run_id")),
        None,
    )
    if active_run is None and not tasks:
        active_run_id = str(detail.get("active_run_id") or "")
        active_run = next((run for run in runs if str(run.get("run_id") or "") == active_run_id), None)
        active_run = active_run or (legacy_runs[0] if legacy_runs else None)
    return {
        **{key: value for key, value in detail.items() if key not in {"model_messages", "turn_receipts"}},
        "agent_tasks": [agent_v3_store.public_task(task) for task in tasks],
        "pending_approvals": agent_v3_store.list_approvals_for_conversation(conversation_id, pending_only=True),
        "active_run": active_run,
        "runs": runs,
    }


@router.patch("/conversations/{conversation_id}")
def agent_rename_conversation(conversation_id: str, body: AgentConversationUpdateRequest) -> dict:
    return conversation_store.rename(conversation_id, body.title)


@router.delete("/conversations/{conversation_id}")
def agent_delete_conversation(conversation_id: str) -> dict:
    return agent_v3_runtime.delete_conversation(conversation_id)


@router.post("/v3/conversations/{conversation_id}/turns")
def agent_v3_create_turn(conversation_id: str, body: AgentTurnRequest) -> dict:
    return agent_v3_runtime.run_turn(
        conversation_id,
        body.message,
        body.metadata.model_dump(exclude_none=True),
        body.client_turn_id,
    )


@router.get("/v3/conversations/{conversation_id}/events")
def agent_v3_get_events(conversation_id: str, after: int = Query(default=0, ge=0)) -> list[dict]:
    return agent_v3_store.list_events(conversation_id, after)


@router.get("/v3/conversations/{conversation_id}/events/stream")
async def agent_v3_stream_events(
    conversation_id: str,
    after: int = Query(default=0, ge=0),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    try:
        resume_after = max(after, int(last_event_id or 0))
    except ValueError:
        resume_after = after

    async def stream():
        cursor = resume_after
        idle_rounds = 0
        while idle_rounds < 60:
            events = agent_v3_store.list_events(conversation_id, cursor)
            if events:
                idle_rounds = 0
                for event in events:
                    cursor = max(cursor, int(event.get("sequence") or 0))
                    yield f"id: {cursor}\nevent: agent-event\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
            else:
                idle_rounds += 1
                if idle_rounds % 10 == 0:
                    yield ": heartbeat\n\n"
            await asyncio.sleep(0.5)

    agent_v3_store.list_events(conversation_id, resume_after)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/v3/tasks/{task_id}")
def agent_v3_get_task(task_id: str) -> dict:
    return agent_v3_store.public_task(agent_v3_store.get_task(task_id))


@router.post("/v3/tasks/{task_id}/cancel")
def agent_v3_cancel_task(task_id: str) -> dict:
    return agent_v3_store.public_task(agent_v3_runtime.cancel_task(task_id))


@router.get("/v3/approvals/{approval_id}")
def agent_v3_get_approval(approval_id: str) -> dict:
    return agent_v3_store.get_approval(approval_id)


@router.post("/v3/approvals/{approval_id}/resolve")
def agent_v3_resolve_approval(approval_id: str, body: AgentApprovalRequest) -> dict:
    response = agent_v3_runtime.resolve_approval(approval_id, body.decision, body.comment)
    if isinstance(response.get("task"), dict):
        response["task"] = agent_v3_store.public_task(response["task"])
    return response


@router.get("/runs/{run_id}")
def agent_get_run(run_id: str) -> dict:
    run = agent_runtime_service.get_run(run_id)
    task = agent_v3_store.find_task_by_run_id(run_id)
    if task:
        run["conversation_id"] = task["conversation_id"]
    return run


@router.get("/runs/{run_id}/events")
def agent_get_run_events(run_id: str, after: int = Query(default=0, ge=0)) -> list[dict]:
    return agent_runtime_service.get_run_events(run_id, after)


@router.get("/runs/{run_id}/events/stream")
async def agent_stream_run_events(run_id: str, after: int = Query(default=0, ge=0)) -> StreamingResponse:
    async def stream():
        cursor = after
        idle_rounds = 0
        while idle_rounds < 60:
            events = agent_runtime_service.get_run_events(run_id, cursor)
            if events:
                idle_rounds = 0
                for event in events:
                    cursor = max(cursor, int(event.get("sequence") or 0))
                    yield f"id: {cursor}\nevent: run-event\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
            else:
                idle_rounds += 1
                if idle_rounds % 10 == 0:
                    yield ": heartbeat\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/runs/{run_id}/cancel")
def agent_cancel_run(run_id: str) -> dict:
    run = agent_runtime_service.get_run(run_id)
    linked_task = agent_v3_store.find_task_by_run_id(run_id)

    if linked_task:
        # V3 task status is authoritative.  The compatibility run endpoint may
        # delegate to it, but it may never mutate the underlying run alone.
        return agent_v3_store.public_task(agent_v3_runtime.cancel_task(str(linked_task["task_id"])))

    def cancel_linked_work() -> dict:
        cancelled_run = agent_runtime_service.cancel_run(run_id)
        return cancelled_run

    return agent_v3_runtime.run_legacy_operation(str(run["conversation_id"]), cancel_linked_work)


@router.get("/skills")
def agent_list_skills() -> list[dict]:
    return platform_client.list_skills()


@router.get("/status")
def agent_status() -> dict:
    platform = {
        "base_url": getattr(platform_client, "effective_base_url", getattr(platform_client, "base_url", "internal")),
        "reachable": False,
        "health_ok": False,
        "skill_registry_ok": False,
        "skill_count": 0,
        "last_error": None,
    }
    skills: list[dict] = []
    try:
        health = platform_client.health()
        platform["reachable"] = True
        platform["health_ok"] = bool(health.get("ok"))
    except Exception as exc:
        platform["last_error"] = str(getattr(exc, "detail", exc))
    try:
        skills = platform_client.list_skills()
        platform["reachable"] = True
        platform["skill_registry_ok"] = True
        platform["skill_count"] = len(skills)
    except Exception as exc:
        platform["last_error"] = str(getattr(exc, "detail", exc))
    try:
        agent_skills = agent_skill_service.list_skills()
    except Exception:
        agent_skills = []
    llm = llm_service.config()
    mode = service_mode()
    access_mode = getattr(platform_client, "platform_access_mode", "http")
    return {
        "agent": {
            "ok": True,
            "available": mode in {"combined", "agent"},
            "service": "general-agent",
            "runtime_version": "v3",
            "service_mode": mode,
            "platform_access_mode": access_mode,
        },
        "platform": platform,
        "skills": {
            "platform_skill_count": len(skills),
            "agent_skill_count": len(agent_skills),
            "enabled_skill_count": len([item for item in skills if item.get("skill_status") == "enabled"]),
        },
        "llm": {
            "enabled": llm["enabled"],
            "api_key_configured": llm["api_key_configured"],
            "configured": llm["api_key_configured"],
            "provider": llm["provider"],
            "model": llm["model"],
            "runtime_mode": "model_and_tools" if llm["enabled"] else "model_unavailable",
            "legacy_fallback_mode": "rule_based" if not llm["enabled"] else None,
        },
    }


@router.get("/skills/{skill_name}")
def agent_get_skill(skill_name: str) -> dict:
    return platform_client.get_skill(skill_name)


@router.get("/skills/{skill_name}/parameter-example")
def agent_skill_parameter_example(skill_name: str) -> dict:
    normalized_name = skill_name[4:] if skill_name.startswith("run_") else skill_name
    try:
        return agent_skill_service.parameter_example(normalized_name)
    except Exception:
        pass
    return agent_orchestrator.get_parameter_example(skill_name)


@router.post("/skills/{skill_name}/analyze-input")
def agent_analyze_skill_input(skill_name: str, body: dict) -> dict:
    return platform_client.analyze_input(skill_name, body.get("partial_parameters") or {})


@router.post("/skills/{skill_name}/run")
def agent_run_skill(skill_name: str, body: dict) -> dict:
    return platform_client.run_skill(skill_name, body.get("parameters") or {}, body.get("options") or {"mode": "sync", "explain": True})


@router.get("/invocations/{invocation_id}")
def agent_get_invocation(invocation_id: str) -> dict:
    return platform_client.get_invocation(invocation_id)


@router.get("/invocations")
def agent_list_invocations(skill: str | None = None, status: str | None = None) -> list[dict]:
    return platform_client.list_invocations({"skill": skill, "status": status})
