from __future__ import annotations

from enum import Enum
from typing import Any

from app.agent.parameter_extractor import parameter_extractor
from app.services.invocation_service import invocation_service


class ParameterSource(str, Enum):
    USER_INPUT = "USER_INPUT"
    MANUAL_EDIT = "MANUAL_EDIT"
    LLM_EXTRACTED = "LLM_EXTRACTED"
    RULE_EXTRACTED = "RULE_EXTRACTED"
    DEFAULT_VALUE = "DEFAULT_VALUE"
    SAMPLE_VALUE = "SAMPLE_VALUE"
    FILE_IMPORT = "FILE_IMPORT"
    API_IMPORT = "API_IMPORT"
    SYSTEM_INFERRED = "SYSTEM_INFERRED"
    PREVIOUS_CONTEXT = "PREVIOUS_CONTEXT"


class SchemaDrivenParameterExtractorV2:
    def extract(
        self,
        message: str,
        input_schema: list[dict[str, Any]],
        parameter_policy: dict[str, Any] | None = None,
        existing_parameters: dict[str, Any] | None = None,
        file_parameters: dict[str, Any] | None = None,
        allow_llm: bool = True,
    ) -> dict[str, Any]:
        existing = dict(existing_parameters or {})
        imported = dict(file_parameters or {})
        meta = parameter_extractor.extract_with_meta(message, input_schema, allow_llm=allow_llm)
        updates = dict(meta.get("parameters") or {})
        parameters = {**existing, **imported, **updates}
        analysis = invocation_service.analyze_parameters(input_schema, parameters)
        sources: dict[str, str] = {key: ParameterSource.PREVIOUS_CONTEXT.value for key in existing}
        sources.update({key: ParameterSource.FILE_IMPORT.value for key in imported})
        extracted_source = ParameterSource.LLM_EXTRACTED if meta.get("llm_attempted") and not meta.get("llm_timeout") else ParameterSource.RULE_EXTRACTED
        sources.update({key: extracted_source.value for key in updates})
        for item in analysis.get("can_use_default") or []:
            if item.get("key") not in parameters:
                sources[str(item.get("key"))] = ParameterSource.DEFAULT_VALUE.value

        schema_keys = {str(item.get("key")) for item in input_schema if item.get("key")}
        valid_count = len([key for key in parameters if key in schema_keys])
        required = [item for item in input_schema if item.get("required", True) is not False and item.get("default_policy") != "derived"]
        complete_required = len(required) - len(analysis.get("missing_required") or [])
        schema_fit = (0.6 * valid_count / max(1, len(schema_keys))) + (0.4 * complete_required / max(1, len(required)))
        policy = parameter_policy or {}
        default_candidates = list(analysis.get("can_use_default") or []) if policy.get("allow_defaults", True) else []
        needs_confirmation = bool(default_candidates and policy.get("require_default_confirmation", True))
        return {
            "parameters": parameters,
            "updates": updates,
            "missing_required": analysis.get("missing_required") or [],
            "invalid_params": analysis.get("invalid_parameters") or [],
            "default_candidates": default_candidates,
            "parameter_sources": sources,
            "parameter_confidence": {key: (0.85 if sources.get(key) == ParameterSource.RULE_EXTRACTED.value else 0.72 if sources.get(key) == ParameterSource.LLM_EXTRACTED.value else 1.0) for key in parameters},
            "schema_fit_score": round(min(1.0, schema_fit), 4),
            "needs_user_confirmation": needs_confirmation,
            "questions": analysis.get("questions") or [],
            "llm_timeout": bool(meta.get("llm_timeout")),
            "fallback_mode": meta.get("fallback_mode"),
        }


parameter_extractor_v2 = SchemaDrivenParameterExtractorV2()
