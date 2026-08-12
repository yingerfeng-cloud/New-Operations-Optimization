from __future__ import annotations

from copy import deepcopy
from typing import Any


RESULT_PRESENTATION_SCHEMA_VERSION = "1.0"


def _meaningful(value: Any) -> bool:
    if value is None or value == "":
        return False
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def build_result_views(result: dict[str, Any]) -> list[dict[str, str]]:
    """Compile model-neutral result views from the standard result contract."""
    views = [
        {"key": "overview", "label": "结果概览", "kind": "metrics", "source": "metrics"},
    ]
    business_output = result.get("business_output") if isinstance(result.get("business_output"), dict) else {}
    variables = result.get("business_variables") or result.get("variables") or result.get("variable_values")
    if _meaningful(variables):
        views.append({"key": "curves", "label": "变量曲线", "kind": "timeseries", "source": "variable_values"})
    if _meaningful(business_output):
        views.append({"key": "business_output", "label": "业务输出", "kind": "business_output", "source": "business_output"})
    constraint_data = result.get("constraints") or business_output.get("constraint_check")
    if _meaningful(constraint_data):
        views.append({"key": "constraints", "label": "约束检查", "kind": "constraint_checks", "source": "constraints"})
    if str(result.get("problem_type") or result.get("solver_type") or "").upper() == "NLP" and any(
        _meaningful(result.get(key))
        for key in ("termination_condition", "local_optimum_warning", "constraint_violation_summary")
    ):
        views.append({"key": "diagnostics", "label": "求解诊断", "kind": "solver_diagnostics", "source": "solver"})
    explanation = result.get("explanation_structured") or result.get("business_explanation") or result.get("explanation") or result.get("suggestion")
    if _meaningful(explanation):
        views.append({"key": "advice", "label": "业务建议", "kind": "explanation", "source": "business_explanation"})
    views.append({"key": "raw", "label": "原始结果", "kind": "raw", "source": "$"})
    return views


def apply_result_presentation(result: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(result)
    views = build_result_views(normalized)
    capabilities = [view["kind"] for view in views]
    metadata = dict(normalized.get("result_metadata") or {})
    metadata.update(
        {
            "capabilities": capabilities,
            "presentation_schema_version": RESULT_PRESENTATION_SCHEMA_VERSION,
            "views": deepcopy(views),
        }
    )
    normalized["result_views"] = views
    normalized["result_capabilities"] = capabilities
    normalized["result_metadata"] = metadata
    return normalized
