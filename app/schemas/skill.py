from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ExplanationSource(BaseModel):
    """A typed, auditable pointer to a value used by an explanation metric."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["objective", "variable", "parameter", "result_metric"]
    key: str | None = None

    @model_validator(mode="after")
    def require_key_except_for_objective(self) -> "ExplanationSource":
        if self.kind != "objective" and not str(self.key or "").strip():
            raise ValueError(f"source key is required for {self.kind}")
        return self


class ExplanationVariableSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str
    name: str
    unit: str = ""
    dimensions: list[str] = Field(default_factory=list)
    role: str = "decision_variable"
    summary_functions: list[str] = Field(default_factory=list)
    description: str = ""


class ExplanationMetricSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str
    label: str
    source: ExplanationSource
    function: Literal[
        "identity",
        "sum_value",
        "min_value",
        "max_value",
        "avg_value",
        "non_zero_count",
        "range_value",
        "max_period",
    ] = "identity"
    unit: str = ""
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)


class ExplanationConstraintSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str
    name: str
    description: str = ""
    hard: bool = True
    relaxable: bool = False
    review_guidance: str = ""


class ExplanationRiskRule(BaseModel):
    """Declarative risk rule. Generated Skills never infer hidden thresholds."""

    model_config = ConfigDict(extra="allow")

    key: str
    metric_key: str
    operator: Literal["gt", "gte", "lt", "lte", "eq", "neq"]
    threshold: float | int | str | bool
    level: Literal["info", "low", "medium", "high", "critical"] = "medium"
    message: str


class ExplanationSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: str = "1.0"
    objective: dict[str, Any] = Field(default_factory=dict)
    variables: list[ExplanationVariableSpec] = Field(default_factory=list)
    metrics: list[ExplanationMetricSpec] = Field(default_factory=list)
    constraints: list[ExplanationConstraintSpec] = Field(default_factory=list)
    risk_rules: list[ExplanationRiskRule] = Field(default_factory=list)
    manual_review_points: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    narrative_guidance: dict[str, Any] = Field(default_factory=dict)


class SkillDefinition(BaseModel):
    """Versioned source of truth for an executable and explainable model Skill."""

    model_config = ConfigDict(extra="allow")

    schema_version: str = "1.0"
    revision: int = 1
    skill_name: str
    display_name: str
    description: str
    model_binding: dict[str, Any]
    input_schema: list[dict[str, Any]] = Field(default_factory=list)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    instructions: list[str] = Field(default_factory=list)
    trigger_examples: list[str] = Field(default_factory=list)
    non_trigger_examples: list[str] = Field(default_factory=list)
    parameter_questions: list[dict[str, Any]] = Field(default_factory=list)
    explanation_spec: ExplanationSpec
    execution_policy: dict[str, Any] = Field(default_factory=dict)
    generation: dict[str, Any] = Field(default_factory=dict)
    validation: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
