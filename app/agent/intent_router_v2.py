from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


AUTO_CONTROL_MARKERS = (
    "自动下发", "直接下发", "自动执行", "直接提交", "绕过审批", "跳过审批",
    "无人复核", "控制指令", "替我申报", "直接交易",
    "写入生产控制", "写入控制器", "覆盖现场设定",
    "自动控制", "绕过风控", "直接完成现货交易", "跳过调度员确认",
)
KNOWLEDGE_MARKERS = (
    "是什么", "原理", "怎么赚钱", "一般怎么", "怎么做", "区别", "有哪些",
    "介绍", "含义", "为什么", "如何理解", "适用于",
)
RESULT_MARKERS = (
    "解释结果", "解释一下结果", "为什么是这个结果", "结果怎么看", "风险在哪里",
    "有哪些风险", "这个结果", "求解结果", "上次结果",
)
EXECUTION_MARKERS = (
    "生成方案", "生成计划", "运行模型", "开始求解", "执行优化", "优化方案",
    "安排调度", "制定调度", "调度计划", "给出申报曲线", "生成申报曲线",
    "控制在", "压到", "帮我做", "帮我跑",
)
WORKFLOW_INTENTS = {
    "how_to_use", "explain_required_parameters", "parameter_example", "skill_availability_query",
    "switch_skill", "confirm_defaults", "confirm_invoke", "confirm_switch_clear",
    "confirm_switch_migrate", "cancel_switch", "parameter_supplement", "result_explanation",
}


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
        routing_hint: dict[str, Any] | None = None,
        requested_skill: str | None = None,
    ) -> dict[str, Any]:
        text = str(message or "").strip()
        compact = "".join(text.lower().split())
        state = conversation_state or {}
        skills = [item for item in (available_agent_skills or []) if self._is_enabled(item)]
        audit: dict[str, Any] = {
            "message": text,
            "guards": [],
            "candidate_count": len(skills),
            "hint_role": "candidate_signal_only",
        }

        if any(marker in compact for marker in AUTO_CONTROL_MARKERS):
            audit["guards"].append("AUTO_CONTROL_REJECTED")
            return self._decision(
                "safety_refusal", None, [], False, True,
                "平台仅支持辅助分析，不能自动下发生产控制或交易申报指令。",
                audit, llm_parse, routing_hint,
            )

        if any(marker in compact for marker in RESULT_MARKERS):
            audit["guards"].append("RESULT_EXPLANATION")
            return self._decision(
                "result_explanation", None, [], False, False, None,
                audit, llm_parse, routing_hint,
            )

        is_execution = any(marker in compact for marker in EXECUTION_MARKERS)
        is_knowledge = any(marker in compact for marker in KNOWLEDGE_MARKERS) and not is_execution
        if llm_parse:
            is_execution = is_execution or bool(llm_parse.get("is_execution_request"))
            is_knowledge = (is_knowledge or bool(llm_parse.get("is_knowledge_question"))) and not is_execution
        if is_knowledge:
            audit["guards"].append("KNOWLEDGE_ONLY")
            return self._decision(
                "knowledge_question", None, [], False, False, None,
                audit, llm_parse, routing_hint,
            )

        workflow_intent = self._workflow_intent(compact, state, routing_hint)
        if workflow_intent:
            audit["guards"].append("V2_WORKFLOW_DECISION")
            workflow_selected = self._selected_for_workflow(
                workflow_intent, state, skills, routing_hint
            )
            return self._decision(
                workflow_intent, workflow_selected, [], False,
                False, None, audit, llm_parse, routing_hint,
            )

        candidates = [
            self._score(
                text, state, skill, llm_parse, user_permissions,
                routing_hint=routing_hint, requested_skill=requested_skill,
            )
            for skill in skills
        ]
        candidate_names = {str(item.get("agent_skill_name") or "") for item in candidates}
        for candidate in candidates:
            candidate_name = str(candidate.get("agent_skill_name") or "")
            version_match = re.search(r"^(.*)_v(\d+)$", candidate_name, re.IGNORECASE)
            if not version_match or version_match.group(1) not in candidate_names:
                continue
            version = version_match.group(2)
            if not re.search(
                rf"(?:\bv\s*{version}\b|版本\s*{version}|第?\s*{version}\s*版)",
                text,
                re.IGNORECASE,
            ):
                candidate["final_score"] = round(candidate["final_score"] * 0.72, 4)
                candidate["base_score"] = round(candidate["base_score"] * 0.72, 4)
                candidate["score_breakdown"]["implicit_version_penalty"] = 0.72
        candidates = [item for item in candidates if item["final_score"] > 0]
        candidates.sort(key=lambda item: item["final_score"], reverse=True)
        top = candidates[0] if candidates else None
        second = candidates[1] if len(candidates) > 1 else None
        requested_candidate = next(
            (
                item
                for item in candidates
                if requested_skill
                and requested_skill in {
                    item.get("agent_skill_name"),
                    item.get("platform_skill_name"),
                }
            ),
            None,
        )
        if requested_candidate:
            audit["guards"].append("EXPLICIT_SKILL_SELECTION")
            return self._decision(
                "optimization_request",
                requested_candidate,
                candidates,
                False,
                False,
                None,
                audit,
                llm_parse,
                routing_hint,
            )
        deterministic_hint = (
            str((routing_hint or {}).get("intent") or "") == "optimization_request"
            and str((routing_hint or {}).get("match_type") or "") in {"exact_phrase", "alias_phrase"}
            and not bool((routing_hint or {}).get("match_ambiguous"))
            and float((routing_hint or {}).get("confidence") or 0.0) >= 0.85
        )
        if deterministic_hint:
            hint_name = str(
                (routing_hint or {}).get("agent_skill_name")
                or (routing_hint or {}).get("platform_skill_name")
                or ""
            )
            hinted_candidate = next(
                (
                    item
                    for item in candidates
                    if hint_name in {
                        item.get("agent_skill_name"),
                        item.get("platform_skill_name"),
                    }
                ),
                None,
            )
            if hinted_candidate:
                audit["guards"].append("DETERMINISTIC_SKILL_MATCH")
                return self._decision(
                    "optimization_request",
                    hinted_candidate,
                    candidates,
                    False,
                    False,
                    None,
                    audit,
                    llm_parse,
                    routing_hint,
                )
        if not top or top["final_score"] < 0.60:
            question = "请说明要优化的业务场景、目标和时间范围。"
            return self._decision(
                "optimization_request" if is_execution else "unknown", None, candidates,
                True, False, question, audit, llm_parse, routing_hint,
            )
        margin = top["final_score"] - (second["final_score"] if second else 0.0)
        base_margin = top["base_score"] - (
            second["base_score"] if second else 0.0
        )
        threshold = float(top.get("confidence_threshold", 0.75))
        margin_threshold = float(top.get("top_score_margin_threshold", 0.15))
        needs_clarification = (
            top["final_score"] < threshold
            or (second is not None and margin < margin_threshold)
            or (second is not None and base_margin < margin_threshold)
        )
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
            llm_parse,
            routing_hint,
        )

    def _score(
        self,
        message: str,
        state: dict[str, Any],
        skill: dict[str, Any],
        llm_parse: dict[str, Any] | None,
        user_permissions: set[str] | None,
        routing_hint: dict[str, Any] | None,
        requested_skill: str | None,
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
        base_score = min(1.0, score)
        hint_name = str(
            (routing_hint or {}).get("agent_skill_name")
            or (routing_hint or {}).get("platform_skill_name")
            or ""
        )
        hint_match = 1.0 if hint_name in {name, platform} else 0.0
        requested_match = 1.0 if requested_skill in {name, platform} else 0.0
        score = min(1.0, score + 0.25 * hint_match + 0.35 * requested_match)
        policy = skill.get("intent_policy") or {}
        return {
            "agent_skill_name": name,
            "platform_skill_name": platform,
            "api_skill_name": platform,
            "display_name": skill.get("display_name") or name,
            "final_score": round(min(1.0, score), 4),
            "base_score": round(base_score, 4),
            "reason": self._reason(semantic, schema_fit, business_domain, context, llm_score),
            "score_breakdown": {
                "llm_intent_score": round(llm_score, 4),
                "semantic_example_score": round(semantic, 4),
                "schema_fit_score": round(schema_fit, 4),
                "context_score": round(context, 4),
                "business_domain_score": round(business_domain, 4),
                "keyword_score": round(keyword, 4),
                "availability_score": round(available, 4),
                "hint_score": hint_match,
                "requested_skill_score": requested_match,
            },
            "confidence_threshold": policy.get("confidence_threshold", 0.75),
            "top_score_margin_threshold": policy.get("top_score_margin_threshold", 0.15),
        }

    def _decision(
        self,
        intent: str,
        selected: dict[str, Any] | None,
        candidates: list[dict[str, Any]],
        clarify: bool,
        blocked: bool,
        question: str | None,
        audit: dict[str, Any],
        llm_parse: dict[str, Any] | None,
        routing_hint: dict[str, Any] | None,
    ) -> dict[str, Any]:
        top = candidates[0] if candidates else None
        selected_skill = selected.get("agent_skill_name") if selected else None
        reasons = list(audit.get("guards") or [])
        if top and top.get("reason"):
            reasons.append(str(top["reason"]))
        if clarify:
            reasons.append("CONFIDENCE_OR_MARGIN_REQUIRES_CLARIFICATION")
        return {
            "router_version": "v2",
            "intent": intent,
            "intent_type": "optimization_run" if intent == "optimization_request" else intent,
            "selected_skill": selected_skill,
            "agent_skill_name": selected_skill,
            "api_skill_name": selected.get("platform_skill_name") if selected else None,
            "platform_skill_name": selected.get("platform_skill_name") if selected else None,
            "final_score": top.get("final_score", 0.0) if top else 0.0,
            "selection_reason": top.get("reason") if top else None,
            "decision_reasons": reasons,
            "candidate_skills": candidates[:3],
            "need_clarification": clarify,
            "clarification_question": question,
            "blocked": blocked,
            "safety_decision": {
                "blocked": blocked,
                "reason": "AUTO_CONTROL_REJECTED" if blocked else None,
            },
            "llm_parse": llm_parse or {},
            "routing_hint": self._sanitized_routing_hint(routing_hint),
            "audit": audit,
        }

    def _workflow_intent(
        self,
        compact: str,
        state: dict[str, Any],
        routing_hint: dict[str, Any] | None,
    ) -> str | None:
        hint_intent = str((routing_hint or {}).get("intent") or "")
        if hint_intent not in WORKFLOW_INTENTS:
            return None
        active = bool(
            state.get("resolved_skill_name")
            or state.get("agent_skill_name")
            or state.get("parameter_draft")
        )
        if hint_intent in {
            "how_to_use", "skill_availability_query", "explain_required_parameters",
            "parameter_example", "confirm_defaults", "confirm_invoke",
        }:
            return hint_intent
        if hint_intent in {"switch_skill"} and any(word in compact for word in ("切换", "换成", "改用")):
            return hint_intent
        return hint_intent if active else None

    def _selected_for_workflow(
        self,
        intent: str,
        state: dict[str, Any],
        skills: list[dict[str, Any]],
        routing_hint: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        hint_target = (
            (routing_hint or {}).get("agent_skill_name")
            or (routing_hint or {}).get("platform_skill_name")
        )
        if hint_target:
            for skill in skills:
                if hint_target in {
                    skill.get("agent_skill_name"),
                    skill.get("name"),
                    skill.get("platform_skill_name"),
                }:
                    return {
                        "agent_skill_name": skill.get("agent_skill_name") or skill.get("name"),
                        "platform_skill_name": skill.get("platform_skill_name"),
                    }
        return self._selected_from_context(state, skills)

    def _selected_from_context(
        self,
        state: dict[str, Any],
        skills: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        target = state.get("agent_skill_name") or state.get("resolved_skill_name")
        if not target:
            return None
        for skill in skills:
            if target in {
                skill.get("agent_skill_name"),
                skill.get("name"),
                skill.get("platform_skill_name"),
            }:
                return {
                    "agent_skill_name": skill.get("agent_skill_name") or skill.get("name"),
                    "platform_skill_name": skill.get("platform_skill_name"),
                }
        return None

    def _sanitized_routing_hint(self, signal: dict[str, Any] | None) -> dict[str, Any]:
        return {
            key: (signal or {}).get(key)
            for key in (
                "intent",
                "agent_skill_name",
                "platform_skill_name",
                "reason",
                "confidence",
                "match_type",
                "matched_phrase",
                "match_ambiguous",
            )
            if (signal or {}).get(key) is not None
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
