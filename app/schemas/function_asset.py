from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


FunctionType = Literal["piecewise_1d", "piecewise_2d", "piecewise_nd", "formula"]
SolveStrategy = Literal[
    "display_only",
    "convex_combination_lp",
    "binary_segment_milp",
    "segment_binary",
    "sos2",
    "triangulated_milp_exact",
    "convex_hull_lp_approx",
]


class FunctionAsset(BaseModel):
    function_id: str
    name: str
    function_type: FunctionType = "piecewise_1d"
    input_schema: list[dict[str, Any]] = Field(default_factory=list)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    group_keys: list[str] = Field(default_factory=list)
    interpolation: str = "linear"
    interpolation_mode: str = "segment_binary"
    out_of_domain_policy: Literal["reject", "clamp"] = "reject"
    allow_extrapolation: bool = False
    points: list[list[float]] = Field(default_factory=list)
    points_2d: list[list[float]] = Field(default_factory=list)
    triangles: list[list[int]] = Field(default_factory=list)
    surface_mode: str | None = None
    domain: dict[str, Any] = Field(default_factory=dict)
    x_domain: list[float] | None = None
    y_domain: list[float] | None = None
    z_range: list[float] | None = None
    triangulation_status: str | None = None
    surface_diagnostics: dict[str, Any] = Field(default_factory=dict)
    monotonicity: str | dict[str, Any] | None = None
    convexity: str | dict[str, Any] | None = None
    solve_strategy: SolveStrategy = "convex_combination_lp"
    status: str = "draft"
    description: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    validation_status: Literal["valid", "warning", "invalid"] = "valid"
    validation_errors: list[dict[str, Any]] = Field(default_factory=list)
    validation_warnings: list[dict[str, Any]] = Field(default_factory=list)
    referenced_by: list[dict[str, Any]] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None

    @field_validator("input_schema", mode="before")
    @classmethod
    def _coerce_input_schema(cls, value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list):
            return [dict(item) for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            if "code" in value:
                row = dict(value)
                row.setdefault("type", "number")
                return [row]
            return [
                {
                    "code": str(code),
                    "name": str(meta.get("name") or code) if isinstance(meta, dict) else str(code),
                    "unit": str(meta.get("unit") or "") if isinstance(meta, dict) else "",
                    "type": str(meta.get("type") or "number") if isinstance(meta, dict) else "number",
                }
                for code, meta in value.items()
            ]
        return []

    @field_validator("output_schema", mode="before")
    @classmethod
    def _coerce_output_schema(cls, value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            if "code" in value:
                row = dict(value)
                row.setdefault("type", "number")
                return row
            if len(value) == 1:
                code, meta = next(iter(value.items()))
                return {
                    "code": str(code),
                    "name": str(meta.get("name") or code) if isinstance(meta, dict) else str(code),
                    "unit": str(meta.get("unit") or "") if isinstance(meta, dict) else "",
                    "type": str(meta.get("type") or "number") if isinstance(meta, dict) else "number",
                }
        return {}
