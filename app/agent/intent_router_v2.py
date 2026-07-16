from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


AUTO_CONTROL_MARKERS = ("自动下发", "直接下发", "自动执行", "直接提交", "绕过审批", "控制指令")
KNOWLEDGE_MARKERS = ("是什么", "原理", "怎么赚钱", "一般怎么", "怎么做", "区别", "有哪些", "介绍", "含义")
EXECUTION_MARKERS = ("帮我", "生成", "运行", "求解", "优化", "调度", "申报曲线", "控制在", "压到")


@dataclass(frozen=True)
class ScoreWeights:
    llm_intent: float = 0.35
    semantic_example: float = 0.20
    schema_fit: float = 0.15
    context: float = 0.10
    business_domain: float = 0.10
    keyword: float = 0.05
    availability: float = 0.05


class IntentRouterV2:
    def __init__(self, weights: ScoreWeights | None = None) -> None:
        self.weights = weights or ScoreWeights()

    def route(
        self,
        message: str,
        conversation_state: dict[str, Any] | None = None,
        available_agent_skills: list[dict[str, Any]] | None = None,
        llm_parse: dict[str, Any] | None = None,
        user_permissions: set[str] | None = None,
    ) -> dict[str, Any]:
        text = str(message or "").strip()
        compact = "".join(text.lower().split())
        state = conversation_state or {}
        skills = [item for item in (available_agent_skills or []) if self._is_enabled(item)]
        audit: dict[str, Any] = {"message": text, "guards": [], "candidate_count": len(skills)}

        if any(marker in compact for marker in AUTO_CONTROL_MARKERS):
            audit["guards"].append("AUTO_CONTROL_REJECTED")
            return self._decision("safety_refusal", None, [], False, True, "平台仅支持辅助分析，不能自动下发生产控制或交易申报指令。", audit)

        is_execution = any(marker in compact for marker in EXECUTION_MARKERS) or compact.startswith("做")
        is_knowledge = any(marker in compact for marker in KNOWLEDGE_MARKERS) and not is_execution
        if llm_parse:
            is_execution = bool(llm_parse.get("is_execution_request", is_execution))
            is_knowledge = bool(llm_parse.get("is_knowledge_question", is_knowledge))
        if is_knowledge:
            audit["guards"].append("KNOWLEDGE_ONLY")
            return self._decision("knowledge_question", None, [], False, False, None, audit)

        candidates = [self._score(text, state, skill, llm_parse, user_permissions) for skill in skills]
        candidates = [item for item in candidates if item["final_score"] > 0]
        candidates.sort(key=lambda item: item["final_score"], reverse=True)
        top = candidates[0] if candidates else None
        second = candidates[1] if len(candidates) > 1 else None
        if not top or top["final_score"] < 0.60:
            question = "请说明要优化的业务场景、目标和时间范围。"
            return self._decision("optimization_request" if is_execution else "unknown", None, candidates, True, False, question, audit)
        margin = top["final_score"] - (second["final_score"] if second else 0.0)
        threshold = float(top.get("confidence_threshold", 0.75))
        needs_clarification = top["final_score"] < threshold or (second is not None and margin < float(top.get("top_score_margin_threshold", 0.15)))
        if needs_clarification:
            labels = "、".join(str(item.get("display_name") or item.get("agent_skill_name")) for item in candidates[:3])
            question = f"当前可能匹配：{labels}。请确认具体场景和时间范围。"
        else:
            question = None
        selected = None if needs_clarification else top
        return self._decision(
            "optimization_request",
            selected,
            candidates,
            needs_clarification,
            False,
            question,
            audit,
        )

    def _score(
        self,
        message: str,
        state: dict[str, Any],
        skill: dict[str, Any],
        llm_parse: dict[str, Any] | None,
        user_permissions: set[str] | None,
    ) -> dict[str, Any]:
        name = str(skill.get("agent_skill_name") or skill.get("name") or "")
        platform = str(skill.get("platform_skill_name") or skill.get("canonical_api_skill_name") or "")
        positive = list(skill.get("positive_examples") or skill.get("trigger_intents") or [])
        negative = list(skill.get("negative_examples") or []) + list(skill.get("do_not_invoke_examples") or [])
        domain = skill.get("business_domain") or {}
        domain_terms = [skill.get("display_name"), domain.get("primary"), *(domain.get("secondary") or []), *(skill.get("scenario_tags") or [])]
        semantic = max((self._similarity(message, str(example)) for example in positive), default=0.0)
        negative_score = max((self._similarity(message, str(example)) for example in negative), default=0.0)
        if negative_score >= 0.65:
            semantic = max(0.0, semantic - 0.8 * negative_score)
        keyword = self._term_overlap(message, [name, platform, *domain_terms, *positive, *(skill.get("trigger_intents") or [])])
        business_domain = self._term_overlap(message, domain_terms)
        business_domain = max(business_domain, semantic)
        schema_keys = [str(item.get("key") or item.get("name") or "") for item in skill.get("input_schema") or []]
        schema_fit = min(1.0, self._term_overlap(message, schema_keys) + (0.35 if any(self._looks_like_value(message, key) for key in schema_keys) else 0.0))
        context = 1.0 if name and name == state.get("agent_skill_name") else 0.0
        llm_score = self._llm_score(platform, name, llm_parse)
        if not llm_parse:
            llm_score = max(semantic, business_domain, keyword)
        available = 1.0 if self._is_enabled(skill) and (not user_permissions or platform in user_permissions or name in user_permissions) else 0.0
        score = (
            self.weights.llm_intent * llm_score
            + self.weights.semantic_example * semantic
            + self.weights.schema_fit * schema_fit
            + self.weights.context * context
            + self.weights.business_domain * business_domain
            + self.weights.keyword * keyword
            + self.weights.availability * available
        )
        if name.lower().endswith("_v2") and not re.search(r"(?:\bv\s*2\b|版本\s*2|二代)", message, re.IGNORECASE):
            score *= 0.72
        policy = skill.get("intent_policy") or {}
        return {
            "agent_skill_name": name,
            "platform_skill_name": platform,
            "api_skill_name": platform,
            "display_name": skill.get("display_name") or name,
            "final_score": round(min(1.0, score), 4),
            "reason": self._reason(semantic, schema_fit, business_domain, context, llm_score),
            "score_breakdown": {
                "llm_intent_score": round(llm_score, 4),
                "semantic_example_score": round(semantic, 4),
                "schema_fit_score": round(schema_fit, 4),
                "context_score": round(context, 4),
                "business_domain_score": round(business_domain, 4),
                "keyword_score": round(keyword, 4),
                "availability_score": round(available, 4),
            },
            "confidence_threshold": policy.get("confidence_threshold", 0.75),
            "top_score_margin_threshold": policy.get("top_score_margin_threshold", 0.15),
        }

    def _decision(self, intent: str, selected: dict[str, Any] | None, candidates: list[dict[str, Any]], clarify: bool, blocked: bool, question: str | None, audit: dict[str, Any]) -> dict[str, Any]:
        top = candidates[0] if candidates else None
        return {
            "router_version": "2.0",
            "intent": intent,
            "intent_type": "optimization_run" if intent == "optimization_request" else intent,
            "agent_skill_name": selected.get("agent_skill_name") if selected else None,
            "api_skill_name": selected.get("platform_skill_name") if selected else None,
            "platform_skill_name": selected.get("platform_skill_name") if selected else None,
            "final_score": top.get("final_score", 0.0) if top else 0.0,
            "selection_reason": top.get("reason") if top else None,
            "candidate_skills": candidates[:3],
            "need_clarification": clarify,
            "clarification_question": question,
            "blocked": blocked,
            "audit": audit,
        }

    def _is_enabled(self, skill: dict[str, Any]) -> bool:
        state = str(skill.get("state") or skill.get("status") or "enabled").lower()
        return skill.get("enabled", True) is not False and state == "enabled" and str(skill.get("platform_skill_status") or "enabled").lower() == "enabled"

    def _similarity(self, left: str, right: str) -> float:
        left_norm, right_norm = self._normalize_phrase(left), self._normalize_phrase(right)
        if left_norm and right_norm and (left_norm in right_norm or right_norm in left_norm):
            return 1.0
        lcs_ratio = self._longest_common_substring(left_norm, right_norm) / max(1, min(len(left_norm), len(right_norm)))
        a, b = self._tokens(left), self._tokens(right)
        if not a or not b:
            return lcs_ratio
        return max(lcs_ratio, len(a & b) / min(len(a), len(b)))

    def _tokens(self, value: str) -> set[str]:
        compact = "".join(str(value).lower().split())
        latin = set(re.findall(r"[a-z0-9_]+", compact))
        chinese = {compact[index : index + size] for size in (2, 3, 4) for index in range(max(0, len(compact) - size + 1)) if re.search(r"[\u4e00-\u9fff]", compact[index : index + size])}
        return latin | chinese

    def _term_overlap(self, message: str, terms: list[Any]) -> float:
        values = [str(term).lower().replace("_", "") for term in terms if term]
        compact = "".join(message.lower().split()).replace("_", "")
        hits = [term for term in values if term and term in compact]
        if hits:
            return min(1.0, 0.85 + 0.15 * len(hits))
        similarity = max((self._similarity(message, term) for term in values), default=0.0)
        return similarity if similarity >= 0.45 else 0.0

    def _normalize_phrase(self, value: str) -> str:
        compact = "".join(str(value).lower().split()).replace("_", "")
        for source, target in (("光储协同", "光储"), ("现货暴露", "敞口"), ("最大敞口", "敞口"), ("日内滚动优化", "日内滚动调度")):
            compact = compact.replace(source, target)
        for noise in ("帮我", "请", "生成", "做", "模型", "优化", "曲线", "一下"):
            compact = compact.replace(noise, "")
        return compact

    def _longest_common_substring(self, left: str, right: str) -> int:
        if not left or not right:
            return 0
        previous = [0] * (len(right) + 1)
        best = 0
        for char_left in left:
            current = [0]
            for index, char_right in enumerate(right, 1):
                value = previous[index - 1] + 1 if char_left == char_right else 0
                current.append(value)
                best = max(best, value)
            previous = current
        return best

    def _looks_like_value(self, message: str, key: str) -> bool:
        aliases = {"electricity_price": "电价", "storage_capacity": "容量", "load_forecast": "负荷", "pv_forecast": "光伏", "spot_price_forecast": "现货价", "max_exposure_ratio": "敞口"}
        return bool(aliases.get(key) and aliases[key] in message and re.search(r"\d", message))

    def _llm_score(self, platform: str, name: str, llm_parse: dict[str, Any] | None) -> float:
        for item in (llm_parse or {}).get("candidate_skills") or []:
            if item.get("platform_skill_name") in {platform, name}:
                return float(item.get("confidence") or 0.0)
        return 0.0

    def _reason(self, semantic: float, schema: float, domain: float, context: float, llm: float) -> str:
        parts = []
        if llm:
            parts.append("LLM 意图候选匹配")
        if semantic:
            parts.append("与正向业务样例语义相似")
        if domain:
            parts.append("业务域匹配")
        if schema:
            parts.append("输入 Schema 适配")
        if context:
            parts.append("延续当前任务上下文")
        return "、".join(parts) or "弱信号候选"


intent_router_v2 = IntentRouterV2()
