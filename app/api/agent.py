from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.agent.conversation_store import conversation_store
from app.agent.orchestrator import agent_orchestrator
from app.agent.platform_client import platform_client
from app.agent.platform_gateway import service_mode
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
    return agent_runtime_service.analyze(body.to_payload())


@router.post("/confirm-invoke")
def agent_confirm_invoke(body: AgentConfirmInvokeRequest) -> dict:
    return agent_runtime_service.confirm_invoke(body.to_payload())


@router.post("/confirm-defaults")
def agent_confirm_defaults(body: AgentConfirmDefaultsRequest) -> dict:
    return agent_runtime_service.confirm_defaults(body.to_payload())


@router.post("/apply-sample-parameters")
def agent_apply_sample_parameters(body: AgentApplySampleParametersRequest) -> dict:
    return agent_runtime_service.apply_sample_parameters(body.to_payload())


@router.post("/explain-result")
def agent_explain_result(body: AgentExplainResultRequest) -> dict:
    return agent_runtime_service.explain_result(body.to_payload())


@router.post("/conversations")
def agent_create_conversation(body: AgentConversationCreateRequest | None = None) -> dict:
    return conversation_store.create(body.title if body else None)


@router.get("/conversations")
def agent_list_conversations() -> list[dict]:
    return agent_runtime_service.conversation_list()


@router.get("/conversations/{conversation_id}")
def agent_get_conversation(conversation_id: str) -> dict:
    return agent_runtime_service.conversation_detail(conversation_id)


@router.patch("/conversations/{conversation_id}")
def agent_rename_conversation(conversation_id: str, body: AgentConversationUpdateRequest) -> dict:
    return conversation_store.rename(conversation_id, body.title)


@router.delete("/conversations/{conversation_id}")
def agent_delete_conversation(conversation_id: str) -> dict:
    return conversation_store.delete(conversation_id)


@router.get("/runs/{run_id}")
def agent_get_run(run_id: str) -> dict:
    return agent_runtime_service.get_run(run_id)


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
    return agent_runtime_service.cancel_run(run_id)


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
            "service": "optimization-agent",
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
            "fallback_mode": "llm" if llm["enabled"] else "rule_based",
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
