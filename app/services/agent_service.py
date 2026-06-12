from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.agent.orchestrator import agent_orchestrator


class AgentOptimizeRequest(BaseModel):
    scenario: str | None = None
    business_goal: str = ""
    runtime_parameters: dict[str, Any] = Field(default_factory=dict)
    explain: bool = True


class AgentService:
    def optimize(self, req: AgentOptimizeRequest) -> dict[str, Any]:
        return agent_orchestrator.optimize_legacy(req)


agent_service = AgentService()
