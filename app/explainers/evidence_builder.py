from __future__ import annotations

from typing import Any
from copy import deepcopy
from app.services.result_interpreter import result_interpreter
from app.variable_contract import normalize_variables
from app.model_dimensions import extract_dimensions

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
        explanation_spec: dict[str, Any] | None = None,
        skill_definition: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        metadata = dict(skill_metadata or {})
        definition = dict(skill_definition or {})
        declared_explanation = dict(explanation_spec or definition.get("explanation_spec") or {})
        model_spec = self._model_spec(model)
        tags = metadata.get("tags") or model_spec.get("tags") or model_spec.get("scenario_tags") or []
        metadata.setdefault("tags", tags)
        metadata.setdefault("model_family", model_spec.get("model_family"))
        profile = profile_loader.match(metadata)
        explanation_policy = declared_explanation or dict(profile or {})

        variables = result.get("variable_values") or (result.get("result") or {}).get("variable_values") or {}
        variable_schema = {
            item["key"]: item
            for item in normalize_variables(model_spec.get("variables") or [])
        }
        for item in declared_explanation.get("variables") or []:
            if item.get("key"):
                key = str(item["key"])
                variable_schema[key] = {**variable_schema.get(key, {}), **item}
        variable_summaries = [
            self._variable_summary(name, values, variable_schema.get(str(name), {}))
            for name, values in variables.items()
        ]
        context = self._metric_context(variables, result, parameters or {})
        metrics, metric_limits = metric_engine.compute_with_diagnostics(explanation_policy, context)
        risk_context = {**context, **{key: item.get("value") for key, item in metrics.items()}}
        risks, risk_limits = risk_rule_engine.evaluate_with_diagnostics(explanation_policy, risk_context)
        checks = constraint_analyzer.analyze(result)
        risks.extend(self._constraint_risks(checks))
        if result.get("local_optimum_warning"):
            risks.append({
                "key": "local_optimum_warning",
                "name": "局部最优提示",
                "level": "medium",
                "message": "求解器结果带有局部最优提示，不应解读为全局最优保证。",
                "evidence_ref": "solver.local_optimum_warning",
            })

        status = str(result.get("status") or result.get("solver_status") or "unknown").lower()
        error = result.get("error") or result.get("message")
        limitations: list[str] = []
        if status not in {"success", "optimal", "feasible", "completed"}:
            limitations.append("本次求解未形成可直接采用的有效优化方案。")
        if not checks:
            limitations.append("结果未返回可核验的约束检查明细。")
        objective = declared_explanation.get("objective") or {}
        business_outcomes = result_interpreter.business_evidence(model_spec, variables) if status in {"success", "optimal", "feasible", "completed"} else {}
        return {
            "evidence_schema_version": "2.0",
            "solver": {
                "status": status,
                "termination_condition": result.get("termination_condition") or status,
                "objective_value": result.get("objective_value"),
                "solver_name": result.get("solver_name") or result.get("solver") or "unknown",
                "error": error,
                "problem_type": result.get("problem_type") or result.get("solver_type"),
                "local_optimum_warning": bool(result.get("local_optimum_warning", False)),
                "constraint_violation_summary": result.get("constraint_violation_summary"),
            },
            "model": {
                "model_id": self._field(model, "id") or model_spec.get("model_id"),
                "model_version": self._field(model, "version") or model_spec.get("version"),
                "skill_name": skill_name,
                "schema_version": model_spec.get("schema_version") or "unknown",
                "profile_name": (profile or {}).get("profile_name") or "generic",
                "skill_definition_revision": definition.get("revision"),
                "skill_definition_hash": definition.get("definition_hash"),
                "explanation_spec_version": declared_explanation.get("schema_version") or "default-profile",
                "objective": objective,
                "execution_policy": (definition.get("execution_policy") or {}).get("mode") or "advisory_only",
                "requires_human_review": bool((definition.get("execution_policy") or {}).get("requires_human_review", True)),
            },
            "inputs_summary": {
                "parameters": dict(parameters or {}),
                "parameter_sources": dict(parameter_sources or {}),
                "missing_params": [],
            },
            "variables_summary": variable_summaries,
            "constraint_checks": checks,
            "derived_metrics": metrics,
            "formatter": self._formatter_evidence(result, model_spec, status),
            "business_outcomes": business_outcomes,
            "risk_notes": risks,
            "manual_review_points": list(
                explanation_policy.get("manual_review_points")
                or ["复核关键输入、求解状态和约束边界后再用于业务决策。"]
            ),
            "data_quality_notes": list(result.get("data_quality_notes") or []),
            "explanation_limits": (
                limitations
                + metric_limits
                + risk_limits
                + list(explanation_policy.get("limitations") or explanation_policy.get("explanation_limits") or [])
            ),
            "evidence_index": {**self._evidence_index(variable_summaries, checks, metrics), "business_outcomes": [f"business_outcomes.{key}" for key in business_outcomes if key != "facts"]},
        }

    def _formatter_evidence(self, result: dict[str, Any], spec: dict[str, Any], status: str) -> dict[str, Any]:
        if status not in {"success", "optimal", "feasible", "completed"}:
            return {}
        # Reprocessing must retain the original deterministic formatter evidence.
        previous = (result.get("evidence_package") or {}).get("formatter")
        if isinstance(previous, dict):
            return deepcopy(previous)
        explanation = result.get("business_explanation") or {}
        if isinstance(explanation, dict) and explanation.get("grounded_on") == "evidence_package":
            explanation = {}
        declared = {
            str(item.get("key") or item.get("code")): item
            for source in (spec, spec.get("component_spec") or {})
            for item in (source.get("metrics_config") or {}).get("metrics") or []
        }
        return {
            "source": "SolveResultFormatter",
            "summary": str(explanation.get("summary") or "") if isinstance(explanation, dict) else str(explanation),
            "explanation": deepcopy(explanation),
            "metrics": {
                key: {"value": deepcopy(value), "unit": declared.get(key, {}).get("unit") or "", "label": declared.get(key, {}).get("name") or key, "source": f"result.metrics.{key}"}
                for key, value in (result.get("metrics") or {}).items()
            },
        }

    def _constraint_risks(self, checks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        risky_statuses = {"violated", "failed", "infeasible"}
        return [
            {
                "key": f"constraint_{item.get('key') or index + 1}_violation",
                "name": item.get("business_name") or item.get("name") or item.get("key"),
                "level": "high",
                "message": f"约束“{item.get('business_name') or item.get('name') or item.get('key')}”未满足，结果需修正或重新求解。",
                "evidence_ref": item.get("evidence_ref") or f"constraint_checks.{index}",
            }
            for index, item in enumerate(checks)
            if str(item.get("status") or "").lower() in risky_statuses
        ]

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
            numeric_items = [
                (key, value)
                for key, value in values.items()
                if isinstance(value, (int, float)) and not isinstance(value, bool)
            ]
            max_key = max(numeric_items, key=lambda item: item[1])[0] if numeric_items else None
        return {
            "name": name,
            "business_name": meta.get("name") or name,
            "unit": meta.get("unit") or "",
            "dimension": extract_dimensions(meta),
            "min": min(flat) if flat else None,
            "max": max(flat) if flat else None,
            "sum": round(sum(flat), 8) if flat else None,
            "non_zero_count": len([value for value in flat if abs(value) > 1e-9]),
            "max_period": max_key,
            "evidence_ref": f"variables_summary.{name}",
        }

    def _numbers(self, value: Any) -> list[float]:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return [float(value)]
        if isinstance(value, dict):
            output: list[float] = []
            for item in value.values():
                output.extend(self._numbers(item))
            return output
        if isinstance(value, (list, tuple)):
            output = []
            for item in value:
                output.extend(self._numbers(item))
            return output
        return []

    def _metric_context(
        self,
        variables: dict[str, Any],
        result: dict[str, Any],
        parameters: dict[str, Any],
    ) -> dict[str, Any]:
        objective_value = result.get("objective_value")
        context: dict[str, Any] = {"objective": objective_value, "objective_value": objective_value}
        for name, values in variables.items():
            flat = self._numbers(values)
            context[f"variable:{name}"] = values
            context[str(name)] = flat
            context[f"{name}_sum"] = sum(flat)
            context[f"{name}_max"] = max(flat) if flat else None
            context[f"{name}_min"] = min(flat) if flat else None
        for key, value in parameters.items():
            context[f"parameter:{key}"] = value
        for key, value in (result.get("metrics") or {}).items():
            if isinstance(value, (int, float, list, dict)) and not isinstance(value, bool):
                context[str(key)] = value
                context[f"result_metric:{key}"] = value
        return context

    def _evidence_index(
        self,
        variables: list[dict[str, Any]],
        constraints: list[dict[str, Any]],
        metrics: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "formatter": ["formatter.summary", "formatter.metrics"],
            "solver": [
                "solver.status",
                "solver.termination_condition",
                "solver.objective_value",
                "solver.local_optimum_warning",
                "solver.constraint_violation_summary",
            ],
            "variables": [item.get("evidence_ref") for item in variables if item.get("evidence_ref")],
            "constraints": [item.get("evidence_ref") for item in constraints if item.get("evidence_ref")],
            "metrics": [item.get("evidence_ref") for item in metrics.values() if item.get("evidence_ref")],
        }


evidence_builder = EvidenceBuilder()
