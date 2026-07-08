from __future__ import annotations

from fastapi import APIRouter

from app.agent.conversation_store import conversation_store
from app.agent.orchestrator import agent_orchestrator
from app.agent.platform_client import platform_client
from app.agent.platform_gateway import service_mode
from app.services.agent_service import AgentOptimizeRequest
from app.services.agent_skill_service import agent_skill_service
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/optimize")
def agent_optimize(req: AgentOptimizeRequest) -> dict:
    return agent_orchestrator.optimize_legacy(req)


@router.post("/analyze")
def agent_analyze(body: dict) -> dict:
    return agent_orchestrator.analyze(body)


@router.post("/confirm-invoke")
def agent_confirm_invoke(body: dict) -> dict:
    return agent_orchestrator.confirm_invoke(body)


@router.post("/confirm-defaults")
def agent_confirm_defaults(body: dict) -> dict:
    return agent_orchestrator.confirm_defaults(body)


@router.post("/apply-sample-parameters")
def agent_apply_sample_parameters(body: dict) -> dict:
    return agent_orchestrator.apply_sample_parameters(body)


@router.post("/explain-result")
def agent_explain_result(body: dict) -> dict:
    return agent_orchestrator.explain_result(body)


@router.post("/conversations")
def agent_create_conversation(body: dict | None = None) -> dict:
    return conversation_store.create((body or {}).get("title"))


@router.get("/conversations")
def agent_list_conversations() -> list[dict]:
    return conversation_store.list()


@router.get("/conversations/{conversation_id}")
def agent_get_conversation(conversation_id: str) -> dict:
    return conversation_store.get(conversation_id)


@router.patch("/conversations/{conversation_id}")
def agent_rename_conversation(conversation_id: str, body: dict) -> dict:
    return conversation_store.rename(conversation_id, body.get("title") or "")


@router.delete("/conversations/{conversation_id}")
def agent_delete_conversation(conversation_id: str) -> dict:
    return conversation_store.delete(conversation_id)


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
