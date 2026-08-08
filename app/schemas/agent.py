from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AgentRequestModel(BaseModel):
    model_config = ConfigDict(extra="allow")

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class AgentAnalyzeRequest(AgentRequestModel):
    conversation_id: str | None = None
    message: str = ""
    text: str | None = None
    agent_skill_name: str | None = None
    skill_name: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    confirm_defaults: bool | None = None
    use_defaults: bool | None = None


class AgentConfirmInvokeRequest(AgentRequestModel):
    conversation_id: str
    run_id: str | None = None
    idempotency_key: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    mode: str = "sync"


class AgentConfirmDefaultsRequest(AgentRequestModel):
    conversation_id: str
    run_id: str | None = None
    agent_skill_name: str | None = None


class AgentApplySampleParametersRequest(AgentConfirmDefaultsRequest):
    api_skill_name: str | None = None
    sample_parameters: dict[str, Any] = Field(default_factory=dict)


class AgentExplainResultRequest(AgentRequestModel):
    conversation_id: str
    run_id: str | None = None


class AgentConversationCreateRequest(AgentRequestModel):
    title: str | None = None


class AgentConversationUpdateRequest(AgentRequestModel):
    title: str

