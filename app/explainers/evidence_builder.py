from __future__ import annotations

from typing import Any

from app.explainers.constraint_analyzer import constraint_analyzer
from app.explainers.metric_engine import metric_engine
from app.explainers.profile_loader import profile_loader
from app.explainers.risk_rule_engine import risk_rule_engine


class EvidenceBuilder:
    def build(
        self,
        *,
        result: dict[str, Any],
        model: dict[str, Any] | Any,
        skill_name: str | None,
        parameters: dict[str, Any] | None = None,
        parameter_sources: dict[str, str] | None = None,
        skill_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        metadata = dict(skill_metadata or {})
        model_spec = self._model_spec(model)
        tags = metadata.get("tags") or model_spec.get("tags") or model_spec.get("scenario_tags") or []
        metadata.setdefault("tags", tags)
        metadata.setdefault("model_family", model_spec.get("model_family"))
        profile = profile_loader.match(metadata)
        variables = result.get("variable_values") or (result.get("result") or {}).get("variable_values") or {}
        variable_schema = {str(item.get("math_var") or item.get("code") or item.get("key")): item for item in model_spec.get("variables") or []}
        variable_summaries = [self._variable_summary(name, values, variable_schema.get(str(name), {})) for name, values in variables.items()]
        context = self._metric_context(variables, result)
        metrics = metric_engine.compute(profile, context)
        risks = risk_rule_engine.evaluate(profile, {**context, **{key: item.get("value") for key, item in metrics.items()}})
        checks = constraint_analyzer.analyze(result)
        status = str(result.get("status") or result.get("solver_status") or "unknown").lower()
        error = result.get("error") or result.get("message")
        limitations = []
        if status not in {"success", "optimal", "feasible", "completed"}:
            limitations.append("本次求解未形成可直接采用的有效优化方案。")
        if not checks:
            limitations.append("结果未返回可核验的约束检查明细。")
        return {
            "evidence_schema_version": "1.0",
            "solver": {
                "status": status,
                "termination_condition": result.get("termination_condition") or status,
                "objective_value": result.get("objective_value"),
                "solver_name": result.get("solver_name") or result.get("solver") or "unknown",
                "error": error,
            },
            "model": {
                "model_id": self._field(model, "id") or model_spec.get("model_id"),
                "model_version": self._field(model, "version") or model_spec.get("version"),
                "skill_name": skill_name,
                "schema_version": model_spec.get("schema_version") or "unknown",
                "profile_name": (profile or {}).get("profile_name") or "generic",
            },
            "inputs_summary": {
                "parameters": dict(parameters or {}),
                "parameter_sources": dict(parameter_sources or {}),
                "missing_params": [],
            },
            "variables_summary": variable_summaries,
            "constraint_checks": checks,
            "derived_metrics": metrics,
            "risk_notes": risks,
            "manual_review_points": list((profile or {}).get("manual_review_points") or ["复核关键输入、求解状态和约束边界后再用于业务决策。"]),
            "data_quality_notes": list(result.get("data_quality_notes") or []),
            "explanation_limits": limitations + list((profile or {}).get("explanation_limits") or []),
        }

    def _model_spec(self, model: dict[str, Any] | Any) -> dict[str, Any]:
        if isinstance(model, dict):
            return dict(model.get("semantic_spec") or model)
        return dict(getattr(model, "semantic_spec", {}) or {})

    def _field(self, model: dict[str, Any] | Any, name: str) -> Any:
        return model.get(name) if isinstance(model, dict) else getattr(model, name, None)

    def _variable_summary(self, name: str, values: Any, meta: dict[str, Any]) -> dict[str, Any]:
        flat = self._numbers(values)
        max_key = None
        if isinstance(values, dict) and values:
            numeric_items = [(key, value) for key, value in values.items() if isinstance(value, (int, float))]
            max_key = max(numeric_items, key=lambda item: item[1])[0] if numeric_items else None
        return {
            "name": name,
            "business_name": meta.get("name") or name,
            "unit": meta.get("unit") or "",
            "dimension": list(meta.get("dimension") or []),
            "min": min(flat) if flat else None,
            "max": max(flat) if flat else None,
            "sum": round(sum(flat), 8) if flat else None,
            "non_zero_count": len([value for value in flat if abs(value) > 1e-9]),
            "max_period": max_key,
        }

    def _numbers(self, value: Any) -> list[float]:
        if isinstance(value, (int, float)): return [float(value)]
        if isinstance(value, dict):
            output: list[float] = []
            for item in value.values(): output.extend(self._numbers(item))
            return output
        if isinstance(value, list):
            output = []
            for item in value: output.extend(self._numbers(item))
            return output
        return []

    def _metric_context(self, variables: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
        context: dict[str, Any] = {"objective_value": result.get("objective_value") or 0}
        for name, values in variables.items():
            flat = self._numbers(values)
            context[str(name)] = flat
            context[f"{name}_sum"] = sum(flat)
            context[f"{name}_max"] = max(flat) if flat else 0
            context[f"{name}_min"] = min(flat) if flat else 0
        context.update({key: value for key, value in (result.get("metrics") or {}).items() if isinstance(value, (int, float, list, dict))})
        return context


evidence_builder = EvidenceBuilder()
