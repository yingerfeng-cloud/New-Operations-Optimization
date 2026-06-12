from __future__ import annotations

from typing import Any

from app.agent_skill_registry import agent_skill_registry


class AgentSkillService:
    def list_skills(self) -> list[dict[str, Any]]:
        return agent_skill_registry.list_skills()

    def get_skill(self, name: str) -> dict[str, Any]:
        return agent_skill_registry.get_skill(name)

    def get_skill_local(self, name: str) -> dict[str, Any]:
        return agent_skill_registry.get_skill_local(name)

    def validate_skill(self, name: str) -> dict[str, Any]:
        return agent_skill_registry.validate_skill(name)

    def sync_schema(self, name: str) -> dict[str, Any]:
        return agent_skill_registry.sync_schema(name)

    def parameter_example(self, name: str) -> dict[str, Any]:
        return agent_skill_registry.parameter_example(name)

    def dry_run(self, name: str, body: dict[str, Any]) -> dict[str, Any]:
        return agent_skill_registry.dry_run(name, body)

    def dry_run_request(self, name: str, body: dict[str, Any]) -> dict[str, Any]:
        return agent_skill_registry.dry_run_request(name, body)

    def dry_run_dialog(self, name: str, body: dict[str, Any]) -> dict[str, Any]:
        return agent_skill_registry.dry_run_dialog(name, body)


agent_skill_service = AgentSkillService()
