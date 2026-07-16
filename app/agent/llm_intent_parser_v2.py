from __future__ import annotations

import json
from typing import Any

from app.services.llm_service import llm_service


class LLMIntentParserV2:
    """Optional semantic parser. Its output is evidence for ranking, never an invoke decision."""

    def parse(
        self,
        message: str,
        conversation_state: dict[str, Any] | None,
        skills: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        if not llm_service.enabled():
            return None
        catalog = [
            {
                "agent_skill_name": item.get("agent_skill_name") or item.get("name"),
                "platform_skill_name": item.get("platform_skill_name") or item.get("canonical_api_skill_name"),
                "business_domain": item.get("business_domain"),
                "supported_intents": item.get("supported_intents"),
                "business_goals": item.get("business_goals"),
                "positive_examples": (item.get("positive_examples") or [])[:5],
                "input_fields": [field.get("key") for field in item.get("input_schema") or [] if field.get("key")],
            }
            for item in skills
            if item.get("enabled", True) is not False and str(item.get("state") or "enabled") == "enabled"
        ]
        prompt = {
            "task": "Parse an optimization-agent user message into the exact JSON contract below.",
            "constraints": [
                "You may propose candidates but must never decide or request execution.",
                "Knowledge questions must set is_knowledge_question=true and is_execution_request=false.",
                "Only use platform_skill_name values present in the supplied catalog.",
            ],
            "output_contract": {
                "intent_type": "optimization_run|parameter_check|result_explanation|knowledge_question|unknown",
                "business_domain": "string|null",
                "time_scope": "day_ahead|intraday|realtime|long_term|null",
                "business_goal": ["string"],
                "mentioned_assets": ["string"],
                "mentioned_data": ["string"],
                "is_knowledge_question": "boolean",
                "is_execution_request": "boolean",
                "is_result_explanation_request": "boolean",
                "candidate_skills": [{"platform_skill_name": "string", "confidence": "0..1", "reason": "string"}],
                "need_clarification": "boolean",
                "clarification_question": "string|null",
            },
            "message": message,
            "recent_context": (conversation_state or {}).get("recent_turns", [])[-4:],
            "skill_catalog": catalog,
        }
        try:
            result = llm_service.chat_json([
                {"role": "system", "content": "Return valid JSON only. You are an intent parser, not an execution agent."},
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ])
        except Exception:
            return None
        if not isinstance(result, dict):
            return None
        allowed_names = {str(item.get("platform_skill_name")) for item in catalog}
        candidates = []
        for item in result.get("candidate_skills") or []:
            if not isinstance(item, dict) or str(item.get("platform_skill_name")) not in allowed_names:
                continue
            candidates.append({
                "platform_skill_name": str(item["platform_skill_name"]),
                "confidence": max(0.0, min(1.0, float(item.get("confidence") or 0.0))),
                "reason": str(item.get("reason") or ""),
            })
        return {
            "intent_type": str(result.get("intent_type") or "unknown"),
            "business_domain": result.get("business_domain"),
            "time_scope": result.get("time_scope"),
            "business_goal": list(result.get("business_goal") or []),
            "mentioned_assets": list(result.get("mentioned_assets") or []),
            "mentioned_data": list(result.get("mentioned_data") or []),
            "is_knowledge_question": bool(result.get("is_knowledge_question")),
            "is_execution_request": bool(result.get("is_execution_request")),
            "is_result_explanation_request": bool(result.get("is_result_explanation_request")),
            "candidate_skills": candidates,
            "need_clarification": bool(result.get("need_clarification")),
            "clarification_question": result.get("clarification_question"),
        }


llm_intent_parser_v2 = LLMIntentParserV2()
