from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.agent.intent_router_v2 import intent_router_v2
from app.agent.parameter_extractor_v2 import parameter_extractor_v2
from app.explainers.evidence_builder import evidence_builder
from app.explainers.generic_explainer import generic_explainer


def load_jsonl(path: str | Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def evaluate_intent_cases(cases: list[dict[str, Any]], skills: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(cases)
    intent_correct = 0
    skill_correct = 0
    wrong_invocations = 0
    clarification_expected = 0
    clarification_found = 0
    unsafe_auto_invoke_count = 0
    failures: list[dict[str, Any]] = []
    for case in cases:
        result = intent_router_v2.route(str(case.get("utterance") or ""), {}, skills)
        expected_intent = case.get("expected_intent_type")
        actual_intent = result.get("intent_type")
        if expected_intent == actual_intent or (expected_intent == "clarification_required" and result.get("need_clarification")):
            intent_correct += 1
        expected_skill = case.get("expected_skill")
        actual_skill = result.get("api_skill_name")
        if expected_skill == actual_skill or (not expected_skill and not actual_skill):
            skill_correct += 1
        should_invoke = bool(case.get("should_invoke"))
        actual_invoke = bool(actual_skill and not result.get("need_clarification") and not result.get("blocked"))
        if actual_invoke and not should_invoke:
            wrong_invocations += 1
        if case.get("should_clarify"):
            clarification_expected += 1
            clarification_found += int(bool(result.get("need_clarification")))
        if result.get("intent") == "safety_refusal" and actual_invoke:
            unsafe_auto_invoke_count += 1
        if expected_skill != actual_skill and should_invoke:
            failures.append({"utterance": case.get("utterance"), "expected_skill": expected_skill, "actual_skill": actual_skill, "result": result})
    return {
        "intent_accuracy": round(intent_correct / max(1, total), 4),
        "skill_selection_accuracy": round(skill_correct / max(1, total), 4),
        "wrong_invocation_rate": round(wrong_invocations / max(1, total), 4),
        "clarification_recall": round(clarification_found / max(1, clarification_expected), 4),
        "unsafe_auto_invoke_count": unsafe_auto_invoke_count,
        "failures": failures,
        "case_count": total,
    }


def evaluate_parameter_cases(cases: list[dict[str, Any]], skill_lookup: dict[str, dict[str, Any]]) -> dict[str, Any]:
    correct = 0
    failures: list[dict[str, Any]] = []
    for case in cases:
        skill = skill_lookup.get(str(case.get("skill"))) or {}
        result = parameter_extractor_v2.extract(str(case.get("utterance") or ""), skill.get("input_schema") or [], allow_llm=False)
        expected = case.get("expected_params") or {}
        if all(result.get("parameters", {}).get(key) == value for key, value in expected.items()):
            correct += 1
        else:
            failures.append({"case": case, "actual": result.get("parameters")})
    return {"parameter_extraction_accuracy": round(correct / max(1, len(cases)), 4), "parameter_failures": failures}


def evaluate_explanation_cases(cases: list[dict[str, Any]]) -> dict[str, Any]:
    grounded = 0
    failures: list[dict[str, Any]] = []
    for case in cases:
        evidence = evidence_builder.build(result=case, model={"id": "eval"}, skill_name="eval")
        explanation = generic_explainer.explain(evidence)
        text = str(explanation)
        objective = case.get("objective_value")
        valid = explanation.get("grounded_on") == "evidence_package"
        valid = valid and (objective is None or str(objective) in text)
        valid = valid and ("成本降低" not in text or "baseline" in str(evidence))
        if valid:
            grounded += 1
        else:
            failures.append({"case": case, "evidence": evidence, "explanation": explanation})
    return {"explanation_groundedness": round(grounded / max(1, len(cases)), 4), "explanation_failures": failures}
