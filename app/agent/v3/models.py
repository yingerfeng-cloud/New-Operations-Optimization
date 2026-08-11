from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class TaskStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    WAITING_INPUT = "WAITING_INPUT"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class ToolCall(BaseModel):
    call_id: str = Field(min_length=1)
    name: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_-]+$")
    arguments: dict[str, Any] = Field(default_factory=dict)
    argument_error: str | None = None


class ModelTurn(BaseModel):
    content: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    provider_response_id: str | None = None


class ToolContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    conversation_id: str
    turn_id: str
    call_id: str
    task_id: str | None = None
    # The runtime, not the model, owns the exact user input associated with a
    # tool call.  Domain Skills must never have to trust a model-rewritten copy
    # of the request when extracting business parameters.
    user_message: str = ""
    preferred_skill: str | None = None


class AgentTurnMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preferred_skill: str | None = Field(default=None, max_length=200, pattern=r"^[A-Za-z0-9_.-]+$")


class AgentTurnRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20_000)
    metadata: AgentTurnMetadata = Field(default_factory=AgentTurnMetadata)
    client_turn_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


class AgentApprovalRequest(BaseModel):
    decision: Literal["approve", "reject"]
    comment: str | None = Field(default=None, max_length=2_000)
