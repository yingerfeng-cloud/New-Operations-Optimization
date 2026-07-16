from app.agent.intent_router_v2 import intent_router_v2
from app.explainers.base import ADVISORY_DISCLAIMER
from app.explainers.generic_explainer import generic_explainer


def test_auto_control_requests_are_refused_before_skill_selection():
    result = intent_router_v2.route("帮我自动下发储能控制指令", {}, [])
    assert result["intent"] == "safety_refusal"
    assert result["blocked"]
    assert result["api_skill_name"] is None


def test_every_explanation_contains_advisory_disclaimer():
    result = generic_explainer.explain({"solver": {"status": "success"}, "variables_summary": [], "constraint_checks": [], "risk_notes": [], "manual_review_points": [], "explanation_limits": []})
    assert result["disclaimer"] == ADVISORY_DISCLAIMER
    assert ADVISORY_DISCLAIMER in result["limitations"]
