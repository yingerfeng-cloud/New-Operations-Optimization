from __future__ import annotations

from app.services.invocation_service import invocation_service
from app.services.skill_registry import skill_registry
from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["invocations"])


@router.post("/models/{model_id}/invoke")
def invoke_model(model_id: str, body: dict) -> dict:
    return invocation_service.invoke_model(model_id, body)


@router.get("/invocations/{invocation_id}")
def get_invocation(invocation_id: str) -> dict:
    return invocation_service.get_invocation(invocation_id)


@router.get("/invocations")
def list_invocations() -> list[dict]:
    return invocation_service.list_invocations()


@router.get("/skills")
def list_skills() -> list[dict]:
    return skill_registry.list_skills()


@router.get("/skills/{skill_name}")
def get_skill(skill_name: str) -> dict:
    return skill_registry.get_skill(skill_name)


@router.post("/skills/{skill_name}/analyze-input")
def analyze_skill_input(skill_name: str, body: dict) -> dict:
    return skill_registry.analyze_input(skill_name, body)


@router.post("/skills/{skill_name}/run")
def run_skill(skill_name: str, body: dict) -> dict:
    return skill_registry.run_skill(skill_name, body)


@router.post("/skills/{skill_name}/sync-schema")
def sync_skill_schema(skill_name: str) -> dict:
    return skill_registry.sync_schema(skill_name)


@router.get("/skills/{skill_name}/invocations")
def list_skill_invocations(skill_name: str) -> list[dict]:
    return skill_registry.list_invocations(skill_name)


@router.post("/skills/{skill_name}/create-agent-skill")
def create_agent_skill(skill_name: str, body: dict | None = None) -> dict:
    return skill_registry.create_agent_skill(skill_name, (body or {}).get("agent_skill_name"))


@router.post("/models/{model_id}/skills/generate")
def generate_model_skill(model_id: str) -> dict:
    return skill_registry.generate_skill(model_id)


@router.put("/skills/{skill_name}")
def update_skill(skill_name: str, body: dict) -> dict:
    return skill_registry.update_skill(skill_name, body)


@router.post("/skills/{skill_name}/enable")
def enable_skill(skill_name: str) -> dict:
    return skill_registry.enable_skill(skill_name)


@router.post("/skills/{skill_name}/disable")
def disable_skill(skill_name: str) -> dict:
    return skill_registry.disable_skill(skill_name)
