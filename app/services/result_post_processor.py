from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from app.explainers.base import ADVISORY_DISCLAIMER
from app.explainers.evidence_builder import evidence_builder
from app.explainers.generic_explainer import generic_explainer
from app.explainers.llm_summarizer import llm_summarizer
from app.services.skill_definition_service import skill_definition_service
from app.storage.memory_store import STORE
from app.variable_contract import normalize_variables
from app.model_dimensions import extract_dimensions


class ResultPostProcessor:
    """Single post-processing path for task, API, Skill, and Agent results."""

    def process(
        self,
        *,
        result: dict[str, Any],
        model: dict[str, Any] | Any,
        skill_name: str | None = None,
        parameters: dict[str, Any] | None = None,
        parameter_sources: dict[str, str] | None = None,
        use_llm: bool = False,
    ) -> dict[str, Any]:
        output = deepcopy(result or {})
        definition, source = self._definition(model, skill_name)
        canonical_skill_name = skill_name or definition.get("skill_name")
        processor_fallback: dict[str, Any] | None = None
        try:
            evidence = evidence_builder.build(
                result=output,
                model=model,
                skill_name=canonical_skill_name,
                parameters=parameters or {},
                parameter_sources=parameter_sources or {key: "RUNTIME_VALUE" for key in (parameters or {})},
                explanation_spec=definition.get("explanation_spec") or {},
                skill_definition=definition,
            )
            deterministic = generic_explainer.explain(evidence)
        except Exception as exc:
            # Explanation enrichment is important, but can never invalidate or
            # hide an otherwise valid solver result.
            processor_fallback = {
                "used": True,
                "reason": f"EVIDENCE_PROCESSING_ERROR:{type(exc).__name__}",
            }
            evidence = self._minimal_evidence(
                result=output,
                model=model,
                skill_name=canonical_skill_name,
                definition=definition,
                parameters=parameters or {},
                parameter_sources=parameter_sources or {},
                reason=processor_fallback["reason"],
            )
            deterministic = generic_explainer.explain(evidence)
        explanation = deterministic
        llm_audit = {
            "enabled": False,
            "attempted": False,
            "fallback_used": False,
            "reason": "LLM_SUMMARY_NOT_REQUESTED",
        }
        if use_llm:
            from app.services.llm_service import llm_service

            explanation, llm_audit = llm_summarizer.summarize(
                evidence=evidence,
                generic_explanation=deterministic,
                profile=definition.get("explanation_spec") or {},
                enabled=True,
                generator=llm_service.summarize_evidence,
            )
        output.update(
            {
                "evidence_package": evidence,
                "explanation_structured": explanation,
                "business_explanation": explanation,
                "explanation_audit": {
                    "processor": "result_post_processor_v2",
                    "definition_source": source,
                    "skill_name": canonical_skill_name,
                    "skill_definition_revision": definition.get("revision"),
                    "skill_definition_hash": definition.get("definition_hash"),
                    "explanation_spec_version": (definition.get("explanation_spec") or {}).get("schema_version"),
                    "fallback": processor_fallback or {"used": False, "reason": None},
                    "llm": llm_audit,
                },
                "profile_name": evidence.get("model", {}).get("profile_name") or "generic",
                "disclaimer": ADVISORY_DISCLAIMER,
                "execution_policy": (definition.get("execution_policy") or {}).get("mode") or "advisory_only",
                "requires_human_review": bool((definition.get("execution_policy") or {}).get("requires_human_review", True)),
            }
        )
        output["explanation"] = explanation.get("summary") or ""
        return output

    def _minimal_evidence(
        self,
        *,
        result: dict[str, Any],
        model: dict[str, Any] | Any,
        skill_name: str | None,
        definition: dict[str, Any],
        parameters: dict[str, Any],
        parameter_sources: dict[str, str],
        reason: str,
    ) -> dict[str, Any]:
        status = str(result.get("status") or result.get("solver_status") or "unknown").lower()
        return {
            "evidence_schema_version": "2.0",
            "solver": {
                "status": status,
                "termination_condition": result.get("termination_condition") or status,
                "objective_value": result.get("objective_value"),
                "solver_name": result.get("solver_name") or result.get("solver") or "unknown",
                "error": result.get("error") or result.get("message"),
            },
            "model": {
                "model_id": self._field(model, "id") or self._field(model, "model_id"),
                "model_version": self._field(model, "version"),
                "skill_name": skill_name,
                "profile_name": "generic",
                "skill_definition_revision": definition.get("revision"),
                "skill_definition_hash": definition.get("definition_hash"),
                "explanation_spec_version": (definition.get("explanation_spec") or {}).get("schema_version"),
                "objective": (definition.get("explanation_spec") or {}).get("objective") or {},
            },
            "inputs_summary": {
                "parameters": deepcopy(parameters),
                "parameter_sources": dict(parameter_sources),
                "missing_params": [],
            },
            "variables_summary": [],
            "constraint_checks": [],
            "derived_metrics": {},
            "risk_notes": [],
            "manual_review_points": ["结果解释降级，请人工复核原始求解结果与模型契约。"],
            "data_quality_notes": [],
            "explanation_limits": [f"证据化后处理已安全降级：{reason}"],
            "evidence_index": {
                "solver": ["solver.status", "solver.termination_condition", "solver.objective_value"],
                "variables": [],
                "constraints": [],
                "metrics": [],
            },
        }

    def _definition(self, model: dict[str, Any] | Any, skill_name: str | None) -> tuple[dict[str, Any], str]:
        model_id = self._field(model, "id") or self._field(model, "model_id")
        with STORE.lock:
            if skill_name:
                record = deepcopy(STORE.skills.get(skill_name) or {})
                binding = (record.get("definition") or {}).get("model_binding") or {}
                if (
                    isinstance(record.get("definition"), dict)
                    and (not model_id or str(binding.get("model_id") or record.get("model_id") or "") == str(model_id))
                ):
                    return record["definition"], "persisted_skill"
            for record in STORE.skills.values():
                if str(record.get("model_id") or "") == str(model_id or "") and isinstance(record.get("definition"), dict):
                    return deepcopy(record["definition"]), "persisted_model_skill"
        input_schema, output_schema = self._schemas(model)
        generated_skill_name = skill_name or self._generated_skill_name(model)
        try:
            definition = skill_definition_service.compile(
                model=model,
                skill_name=generated_skill_name,
                input_schema=input_schema,
                output_schema=output_schema,
                revision=1,
                use_llm=False,
            )
            return definition, "ephemeral_contract_compiler"
        except Exception as exc:
            return self._fallback_definition(generated_skill_name, output_schema, exc), "safe_fallback_definition"

    def _fallback_definition(
        self,
        skill_name: str,
        output_schema: dict[str, Any],
        error: Exception,
    ) -> dict[str, Any]:
        variables = [
            {
                "key": str(item.get("key")),
                "name": str(item.get("name") or item.get("key")),
                "unit": str(item.get("unit") or ""),
                "dimensions": list(item.get("dimension") or []),
            }
            for item in output_schema.get("variables") or []
            if isinstance(item, dict) and item.get("key")
        ]
        return {
            "schema_version": "safe-fallback",
            "revision": None,
            "skill_name": skill_name,
            "definition_hash": None,
            "explanation_spec": {
                "schema_version": "safe-fallback",
                "objective": {"key": "objective_value", "name": "目标函数"},
                "variables": variables,
                "metrics": [{"key": "objective_value", "label": "目标函数", "source": {"kind": "objective", "key": None}, "function": "identity", "unit": ""}],
                "constraints": [],
                "risk_rules": [],
                "manual_review_points": ["复核输入、求解状态和约束证据后再使用结果。"],
                "limitations": [f"SkillDefinition 编译失败，当前仅提供基础证据解释：{type(error).__name__}"],
            },
            "execution_policy": {"mode": "advisory_only", "requires_human_review": True},
        }

    def _schemas(self, model: dict[str, Any] | Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        explicit_input = self._field(model, "input_schema")
        explicit_output = self._field(model, "output_schema")
        semantic = self._field(model, "semantic_spec") or (model if isinstance(model, dict) else {}) or {}
        if isinstance(explicit_input, list):
            input_schema = deepcopy(explicit_input)
        else:
            input_schema = []
            for raw in semantic.get("parameters") or []:
                if not isinstance(raw, dict):
                    continue
                key = raw.get("math_param") or raw.get("code") or raw.get("key") or raw.get("name")
                if not key:
                    continue
                validation = raw.get("validation") or {}
                dimensions = list(raw.get("dimension") or raw.get("dimensions") or [])
                input_schema.append({
                    "key": str(key),
                    "name": str(raw.get("name") or key),
                    "dimension": dimensions,
                    "type": validation.get("type") or ("number" if not dimensions else "dict"),
                    "unit": str(raw.get("unit") or ""),
                    "required": bool(validation.get("required", raw.get("required", True))),
                    "description": str(raw.get("description") or raw.get("meaning") or ""),
                    "validation": deepcopy(validation),
                })
        if isinstance(explicit_output, dict):
            output_schema = deepcopy(explicit_output)
        else:
            output_schema = {
                "objective_value": "number",
                "variables": [
                    {
                        "key": str(raw.get("math_var") or raw.get("code") or raw.get("key") or raw.get("name")),
                        "name": str(raw.get("name") or raw.get("math_var") or raw.get("code") or raw.get("key")),
                        "dimension": extract_dimensions(raw),
                        "unit": str(raw.get("unit") or ""),
                    }
                    for raw in normalize_variables(semantic.get("variables") or [])
                    if isinstance(raw, dict) and (raw.get("math_var") or raw.get("code") or raw.get("key") or raw.get("name"))
                ],
                "explanation_structured": "object",
                "evidence_package": "object",
            }
        return input_schema, output_schema

    def _generated_skill_name(self, model: dict[str, Any] | Any) -> str:
        semantic = self._field(model, "semantic_spec") or (model if isinstance(model, dict) else {}) or {}
        code = semantic.get("skill_code") or semantic.get("model_code") or semantic.get("code") or self._field(model, "id") or "model"
        normalized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(code).lower()).strip("_") or "model"
        return f"run_{normalized}"

    def _field(self, model: dict[str, Any] | Any, name: str) -> Any:
        return model.get(name) if isinstance(model, dict) else getattr(model, name, None)


result_post_processor = ResultPostProcessor()
