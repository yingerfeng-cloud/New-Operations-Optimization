from app.explainers.evidence_builder import evidence_builder


def test_evidence_builder_summarizes_solver_variables_and_constraints():
    evidence = evidence_builder.build(
        result={"status": "SUCCESS", "objective_value": 12.5, "variable_values": {"x": {"t1": 0, "t2": 3}}, "constraint_checks": [{"name": "cap", "value": 3, "limit": 3}]},
        model={"id": "M1", "version": "v1", "semantic_spec": {"variables": [{"math_var": "x", "name": "出力", "unit": "MW", "dimension": ["time"]}]}},
        skill_name="run_demo",
        parameters={"capacity": 3},
        parameter_sources={"capacity": "USER_INPUT"},
    )
    assert evidence["solver"]["objective_value"] == 12.5
    assert evidence["variables_summary"][0]["max"] == 3
    assert evidence["constraint_checks"][0]["status"] == "binding"
    assert evidence["model"]["profile_name"] == "generic"
