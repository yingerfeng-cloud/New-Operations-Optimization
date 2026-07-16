from app.explainers.generic_explainer import generic_explainer


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
