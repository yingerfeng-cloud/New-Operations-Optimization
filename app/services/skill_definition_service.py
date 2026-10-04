from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from typing import Any

from app.variable_contract import normalize_variables
from app.model_dimensions import extract_dimensions

from app.schemas.skill import SkillDefinition
from app.utils import now_text


SKILL_DEFINITION_SCHEMA_VERSION = "1.0"
EXPLANATION_SCHEMA_VERSION = "1.0"
SAFE_SUMMARY_FUNCTIONS = {
    "identity",
    "sum_value",
    "min_value",
    "max_value",
    "avg_value",
    "non_zero_count",
    "range_value",
    "max_period",
}


class SkillDefinitionService:
    """Compile and validate Skills solely from model-declared contracts.

    The compiler deliberately has no model-code, scenario, or business-field
    branches. Model semantics remain the source of truth; an LLM may only
    improve prose fields and its output is always optional and auditable.
    """

    def compile(
        self,
        *,
        model: Any,
        skill_name: str,
        input_schema: list[dict[str, Any]],
        output_schema: dict[str, Any],
        revision: int = 1,
        use_llm: bool = False,
    ) -> dict[str, Any]:
        timestamp = now_text()
        source_contract_hash = self.model_contract_hash(model, input_schema, output_schema)
        variables = self._declared_variables(model, output_schema)
        constraints = self._declared_constraints(model)
        objective = self._declared_objective(model)
        result_metrics = self._declared_result_metrics(model)
        parameter_questions = [
            {
                "parameter_key": str(item.get("key")),
                "question": self._parameter_question(item),
                "required": bool(item.get("required", True)),
            }
            for item in input_schema
            if item.get("key")
        ]
        explanation_spec = {
            "schema_version": EXPLANATION_SCHEMA_VERSION,
            "objective": objective,
            "variables": [
                {
                    "key": item["key"],
                    "name": item["name"],
                    "unit": item.get("unit") or "",
                    "dimensions": extract_dimensions(item),
                    "role": item.get("role") or "decision_variable",
                    "summary_functions": self._summary_functions(item),
                    "description": item.get("description") or "",
                }
                for item in variables
            ],
            "metrics": self._metrics(objective, variables, result_metrics),
            "constraints": [
                {
                    "key": item["key"],
                    "name": item["name"],
                    "description": item.get("description") or "",
                    "hard": bool(item.get("hard", True)),
                    "relaxable": bool(item.get("relaxable", False)),
                    "review_guidance": self._constraint_review_guidance(item),
                }
                for item in constraints
            ],
            # Thresholds are never guessed. A user may add declarative rules in
            # the editor or a future model contract may explicitly declare them.
            "risk_rules": self._declared_risk_rules(model, result_metrics),
            "manual_review_points": self._manual_review_points(model, constraints),
            "limitations": self._limitations(model),
            "narrative_guidance": {
                "fact_order": ["solver_status", "objective", "derived_metrics", "variables", "constraints"],
                "separate_facts_from_inferences": True,
                "require_evidence_references": True,
                "prohibit_unsupported_numbers": True,
            },
        }
        display_name = str(self._field(model, "name") or skill_name)
        scene = str(self._field(model, "scene") or "").strip()
        objective_name = str(objective.get("name") or objective.get("key") or "").strip()
        description = self._description(display_name, scene, objective_name)
        definition = {
            "schema_version": SKILL_DEFINITION_SCHEMA_VERSION,
            "revision": max(1, int(revision)),
            "skill_name": skill_name,
            "display_name": display_name,
            "description": description,
            "model_binding": {
                "policy": "fixed",
                "model_id": self._field(model, "id"),
                "model_version": self._field(model, "version"),
                "model_content_hash": self._field(model, "content_hash") or source_contract_hash,
            },
            "input_schema": deepcopy(input_schema),
            "output_schema": deepcopy(output_schema),
            "instructions": self._instructions(display_name, input_schema, objective_name),
            "trigger_examples": self._trigger_examples(display_name, scene, objective_name),
            "non_trigger_examples": self._non_trigger_examples(display_name),
            "parameter_questions": parameter_questions,
            "explanation_spec": explanation_spec,
            "execution_policy": self._execution_policy(model),
            "generation": {
                "mode": "deterministic_contract_compiler",
                "generated_at": timestamp,
                "llm": {
                    "requested": bool(use_llm),
                    "attempted": False,
                    "applied": False,
                    "fallback_used": False,
                    "reason": "NOT_REQUESTED" if not use_llm else "PENDING",
                },
                "source_contract_hash": source_contract_hash,
            },
            "validation": {},
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        if use_llm:
            definition = self._enhance_prose(definition)
        validation = self.validate(
            definition,
            model=model,
            expected_input_schema=input_schema,
            expected_output_schema=output_schema,
        )
        definition["validation"] = validation
        definition["definition_hash"] = self.definition_hash(definition)
        return SkillDefinition.model_validate(definition).model_dump(mode="json")

    def validate(
        self,
        definition: dict[str, Any],
        *,
        model: Any | None = None,
        expected_input_schema: list[dict[str, Any]] | None = None,
        expected_output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        errors: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        try:
            parsed = SkillDefinition.model_validate(definition)
        except Exception as exc:
            return {
                "status": "invalid",
                "score": 0,
                "errors": [{"code": "SCHEMA_INVALID", "path": "definition", "message": str(exc)}],
                "warnings": [],
                "validated_at": now_text(),
            }
        data = parsed.model_dump(mode="json")
        self._validate_unique_keys(data.get("input_schema") or [], "key", "input_schema", errors)
        self._validate_unique_keys((data.get("output_schema") or {}).get("variables") or [], "key", "output_schema.variables", errors)
        explanation = data.get("explanation_spec") or {}
        self._validate_unique_keys(explanation.get("variables") or [], "key", "explanation_spec.variables", errors)
        self._validate_unique_keys(explanation.get("metrics") or [], "key", "explanation_spec.metrics", errors)
        self._validate_unique_keys(explanation.get("constraints") or [], "key", "explanation_spec.constraints", errors)

        output_keys = {
            str(item.get("key"))
            for item in (data.get("output_schema") or {}).get("variables") or []
            if item.get("key")
        }
        parameter_keys = {str(item.get("key")) for item in data.get("input_schema") or [] if item.get("key")}
        explanation_variable_keys = {
            str(item.get("key"))
            for item in explanation.get("variables") or []
            if item.get("key")
        }
        question_keys = {
            str(item.get("parameter_key"))
            for item in data.get("parameter_questions") or []
            if isinstance(item, dict) and item.get("parameter_key")
        }
        for key in sorted(output_keys - explanation_variable_keys):
            errors.append({
                "code": "MISSING_EXPLANATION_VARIABLE",
                "path": "explanation_spec.variables",
                "message": f"Output variable has no explanation contract: {key}",
            })
        for key in sorted(explanation_variable_keys - output_keys):
            errors.append({
                "code": "UNKNOWN_EXPLANATION_VARIABLE",
                "path": "explanation_spec.variables",
                "message": f"Explanation variable is not declared by output_schema: {key}",
            })
        for key in sorted(parameter_keys - question_keys):
            errors.append({
                "code": "MISSING_PARAMETER_QUESTION",
                "path": "parameter_questions",
                "message": f"Input parameter has no generated collection question: {key}",
            })
        for key in sorted(question_keys - parameter_keys):
            errors.append({
                "code": "UNKNOWN_PARAMETER_QUESTION",
                "path": "parameter_questions",
                "message": f"Parameter question references an undeclared input: {key}",
            })
        configured_metric_keys = self._configured_result_metric_keys(model) if model is not None else None
        metric_keys = {str(item.get("key")) for item in explanation.get("metrics") or [] if item.get("key")}
        variable_metric_sources: set[str] = set()
        has_objective_metric = False
        for index, metric in enumerate(explanation.get("metrics") or []):
            source = metric.get("source") or {}
            source_kind = source.get("kind")
            source_key = str(source.get("key") or "")
            if source_kind == "objective":
                has_objective_metric = True
            elif source_kind == "variable" and source_key:
                variable_metric_sources.add(source_key)
            if metric.get("function") not in SAFE_SUMMARY_FUNCTIONS:
                errors.append({
                    "code": "UNSAFE_METRIC_FUNCTION",
                    "path": f"explanation_spec.metrics[{index}].function",
                    "message": f"Unsupported metric function: {metric.get('function')}",
                })
            if source_kind == "variable" and source_key not in output_keys:
                errors.append({
                    "code": "UNKNOWN_VARIABLE_SOURCE",
                    "path": f"explanation_spec.metrics[{index}].source.key",
                    "message": f"Variable source is not declared in output_schema: {source_key}",
                })
            elif source_kind == "parameter" and source_key not in parameter_keys:
                errors.append({
                    "code": "UNKNOWN_PARAMETER_SOURCE",
                    "path": f"explanation_spec.metrics[{index}].source.key",
                    "message": f"Parameter source is not declared in input_schema: {source_key}",
                })
            elif source_kind == "result_metric" and configured_metric_keys is not None and source_key not in configured_metric_keys:
                errors.append({
                    "code": "UNKNOWN_RESULT_METRIC_SOURCE",
                    "path": f"explanation_spec.metrics[{index}].source.key",
                    "message": f"Result metric is not declared by the model contract: {source_key}",
                })
        if not has_objective_metric:
            errors.append({
                "code": "MISSING_OBJECTIVE_METRIC",
                "path": "explanation_spec.metrics",
                "message": "A complete Skill must expose the solver objective as evidence.",
            })
        for key in sorted(output_keys - variable_metric_sources):
            errors.append({
                "code": "UNEXPLAINED_OUTPUT_VARIABLE",
                "path": "explanation_spec.metrics",
                "message": f"Output variable has no evidence metric: {key}",
            })
        for index, rule in enumerate(explanation.get("risk_rules") or []):
            if str(rule.get("metric_key") or "") not in metric_keys:
                errors.append({
                    "code": "UNKNOWN_RISK_METRIC",
                    "path": f"explanation_spec.risk_rules[{index}].metric_key",
                    "message": "Risk rules must reference a declared explanation metric.",
                })
        binding = data.get("model_binding") or {}
        if binding.get("policy") != "fixed":
            errors.append({"code": "INVALID_BINDING_POLICY", "path": "model_binding.policy", "message": "Generated Skills must use a fixed, versioned model binding."})
        if model is not None:
            if str(binding.get("model_id") or "") != str(self._field(model, "id") or ""):
                errors.append({"code": "MODEL_BINDING_MISMATCH", "path": "model_binding.model_id", "message": "Skill model binding does not match the target model."})
            if str(binding.get("model_version") or "") != str(self._field(model, "version") or ""):
                errors.append({"code": "MODEL_VERSION_MISMATCH", "path": "model_binding.model_version", "message": "Skill model version does not match the target model."})
            expected_hash = self._field(model, "content_hash")
            if not expected_hash and expected_input_schema is not None and expected_output_schema is not None:
                expected_hash = self.model_contract_hash(model, expected_input_schema, expected_output_schema)
            if expected_hash and str(binding.get("model_content_hash") or "") != str(expected_hash):
                errors.append({"code": "MODEL_CONTENT_HASH_MISMATCH", "path": "model_binding.model_content_hash", "message": "Skill model content hash does not match the target model."})
            declared_constraint_keys = {str(item.get("key")) for item in self._declared_constraints(model) if item.get("key")}
            explanation_constraint_keys = {
                str(item.get("key"))
                for item in explanation.get("constraints") or []
                if item.get("key")
            }
            for key in sorted(declared_constraint_keys - explanation_constraint_keys):
                errors.append({
                    "code": "MISSING_EXPLANATION_CONSTRAINT",
                    "path": "explanation_spec.constraints",
                    "message": f"Declared model constraint is missing from the explanation contract: {key}",
                })
            for key in sorted(explanation_constraint_keys - declared_constraint_keys):
                errors.append({
                    "code": "UNKNOWN_EXPLANATION_CONSTRAINT",
                    "path": "explanation_spec.constraints",
                    "message": f"Explanation constraint is not declared by the model contract: {key}",
                })
        if expected_input_schema is not None:
            if self._schema_signature(data.get("input_schema") or []) != self._schema_signature(expected_input_schema):
                errors.append({
                    "code": "INPUT_SCHEMA_CONTRACT_MISMATCH",
                    "path": "input_schema",
                    "message": "Skill input_schema must match the authoritative model invocation contract.",
                })
        if expected_output_schema is not None:
            actual_outputs = (data.get("output_schema") or {}).get("variables") or []
            expected_outputs = (expected_output_schema or {}).get("variables") or []
            if self._schema_signature(actual_outputs) != self._schema_signature(expected_outputs):
                errors.append({
                    "code": "OUTPUT_SCHEMA_CONTRACT_MISMATCH",
                    "path": "output_schema.variables",
                    "message": "Skill output_schema must match the authoritative model result contract.",
                })
        if model is not None and expected_input_schema is not None and expected_output_schema is not None:
            source_contract_hash = str((data.get("generation") or {}).get("source_contract_hash") or "")
            expected_contract_hash = self.model_contract_hash(model, expected_input_schema, expected_output_schema)
            if source_contract_hash != expected_contract_hash:
                errors.append({
                    "code": "SOURCE_CONTRACT_HASH_MISMATCH",
                    "path": "generation.source_contract_hash",
                    "message": "Skill was not generated from the current authoritative model contract.",
                })
        if not output_keys:
            warnings.append({"code": "NO_DECLARED_VARIABLES", "path": "output_schema.variables", "message": "No decision-variable output is declared; explanations will rely on status and objective evidence."})
        if not explanation.get("manual_review_points"):
            warnings.append({"code": "NO_MANUAL_REVIEW_POINTS", "path": "explanation_spec.manual_review_points", "message": "Add at least one manual review point."})
        total_checks = max(1, 5 + len(explanation.get("metrics") or []))
        score = max(0, round(100 * (total_checks - len(errors)) / total_checks))
        return {
            "status": "valid" if not errors else "invalid",
            "score": score,
            "errors": errors,
            "warnings": warnings,
            "validated_at": now_text(),
        }

    def _schema_signature(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        signature = [
            {
                "key": str(item.get("key") or ""),
                "type": str(item.get("type") or ""),
                "dimension": [str(value) for value in item.get("dimension") or item.get("dimensions") or []],
                "required": bool(item.get("required", True)),
            }
            for item in rows
            if isinstance(item, dict) and item.get("key")
        ]
        return sorted(signature, key=lambda item: item["key"])

    def definition_hash(self, definition: dict[str, Any]) -> str:
        payload = deepcopy(definition)
        payload.pop("definition_hash", None)
        payload.pop("validation", None)
        payload.pop("updated_at", None)
        generation = payload.get("generation")
        if isinstance(generation, dict):
            generation.pop("generated_at", None)
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def model_contract_hash(
        self,
        model: Any,
        input_schema: list[dict[str, Any]],
        output_schema: dict[str, Any],
    ) -> str:
        payload = {
            "model_id": self._field(model, "id"),
            "model_version": self._field(model, "version"),
            "model_content_hash": self._field(model, "content_hash"),
            "semantic_spec": self._field(model, "semantic_spec") or {},
            "generic_spec": self._field(model, "generic_spec") or {},
            "component_spec": self._field(model, "component_spec") or {},
            "input_contract": self._field(model, "input_contract") or {},
            "output_contract": self._field(model, "output_contract") or {},
            "input_schema": input_schema,
            "output_schema": output_schema,
        }
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def _enhance_prose(self, definition: dict[str, Any]) -> dict[str, Any]:
        from app.services.llm_service import llm_service

        audit = {
            "requested": True,
            "attempted": False,
            "applied": False,
            "fallback_used": False,
            "reason": "LLM_DISABLED",
            "provider": llm_service.config().get("provider"),
            "model": llm_service.config().get("model"),
        }
        if not llm_service.enabled():
            audit["fallback_used"] = True
            definition["generation"]["llm"] = audit
            return definition
        audit["attempted"] = True
        payload = {
            "task": "Improve only the human-facing prose of this generated optimization Skill.",
            "rules": [
                "Return JSON only.",
                "Do not add, remove, rename, or infer model fields, variables, metrics, constraints, thresholds, or calculations.",
                "Do not claim that an action was executed outside the platform.",
                "Keep the output domain-neutral and derived only from the supplied model contract.",
                "Every recommendation must require human review.",
            ],
            "allowed_output": {
                "description": "string",
                "instructions": ["string"],
                "trigger_examples": ["string"],
                "non_trigger_examples": ["string"],
                "manual_review_points": ["string"],
                "narrative_guidance": {},
            },
            "model_contract": {
                "display_name": definition.get("display_name"),
                "input_schema": definition.get("input_schema"),
                "output_schema": definition.get("output_schema"),
                "objective": (definition.get("explanation_spec") or {}).get("objective"),
                "constraints": (definition.get("explanation_spec") or {}).get("constraints"),
            },
            "deterministic_draft": {
                "description": definition.get("description"),
                "instructions": definition.get("instructions"),
                "trigger_examples": definition.get("trigger_examples"),
                "non_trigger_examples": definition.get("non_trigger_examples"),
                "manual_review_points": (definition.get("explanation_spec") or {}).get("manual_review_points"),
                "narrative_guidance": (definition.get("explanation_spec") or {}).get("narrative_guidance"),
            },
        }
        try:
            candidate = llm_service.chat_json(
                [
                    {"role": "system", "content": "You edit prose for a generated Skill. Return JSON only and preserve the model contract exactly."},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ]
            )
            self._validate_prose_candidate(candidate, definition)
            merged = self._merge_prose_candidate(definition, candidate)
            audit.update({"applied": True, "reason": "APPLIED"})
            merged["generation"]["llm"] = audit
            return merged
        except Exception as exc:
            audit.update({"fallback_used": True, "reason": f"LLM_ERROR:{type(exc).__name__}"})
            definition["generation"]["llm"] = audit
            return definition

    def _merge_prose_candidate(self, definition: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
        output = deepcopy(definition)
        if isinstance(candidate.get("description"), str) and candidate["description"].strip():
            output["description"] = candidate["description"].strip()
        for key in ("instructions", "trigger_examples", "non_trigger_examples"):
            values = candidate.get(key)
            if isinstance(values, list) and values and all(isinstance(item, str) and item.strip() for item in values):
                # LLM prose can enrich but never remove the deterministic
                # contract-derived workflow and routing examples.
                merged_values = [str(item) for item in output.get(key) or []]
                for item in values:
                    cleaned = item.strip()
                    if cleaned not in merged_values:
                        merged_values.append(cleaned)
                output[key] = merged_values[:20]
        review_points = candidate.get("manual_review_points")
        if isinstance(review_points, list) and review_points and all(isinstance(item, str) and item.strip() for item in review_points):
            merged_points = [str(item) for item in output["explanation_spec"].get("manual_review_points") or []]
            for item in review_points:
                cleaned = item.strip()
                if cleaned not in merged_points:
                    merged_points.append(cleaned)
            output["explanation_spec"]["manual_review_points"] = merged_points[:20]
        guidance = candidate.get("narrative_guidance")
        if isinstance(guidance, dict):
            # Invariants cannot be relaxed by the wording layer.
            output["explanation_spec"]["narrative_guidance"].update({
                key: value
                for key, value in guidance.items()
                if key not in {"require_evidence_references", "prohibit_unsupported_numbers", "separate_facts_from_inferences"}
            })
        return output

    def _validate_prose_candidate(self, candidate: Any, definition: dict[str, Any]) -> None:
        if not isinstance(candidate, dict):
            raise ValueError("LLM prose output must be a JSON object")
        candidate_text = json.dumps(candidate, ensure_ascii=False)
        source_text = json.dumps(
            {
                "display_name": definition.get("display_name"),
                "description": definition.get("description"),
                "input_schema": definition.get("input_schema"),
                "output_schema": definition.get("output_schema"),
                "instructions": definition.get("instructions"),
                "trigger_examples": definition.get("trigger_examples"),
                "non_trigger_examples": definition.get("non_trigger_examples"),
                "explanation_spec": definition.get("explanation_spec"),
            },
            ensure_ascii=False,
        )
        allowed_numbers = set(self._numbers(source_text))
        unsupported_numbers = sorted(set(self._numbers(candidate_text)) - allowed_numbers)
        if unsupported_numbers:
            raise ValueError(f"LLM prose introduced unsupported numbers: {unsupported_numbers}")
        forbidden_claims = (
            "保证收益", "确保盈利", "绝对安全", "一定可执行", "保证最优", "全局最优",
            "可直接下发", "无需人工复核",
        )
        unsupported_claims = [claim for claim in forbidden_claims if claim in candidate_text and claim not in source_text]
        if unsupported_claims:
            raise ValueError(f"LLM prose introduced unsupported guarantees: {unsupported_claims}")

    def _numbers(self, text: str) -> list[str]:
        return re.findall(r"(?<![\w])[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)

    def _declared_variables(self, model: Any, output_schema: dict[str, Any]) -> list[dict[str, Any]]:
        outputs = normalize_variables((output_schema or {}).get("variables") or [])
        metadata: dict[str, dict[str, Any]] = {}
        for spec in self._specs(model):
            for variable in normalize_variables(spec.get("variables") or []):
                metadata.setdefault(variable["key"], variable)
        # Output schema defines the public contract. Component-local intermediates
        # can enrich declared outputs, but cannot become undeclared metric sources.
        return [{**metadata.get(variable["key"], {}), **variable} for variable in outputs]

    def _declared_constraints(self, model: Any) -> list[dict[str, Any]]:
        candidates: list[dict[str, Any]] = []
        for spec in self._specs(model):
            for key in ("constraints", "generated_constraints", "draft_constraints"):
                candidates.extend(item for item in spec.get(key) or [] if isinstance(item, dict))
        candidates.extend(item for item in self._field(model, "draft_constraints") or [] if isinstance(item, dict))
        rows = self._deduplicate_contract_rows(candidates, ("constraint_id", "code", "key", "name"), default_prefix="constraint")
        for item in rows:
            item["hard"] = bool(item.get("hard", True))
            item["relaxable"] = bool(item.get("relaxable", False))
        return rows

    def _declared_objective(self, model: Any) -> dict[str, Any]:
        candidates: list[dict[str, Any]] = []
        for spec in self._specs(model):
            objective = spec.get("objective")
            if isinstance(objective, dict) and objective:
                candidates.append(objective)
            candidates.extend(item for item in spec.get("objectives") or [] if isinstance(item, dict))
        top_level = self._field(model, "objective_config")
        if isinstance(top_level, dict) and top_level:
            candidates.append(top_level)
        if candidates:
            item = candidates[0]
            key = self._contract_key(item, ("code", "key", "objective_id", "term_id", "name"), "objective")
            return {
                "key": key,
                "name": str(item.get("name") or item.get("label") or key),
                "sense": str(item.get("sense") or "unknown"),
                "unit": str(item.get("unit") or ""),
                "description": str(item.get("description") or ""),
                "expression_declared": bool(item.get("expression") or item.get("terms")),
            }
        objective_text = self._field(model, "objective")
        return {
            "key": "objective_value",
            "name": str(objective_text or "Objective value"),
            "sense": "unknown",
            "unit": "",
            "description": "",
            "expression_declared": False,
        }

    def _declared_result_metrics(self, model: Any) -> list[dict[str, Any]]:
        candidates: list[dict[str, Any]] = []
        for spec in self._specs(model):
            config = spec.get("metrics_config") or {}
            if isinstance(config, dict):
                candidates.extend(item for item in config.get("metrics") or [] if isinstance(item, dict))
        return self._deduplicate_contract_rows(candidates, ("key", "code", "name"), default_prefix="result_metric")

    def _declared_risk_rules(self, model: Any, result_metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
        metric_keys = {
            str(item.get("key")): self._metric_key("result", str(item.get("key")), "value")
            for item in result_metrics
            if item.get("key")
        }
        rules: list[dict[str, Any]] = []
        for spec in self._specs(model):
            for raw in spec.get("explanation_risk_rules") or []:
                if not isinstance(raw, dict):
                    continue
                metric_key = str(raw.get("metric_key") or "")
                if metric_key not in metric_keys:
                    continue
                if raw.get("operator") not in {"gt", "gte", "lt", "lte", "eq", "neq"} or "threshold" not in raw:
                    continue
                rules.append({
                    "key": self._contract_key(raw, ("key", "name"), f"risk_{len(rules) + 1}"),
                    "metric_key": metric_keys[metric_key],
                    "operator": raw["operator"],
                    "threshold": raw["threshold"],
                    "level": raw.get("level") or "medium",
                    "message": str(raw.get("message") or raw.get("name") or metric_key),
                })
        return rules

    def _metrics(
        self,
        objective: dict[str, Any],
        variables: list[dict[str, Any]],
        result_metrics: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        metrics: list[dict[str, Any]] = [{
            "key": "objective_value",
            "label": str(objective.get("name") or "Objective value"),
            "source": {"kind": "objective", "key": None},
            "function": "identity",
            "unit": str(objective.get("unit") or ""),
            "description": str(objective.get("description") or ""),
            "parameters": {},
        }]
        for item in result_metrics:
            key = str(item["key"])
            metrics.append({
                "key": self._metric_key("result", key, "value"),
                "label": str(item.get("name") or item.get("label") or key),
                "source": {"kind": "result_metric", "key": key},
                "function": "identity",
                "unit": str(item.get("unit") or ""),
                "description": str(item.get("description") or ""),
                "parameters": {},
            })
        for item in variables:
            key = str(item["key"])
            functions = self._summary_functions(item)
            for function in functions:
                metrics.append({
                    "key": self._metric_key("variable", key, function),
                    "label": f"{item.get('name') or key} · {function}",
                    "source": {"kind": "variable", "key": key},
                    "function": function,
                    "unit": "count" if function == "non_zero_count" else str(item.get("unit") or ""),
                    "description": "",
                    "parameters": {},
                })
        return metrics

    def _summary_functions(self, item: dict[str, Any]) -> list[str]:
        declared = item.get("summary_functions")
        if isinstance(declared, list):
            filtered = [str(value) for value in declared if str(value) in SAFE_SUMMARY_FUNCTIONS]
            if filtered:
                return list(dict.fromkeys(filtered))
        dimensions = list(item.get("dimension") or item.get("dimensions") or [])
        return ["min_value", "max_value", "sum_value", "non_zero_count"] if dimensions else ["identity"]

    def _specs(self, model: Any) -> list[dict[str, Any]]:
        roots = [
            self._field(model, "semantic_spec"),
            self._field(model, "component_spec"),
            self._field(model, "generic_spec"),
            self._field(model, "model_draft"),
        ]
        output: list[dict[str, Any]] = []
        seen: set[int] = set()
        queue = [item for item in roots if isinstance(item, dict)]
        while queue:
            item = queue.pop(0)
            identity = id(item)
            if identity in seen:
                continue
            seen.add(identity)
            output.append(item)
            for key in ("semantic_spec", "component_spec", "generic_spec"):
                nested = item.get(key)
                if isinstance(nested, dict):
                    queue.append(nested)
        return output

    def _configured_result_metric_keys(self, model: Any) -> set[str]:
        return {str(item.get("key")) for item in self._declared_result_metrics(model) if item.get("key")}

    def _deduplicate_contract_rows(
        self,
        candidates: list[dict[str, Any]],
        key_fields: tuple[str, ...],
        *,
        default_prefix: str,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for index, raw in enumerate(candidates):
            key = self._contract_key(raw, key_fields, f"{default_prefix}_{index + 1}")
            if key in seen:
                continue
            seen.add(key)
            item = deepcopy(raw)
            item["key"] = key
            item["name"] = str(item.get("name") or item.get("label") or key)
            rows.append(item)
        return rows

    def _contract_key(self, item: dict[str, Any], fields: tuple[str, ...], fallback: str) -> str:
        for field in fields:
            value = item.get(field)
            if value not in (None, ""):
                return str(value)
        return fallback

    def _metric_key(self, source: str, key: str, function: str) -> str:
        normalized = re.sub(r"[^\w]+", "_", key, flags=re.UNICODE).strip("_") or "value"
        if normalized != key:
            normalized = f"{normalized}_{hashlib.sha256(key.encode('utf-8')).hexdigest()[:8]}"
        return f"{source}_{normalized}_{function}"

    def _parameter_question(self, item: dict[str, Any]) -> str:
        name = str(item.get("name") or item.get("key"))
        dimensions = list(item.get("dimension") or [])
        unit = str(item.get("unit") or "")
        qualifiers = []
        if dimensions:
            qualifiers.append("dimensions: " + ", ".join(str(value) for value in dimensions))
        if unit:
            qualifiers.append("unit: " + unit)
        suffix = f" ({'; '.join(qualifiers)})" if qualifiers else ""
        return f"Provide {name}{suffix}."

    def _description(self, display_name: str, scene: str, objective_name: str) -> str:
        parts = [f"Execute the published model {display_name}"]
        if scene:
            parts.append(f"for {scene}")
        if objective_name:
            parts.append(f"and explain the result against the declared objective: {objective_name}")
        return " ".join(parts) + "."

    def _instructions(self, display_name: str, input_schema: list[dict[str, Any]], objective_name: str) -> list[str]:
        required = [str(item.get("key")) for item in input_schema if item.get("key") and item.get("required", True)]
        return [
            f"Use this Skill only when the user requests execution or analysis of {display_name}.",
            "Collect and validate parameters exclusively against input_schema; do not invent missing business data.",
            ("Confirm required parameters: " + ", ".join(required) + ".") if required else "No required runtime parameter is declared by the current model contract.",
            f"Run the bound model and report solver status before interpreting {objective_name or 'the objective'}.",
            "Build explanations only from EvidencePackage references and keep facts, inferences, and recommendations separate.",
            "Require human review before any operational use.",
        ]

    def _trigger_examples(self, display_name: str, scene: str, objective_name: str) -> list[str]:
        examples = [f"Run {display_name} with the parameters I provide and explain the result."]
        if scene:
            examples.append(f"Use {display_name} to analyze {scene}.")
        if objective_name:
            examples.append(f"Optimize {objective_name} with {display_name} and identify binding constraints.")
        return examples

    def _non_trigger_examples(self, display_name: str) -> list[str]:
        return [
            f"Explain the general theory behind {display_name} without running a model.",
            "Execute an external operational action or approve a production decision.",
        ]

    def _constraint_review_guidance(self, item: dict[str, Any]) -> str:
        if item.get("review_guidance"):
            return str(item["review_guidance"])
        return f"Verify the result evidence for {item.get('name') or item.get('key')} before using the recommendation."

    def _manual_review_points(self, model: Any, constraints: list[dict[str, Any]]) -> list[str]:
        declared: list[str] = []
        for spec in self._specs(model):
            explanation = spec.get("explanation_config") or {}
            if isinstance(explanation, dict):
                declared.extend(str(item) for item in explanation.get("approval_items") or [] if str(item).strip())
        if declared:
            return list(dict.fromkeys(declared))
        points = ["Verify input provenance, freshness, units, and dimensional completeness."]
        if constraints:
            points.append("Review constraint satisfaction, violations, and binding margins against the declared model contract.")
        points.append("Confirm the recommendation with an authorized reviewer before operational use.")
        return points

    def _limitations(self, model: Any) -> list[str]:
        declared: list[str] = []
        for spec in self._specs(model):
            explanation = spec.get("explanation_config") or {}
            if isinstance(explanation, dict):
                advisory = explanation.get("advisory")
                if advisory:
                    declared.append(str(advisory))
        declared.append("The explanation describes the returned solver evidence and does not prove real-world causality.")
        declared.append("The platform does not infer undeclared thresholds, business rules, or external actions.")
        return list(dict.fromkeys(declared))

    def _execution_policy(self, model: Any) -> dict[str, Any]:
        output_contract = self._field(model, "output_contract") or {}
        ui_metadata = self._field(model, "ui_metadata") or {}
        if not isinstance(output_contract, dict):
            output_contract = {}
        if not isinstance(ui_metadata, dict):
            ui_metadata = {}
        return {
            "mode": str(output_contract.get("execution_policy") or ui_metadata.get("execution_policy") or "advisory_only"),
            "requires_human_review": bool(output_contract.get("requires_human_review", ui_metadata.get("requires_human_review", True))),
            "allow_external_side_effects": False,
        }

    def _field(self, model: Any, name: str) -> Any:
        return model.get(name) if isinstance(model, dict) else getattr(model, name, None)

    def _validate_unique_keys(
        self,
        rows: list[dict[str, Any]],
        field: str,
        path: str,
        errors: list[dict[str, Any]],
    ) -> None:
        seen: set[str] = set()
        for index, item in enumerate(rows):
            key = str(item.get(field) or "")
            if not key:
                errors.append({"code": "MISSING_KEY", "path": f"{path}[{index}].{field}", "message": "A stable key is required."})
            elif key in seen:
                errors.append({"code": "DUPLICATE_KEY", "path": f"{path}[{index}].{field}", "message": f"Duplicate key: {key}"})
            seen.add(key)


skill_definition_service = SkillDefinitionService()
