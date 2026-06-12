from __future__ import annotations

import json
import os
from typing import Any

from app.services.llm_service import llm_service


class LLMIntentClassifier:
    def enabled(self) -> bool:
        return os.getenv("AGENT_LLM_INTENT_CLASSIFIER_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}

    def classify(self, message: str, rule_confidence: float = 0.0) -> dict[str, Any]:
        if not self.enabled() or rule_confidence >= 0.6 or not llm_service.enabled():
            return {"enabled": False, "used": False}
        prompt = {
            "task": "Classify the user intent for an optimization agent. Return JSON only.",
            "allowed_intents": [
                "how_to_use",
                "explain_required_parameters",
                "parameter_example",
                "skill_availability_query",
                "optimization_request",
                "parameter_supplement",
                "result_explanation",
                "casual_chat",
            ],
            "rules": [
                "Do not decide whether to invoke a model.",
                "Only return intent, confidence, and reason.",
            ],
            "user_message": message,
        }
        try:
            result = llm_service.chat_json(
                [
                    {"role": "system", "content": "Return intent classification JSON only."},
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ]
            )
        except Exception:
            return {"enabled": True, "used": False, "fallback_mode": "rule_based"}
        intent = result.get("intent")
        if intent not in set(prompt["allowed_intents"]):
            return {"enabled": True, "used": False, "fallback_mode": "rule_based"}
        return {"enabled": True, "used": True, "intent": intent, "confidence": float(result.get("confidence") or 0), "reason": result.get("reason") or ""}


llm_intent_classifier = LLMIntentClassifier()
