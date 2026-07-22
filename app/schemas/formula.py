from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class FormulaIndexScope(BaseModel):
    alias: str
    set: str


class FormulaAnalyzeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    formula: str = Field(min_length=1, max_length=20_000)
    formula_type: Literal["constraint", "objective", "expression"] = "constraint"
    participation: Literal["solve_active", "preview_only"] = "solve_active"
    ast_version: str = "1.0"
    formula_id: str | None = None
    objective_direction: Literal["minimize", "maximize"] | None = None
    scope: list[FormulaIndexScope] = Field(default_factory=list, max_length=16)
    symbols: dict[str, Any] = Field(default_factory=dict)
    model_context: dict[str, Any] = Field(default_factory=dict)
    sample_values: dict[str, Any] = Field(default_factory=dict)
