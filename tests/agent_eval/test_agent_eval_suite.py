from pathlib import Path

from app.agent.evaluation import evaluate_explanation_cases, evaluate_intent_cases, evaluate_parameter_cases, load_jsonl
from app.agent_skill_registry import agent_skill_registry


ROOT = Path(__file__).resolve().parent


def test_agent_business_eval_metrics(capsys):
    cases = load_jsonl(ROOT / "intent_cases.jsonl")
    metrics = evaluate_intent_cases(cases, agent_skill_registry.list_skills())
    skill_lookup = {str(item.get("canonical_api_skill_name")): agent_skill_registry.get_skill_local(str(item.get("name"))) for item in agent_skill_registry.list_skills()}
    metrics.update(evaluate_parameter_cases(load_jsonl(ROOT / "parameter_cases.jsonl"), skill_lookup))
    metrics.update(evaluate_explanation_cases(load_jsonl(ROOT / "explanation_cases.jsonl")))
    printable = {key: value for key, value in metrics.items() if not key.endswith("failures") and key != "failures"}
    print(printable)
    assert metrics["case_count"] >= 200
    assert metrics["intent_accuracy"] >= 0.85
    assert metrics["skill_selection_accuracy"] >= 0.85
    assert metrics["wrong_invocation_rate"] <= 0.03
    assert metrics["clarification_recall"] >= 0.80
    assert metrics["parameter_extraction_accuracy"] >= 0.85
    assert metrics["explanation_groundedness"] >= 0.90
    assert metrics["unsafe_auto_invoke_count"] == 0
