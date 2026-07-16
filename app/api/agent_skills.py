from __future__ import annotations

from fastapi import APIRouter

from app.services.agent_skill_service import agent_skill_service

router = APIRouter(prefix="/api/agent/agent-skills", tags=["agent-skills"])


@router.get("")
def list_agent_skills() -> list[dict]:
    return agent_skill_service.list_skills()


@router.get("/{name}")
def get_agent_skill(name: str) -> dict:
    return agent_skill_service.get_skill(name)


@router.get("/{name}/parameter-example")
def get_parameter_example(name: str) -> dict:
    return agent_skill_service.parameter_example(name)


@router.post("/{name}/sync-schema")
def sync_schema(name: str) -> dict:
    return agent_skill_service.sync_schema(name)


@router.post("/{name}/validate")
def validate_agent_skill(name: str) -> dict:
    return agent_skill_service.validate_skill(name)


@router.post("/{name}/enable")
def enable_agent_skill(name: str) -> dict:
    return agent_skill_service.set_state(name, "enabled")


@router.post("/{name}/disable")
def disable_agent_skill(name: str) -> dict:
    return agent_skill_service.set_state(name, "disabled")


@router.post("/{name}/dry-run")
def dry_run(name: str, body: dict) -> dict:
    return agent_skill_service.dry_run(name, body)


@router.post("/{name}/dry-run-request")
def dry_run_request(name: str, body: dict) -> dict:
    return agent_skill_service.dry_run_request(name, body)


@router.post("/{name}/dry-run-dialog")
def dry_run_dialog(name: str, body: dict) -> dict:
    return agent_skill_service.dry_run_dialog(name, body)
