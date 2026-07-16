from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class AgentSkillState(str, Enum):
    NOT_CREATED = "not_created"
    DRAFT = "draft"
    VALID = "valid"
    ENABLED = "enabled"
    DISABLED = "disabled"
    INVALID = "invalid"
    DEPRECATED = "deprecated"


class RequiredDataItem(BaseModel):
    name: str
    label: str | None = None
    input_modes: list[str] = Field(default_factory=lambda: ["chat", "json", "form"])
    ask_when_missing: str | None = None
    required: bool = True


class ParameterPolicy(BaseModel):
    allow_defaults: bool = True
    require_default_confirmation: bool = True
    allow_sample_data: bool = True
    sample_data_must_be_confirmed: bool = True
    preferred_input_modes: list[str] = Field(default_factory=lambda: ["excel", "json", "form", "chat"])


class IntentPolicy(BaseModel):
    router_mode: str = "llm_plus_rules"
    confidence_threshold: float = 0.75
    clarify_threshold: float = 0.60
    clarify_when_top_scores_close: bool = True
    top_score_margin_threshold: float = 0.15


class ExecutionPolicy(BaseModel):
    advisory_only: bool = True
    requires_human_review: bool = True
    requires_invoke_confirmation: bool = True


class SafetyPolicy(BaseModel):
    disallow_auto_control: bool = True
    disclaimer_required: bool = True


class AgentSkillV2(BaseModel):
    schema_version: str = "2.0"
    agent_skill_name: str
    platform_skill_name: str
    display_name: str
    state: AgentSkillState = AgentSkillState.DRAFT
    business_domain: dict[str, Any]
    model_family: str = "optimization"
    supported_intents: list[str]
    business_goals: list[str]
    positive_examples: list[str]
    negative_examples: list[str]
    do_not_invoke_examples: list[str]
    required_data: list[RequiredDataItem]
    parameter_policy: ParameterPolicy = Field(default_factory=ParameterPolicy)
    intent_policy: IntentPolicy = Field(default_factory=IntentPolicy)
    execution_policy: ExecutionPolicy = Field(default_factory=ExecutionPolicy)
    explanation_profile: str = "generic"
    safety_policy: SafetyPolicy = Field(default_factory=SafetyPolicy)

    @model_validator(mode="after")
    def validate_v2_contract(self) -> "AgentSkillV2":
        if self.schema_version != "2.0":
            raise ValueError("schema_version must be 2.0")
        if not self.business_domain.get("primary"):
            raise ValueError("business_domain.primary is required")
        if not self.supported_intents:
            raise ValueError("supported_intents must not be empty")
        if not self.positive_examples or not self.negative_examples or not self.do_not_invoke_examples:
            raise ValueError("positive, negative and do_not_invoke examples are required")
        return self


def normalize_agent_skill_v2(
    metadata: dict[str, Any],
    input_schema: list[dict[str, Any]],
    examples: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the v2 contract while keeping v1 packages readable during migration."""

    examples = examples or {}
    name = str(metadata.get("agent_skill_name") or metadata.get("name") or "")
    platform_name = str(metadata.get("platform_skill_name") or metadata.get("canonical_api_skill_name") or f"run_{name}")
    raw_state = metadata.get("state") or metadata.get("status")
    if raw_state not in {item.value for item in AgentSkillState}:
        raw_state = "enabled" if metadata.get("enabled", True) else "disabled"
    positive = _example_texts(metadata.get("positive_examples") or examples.get("positive_examples"))
    negative = _example_texts(metadata.get("negative_examples") or examples.get("negative_examples"))
    do_not = _example_texts(metadata.get("do_not_invoke_examples") or examples.get("do_not_invoke_examples"))
    if not negative:
        negative = _example_texts(metadata.get("non_trigger_intents")) or ["介绍一下相关业务知识"]
    if not do_not:
        do_not = negative or ["只做知识咨询，不运行优化"]
    if not positive:
        positive = _example_texts(metadata.get("trigger_intents")) or [f"运行{name}优化"]

    domain = metadata.get("business_domain")
    if not isinstance(domain, dict):
        domain = {
            "primary": str(metadata.get("domain") or name or "optimization"),
            "secondary": list(metadata.get("scenario_tags") or metadata.get("tags") or []),
        }
    required_names = set(metadata.get("required_parameters") or [])
    required_data = metadata.get("required_data")
    if not isinstance(required_data, list) or not required_data or not isinstance(required_data[0], dict):
        required_data = [
            {
                "name": str(item.get("key")),
                "label": item.get("name") or item.get("key"),
                "input_modes": ["chat", "json", "excel"] if item.get("dimension") else ["chat", "json", "form"],
                "ask_when_missing": f"请提供{item.get('name') or item.get('key')}。",
                "required": bool(item.get("required", item.get("key") in required_names)),
            }
            for item in input_schema
            if item.get("key") and bool(item.get("required", item.get("key") in required_names))
        ]

    execution = metadata.get("execution_policy") or {}
    if "mode" in execution:
        execution = {
            "advisory_only": execution.get("mode") == "advisory_only",
            "requires_human_review": True,
            "requires_invoke_confirmation": not bool(execution.get("allow_auto_invoke", False)),
        }
    payload = {
        **metadata,
        "schema_version": "2.0",
        "agent_skill_name": name,
        "platform_skill_name": platform_name,
        "display_name": str(metadata.get("display_name") or name),
        "state": raw_state,
        "business_domain": domain,
        "model_family": str(metadata.get("model_family") or "optimization"),
        "supported_intents": list(metadata.get("supported_intents") or ["optimization_run", "parameter_check", "result_explanation"]),
        "business_goals": list(metadata.get("business_goals") or metadata.get("scenario_tags") or ["optimize"]),
        "positive_examples": positive,
        "negative_examples": negative,
        "do_not_invoke_examples": do_not,
        "required_data": required_data,
        "parameter_policy": metadata.get("parameter_policy") or ParameterPolicy().model_dump(),
        "intent_policy": metadata.get("intent_policy") or IntentPolicy().model_dump(),
        "execution_policy": execution or ExecutionPolicy().model_dump(),
        "explanation_profile": str(metadata.get("explanation_profile") or name or "generic"),
        "safety_policy": metadata.get("safety_policy") or SafetyPolicy().model_dump(),
    }
    return AgentSkillV2.model_validate(payload).model_dump(mode="json")


def _example_texts(values: Any) -> list[str]:
    output: list[str] = []
    for item in values or []:
        if isinstance(item, str):
            output.append(item)
        elif isinstance(item, dict):
            text = item.get("user") or item.get("text") or item.get("utterance")
            if text:
                output.append(str(text))
    return output
