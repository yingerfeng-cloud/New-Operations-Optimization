from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


BusinessScenario = Literal[
    "unit_commitment_day_ahead",
    "storage_dispatch",
    "renewable_storage_scheduling",
    "chp_dispatch",
    "cascade_hydro_dispatch",
]

VariableDomain = Literal["NonNegativeReals", "Reals", "Binary", "Integers", "NonNegativeIntegers"]
ObjectiveSense = Literal["minimize", "maximize"]
BuildMode = Literal["generic_linear", "template_based", "component_based", "domain_builder"]


class BusinessObject(BaseModel):
    code: str
    name: str
    object_type: str
    description: str = ""
    source_system: str = ""


class SetDefinition(BaseModel):
    code: str
    name: str
    dimension: str = "one_dimensional"
    values: list[Any] = Field(default_factory=list)
    source_system: str = ""


class RuntimeParameter(BaseModel):
    code: str
    name: str
    unit: str
    dimension: list[str] = Field(default_factory=list)
    source_system: str
    runtime_injected: bool = True
    validation: dict[str, Any] = Field(default_factory=dict)
    default: Any = None
    sample_value: Any = None
    description: str = ""


class DecisionVariable(BaseModel):
    code: str
    name: str
    unit: str = ""
    dimension: list[str] = Field(default_factory=list)
    domain: VariableDomain = "NonNegativeReals"
    lower_bound: float | None = None
    upper_bound: float | None = None
    description: str = ""

    @field_validator("code")
    @classmethod
    def reject_anonymous_variable(cls, value: str) -> str:
        if value.strip().lower() in {"x", "y", "z"}:
            raise ValueError("decision variable must carry business semantics")
        return value


class ConstraintTemplate(BaseModel):
    code: str
    name: str
    description: str
    hard: bool = True
    relaxable: bool = False
    expression: str
    indices: list[str] = Field(default_factory=list)


class ObjectiveTerm(BaseModel):
    variable: str
    coefficient_parameter: str | None = None
    weight: float = 1.0


class ObjectiveTemplate(BaseModel):
    code: str
    name: str
    sense: ObjectiveSense = "minimize"
    expression: str
    weights: dict[str, float] = Field(default_factory=dict)


class ModelTemplate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    code: str
    name: str
    scenario: BusinessScenario
    version: str = "v1.0"
    business_objects: list[BusinessObject] = Field(default_factory=list)
    sets: list[SetDefinition] = Field(default_factory=list)
    parameters: list[RuntimeParameter] = Field(default_factory=list)
    variables: list[DecisionVariable] = Field(default_factory=list)
    constraints: list[ConstraintTemplate] = Field(default_factory=list)
    objectives: list[ObjectiveTemplate] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ModelPackage(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    id: str | None = None
    template_id: str | None = None
    name: str
    scene: str
    version: str = "v0.1"
    status: str = "developing"
    solver: str = "HiGHS"
    problem_type: str = "MILP"
    objective: str | None = None
    time_granularity: str | None = None
    tags: list[str] = Field(default_factory=list)
    constraints: dict[str, bool] = Field(default_factory=dict)
    mapping_bindings: list[dict[str, Any]] = Field(default_factory=list)
    rule_configs: list[dict[str, Any]] = Field(default_factory=list)
    semantic_spec: dict[str, Any] = Field(default_factory=dict)
    generic_spec: dict[str, Any] = Field(default_factory=dict)
    build_mode: BuildMode = "generic_linear"
    component_spec: dict[str, Any] = Field(default_factory=dict)
    component_schema: dict[str, Any] = Field(default_factory=dict)
    model_draft: dict[str, Any] = Field(default_factory=dict)
    objective_config: dict[str, Any] = Field(default_factory=dict)
    draft_constraints: list[dict[str, Any]] = Field(default_factory=list)
    mathematical_expansion: dict[str, Any] = Field(default_factory=dict)
    model_problem_type: str = "LP"
    required_solver_capabilities: list[str] = Field(default_factory=lambda: ["LP"])
    ui_metadata: dict[str, Any] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)
    parameter_bindings: list[dict[str, Any]] = Field(default_factory=list)
    parameter_schema: dict[str, Any] = Field(default_factory=dict)
    input_contract: dict[str, Any] = Field(default_factory=dict)
    output_contract: dict[str, Any] = Field(default_factory=dict)
    validation_warnings: list[dict[str, Any]] = Field(default_factory=list)
    dry_run_result: dict[str, Any] = Field(default_factory=dict)
    tested_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    published_at: str | None = None


class ModelView(ModelPackage):
    id: str
    created_at: str
    updated_at: str


class AssetPackage(BaseModel):
    id: str | None = None
    asset_type: str
    name: str
    domain: str
    description: str
    status: str = "developing"
    note: str = ""
    created_at: str | None = None


class AssetView(AssetPackage):
    id: str
    created_at: str
