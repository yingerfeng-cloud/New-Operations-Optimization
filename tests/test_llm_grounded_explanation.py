from app.explainers.generic_explainer import generic_explainer
from app.explainers.llm_summarizer import llm_summarizer


def test_explanation_is_layered_and_contains_only_evidence_facts():
    evidence = {
        "solver": {"status": "success", "objective_value": 100},
        "variables_summary": [{"name": "x"}],
        "constraint_checks": [],
        "risk_notes": [],
        "manual_review_points": ["复核输入"],
        "explanation_limits": [],
    }
    result = generic_explainer.explain(evidence)
    assert set(("facts", "inferences", "recommendations", "manual_review_points", "limitations", "summary")) <= result.keys()
    assert "成本降低" not in str(result)
    assert "100" in str(result["facts"])
    assert result["grounded_on"] == "evidence_package"


def test_ipopt_failure_is_specific_and_not_a_valid_solution():
    evidence = {"solver": {"status": "FAILED", "error": "SOLVER_UNAVAILABLE: Ipopt not found"}, "variables_summary": [], "constraint_checks": [], "risk_notes": [], "manual_review_points": [], "explanation_limits": []}
    result = generic_explainer.explain(evidence)
    assert "Ipopt" in result["summary"]
    assert "不是有效优化方案" in result["summary"]


def test_all_supported_ipopt_unavailable_phrasings_are_specific():
    for reason in (
        "Ipopt unavailable",
        "Ipopt not available",
        "Ipopt not installed",
        "Ipopt not found",
        "Ipopt missing",
        "Ipopt no executable",
        "Ipopt not in PATH",
        "solver_unavailable: Ipopt",
    ):
        evidence = {
            "solver": {"status": "FAILED", "error": reason},
            "variables_summary": [],
            "constraint_checks": [],
            "risk_notes": [],
            "manual_review_points": [],
            "explanation_limits": [],
        }
        result = generic_explainer.explain(evidence)
        assert "Ipopt" in result["summary"], reason
        assert "不是有效优化方案" in result["summary"], reason


def test_llm_summary_is_disabled_by_default():
    evidence = {"solver": {"status": "success", "objective_value": 10}}
    generic = generic_explainer.explain(evidence)
    called = {"value": False}

    def generator(_payload):
        called["value"] = True
        return {}

    output, audit = llm_summarizer.summarize(
        evidence=evidence,
        generic_explanation=generic,
        generator=generator,
    )
    assert output is generic
    assert not called["value"]
    assert audit["reason"] == "LLM_SUMMARY_DISABLED_BY_DEFAULT"


def test_llm_summary_falls_back_on_unsupported_number_and_claim():
    evidence = {"solver": {"status": "success", "objective_value": 10}}
    generic = generic_explainer.explain(evidence)
    candidate = {
        "summary": "保证收益 999 元",
        "facts": ["目标值 999"],
        "limitations": [],
    }
    output, audit = llm_summarizer.summarize(
        evidence=evidence,
        generic_explanation=generic,
        enabled=True,
        generator=lambda _payload: candidate,
    )
    assert output is generic
    assert audit["fallback_used"]
    assert any("UNSUPPORTED" in reason for reason in audit["reasons"])


def test_llm_summary_requires_and_preserves_valid_evidence_references():
    evidence = {
        "solver": {"status": "success", "objective_value": 10},
        "evidence_index": {"solver": ["solver.status", "solver.objective_value"]},
    }
    generic = generic_explainer.explain(evidence)
    candidate = {
        "summary": "目标值为 10。",
        "facts": generic["facts"],
        "fact_items": generic["fact_items"],
        "inferences": generic["inferences"],
        "inference_items": generic["inference_items"],
        "recommendations": generic["recommendations"],
        "recommendation_items": generic["recommendation_items"],
        "limitations": generic["limitations"],
    }
    output, audit = llm_summarizer.summarize(
        evidence=evidence,
        generic_explanation=generic,
        enabled=True,
        generator=lambda _payload: candidate,
    )
    assert audit["valid"] is True
    assert all(item["evidence_refs"] for item in output["fact_items"])
    assert output["explanation_schema_version"] == "2.0"


def test_llm_summary_falls_back_on_unknown_evidence_reference():
    evidence = {
        "solver": {"status": "success", "objective_value": 10},
        "evidence_index": {"solver": ["solver.status", "solver.objective_value"]},
    }
    generic = generic_explainer.explain(evidence)
    fact_items = [dict(item) for item in generic["fact_items"]]
    fact_items[0]["evidence_refs"] = ["not.real"]
    candidate = {
        "summary": "目标值为 10。",
        "facts": generic["facts"],
        "fact_items": fact_items,
        "inferences": generic["inferences"],
        "inference_items": generic["inference_items"],
        "recommendations": generic["recommendations"],
        "recommendation_items": generic["recommendation_items"],
        "limitations": generic["limitations"],
    }
    output, audit = llm_summarizer.summarize(
        evidence=evidence,
        generic_explanation=generic,
        enabled=True,
        generator=lambda _payload: candidate,
    )
    assert output is generic
    assert audit["fallback_used"] is True
    assert any("UNKNOWN_EVIDENCE_REFS" in reason for reason in audit["reasons"])
