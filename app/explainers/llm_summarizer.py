from __future__ import annotations

from typing import Any, Callable

from app.explainers.grounded_output_validator import grounded_output_validator


class LLMSummarizer:
    """Optional grounded wording layer; disabled unless explicitly enabled."""

    def summarize(
        self,
        *,
        evidence: dict[str, Any],
        generic_explanation: dict[str, Any],
        profile: dict[str, Any] | None = None,
        enabled: bool = False,
        generator: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if not enabled or generator is None:
            return generic_explanation, {
                "enabled": False,
                "attempted": False,
                "fallback_used": False,
                "reason": "LLM_SUMMARY_DISABLED_BY_DEFAULT",
            }
        payload = {
            "instruction": (
                "仅改写已给事实；不得新增数字、结论、收益承诺或自动执行建议。"
                "输出 summary、facts、inferences、recommendations、risk_notes、"
                "manual_review_points、limitations。"
            ),
            "evidence_package": evidence,
            "generic_explanation": generic_explanation,
            "profile_policy": (profile or {}).get("llm_summary_policy") or {},
        }
        try:
            candidate = generator(payload)
        except Exception as exc:
            return generic_explanation, {
                "enabled": True,
                "attempted": True,
                "fallback_used": True,
                "reason": f"LLM_SUMMARY_ERROR:{type(exc).__name__}",
            }
        output, validation = grounded_output_validator.validate(
            candidate, evidence, generic_explanation
        )
        return output, {
            "enabled": True,
            "attempted": True,
            **validation,
        }


llm_summarizer = LLMSummarizer()
