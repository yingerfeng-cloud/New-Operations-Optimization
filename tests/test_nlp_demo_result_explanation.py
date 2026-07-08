def test_nlp_demo_result_contains_required_explanation_fields() -> None:
    result = {
        "solver": "Ipopt",
        "solver_type": "NLP",
        "problem_type": "NLP",
        "termination_condition": "locallyOptimal",
        "objective_value": 42.0,
        "solve_time": 0.2,
        "constraint_violation_summary": {"max_violation": 0.0},
        "local_optimum_warning": True,
    }
    assert result["solver"] == "Ipopt"
    assert result["problem_type"] == "NLP"
    assert result["termination_condition"]
    assert result["local_optimum_warning"] is True
