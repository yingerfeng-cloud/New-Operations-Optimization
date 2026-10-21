from copy import deepcopy

from app.explainers.evidence_builder import evidence_builder
from app.schemas.solve import SolveRequest, TaskRecord
from app.services.result_diagnostics import result_diagnostics
from app.services.result_presentation import apply_result_presentation
from tests.test_manual_workflow_repairs import curve_payload, solve_publish


def measured_result():
    return {
        "status": "SUCCESS", "raw_termination_condition": "optimal", "solver_type": "LP", "solver_available": False,
        "solution_evidence": {
            "constraints": [
                {"key": "demand[0]", "body": 10, "lower": 10, "upper": None, "violation": 0},
                {"key": "capacity[0]", "body": 8, "lower": None, "upper": 5, "violation": 3},
                {"key": "range[0]", "body": 3, "lower": 0, "upper": 10, "violation": 0},
            ],
            "variable_checks": [{"key": "p[0]", "violation": 2, "integrality_violation": 0}],
        },
    }


def test_measured_checks_expose_lower_bounds_violations_and_task_diagnostics_without_mutation():
    result = measured_result()
    original = deepcopy(result)
    diagnostics = result_diagnostics(result)
    checks = diagnostics["constraint_checks"]
    assert [item["status"] for item in checks] == ["binding", "violated", "satisfied"]
    assert [item["margin"] for item in checks] == [0, -3, 3]
    assert checks[0]["lower"] == 10 and checks[0]["value"] == 10
    assert checks[1]["source_ref"] == "solution_evidence.constraints.1"
    summary = diagnostics["constraint_violation_summary"]
    assert (summary["checked_count"], summary["violated_count"], summary["max_violation"]) == (3, 1, 3)
    assert (summary["variable_checked_count"], summary["bound_violated_count"]) == (1, 1)
    view = TaskRecord(id="legacy-measured", request=SolveRequest(), result=result).view()
    assert view.termination_condition == "optimal" and view.problem_type == "LP"
    assert view.solver_available is False
    assert view.constraint_violation_summary == summary
    assert result == original
    assert result_diagnostics({**result, **diagnostics}) == diagnostics


def test_no_evidence_does_not_manufacture_a_pass_and_empty_summary_is_not_constraint_detail():
    result = {"status": "SUCCESS"}
    assert "constraint_checks" not in result_diagnostics(result)
    evidence = evidence_builder.build(result=result, model={}, skill_name=None)
    assert "结果未返回可核验的约束检查明细。" in evidence["explanation_limits"]
    evidence = evidence_builder.build(
        result={"status": "SUCCESS", "constraint_violation_summary": {"violations": [], "max_violation": 0, "violated_count": 0}},
        model={}, skill_name=None,
    )
    assert evidence["constraint_checks"] == []


def test_partial_invalid_measurements_stay_unchecked():
    result = measured_result()
    result["solution_evidence"]["constraints"][1]["body"] = None
    summary = result_diagnostics(result)["constraint_violation_summary"]
    assert summary["checked_count"] == 2 and summary["unchecked_count"] == 1
    presented = apply_result_presentation(result)
    assert "constraint_checks" in presented["result_capabilities"]
    evidence = evidence_builder.build(result=result, model={}, skill_name=None)
    assert "有 1 条约束缺少可核验数值，未完成检查。" in evidence["explanation_limits"]


def test_real_curve_task_and_skill_share_complete_measured_constraint_details(client):
    _, payload = curve_payload(client)
    mid, task, result = solve_publish(client, payload, 40)
    view = client.get(f"/api/tasks/{task['id']}").json()
    assert view["termination_condition"] == "optimal"
    assert view["solver_available"] is True
    summary = view["constraint_violation_summary"]
    assert summary["checked_count"] == len(result["solution_evidence"]["constraints"]) > 2
    assert summary["violated_count"] == 0 and summary["max_violation"] == 0
    assert summary["unchecked_count"] == 0
    assert len(result["constraint_checks"]) == summary["checked_count"]
    assert len(result["evidence_package"]["constraint_checks"]) == summary["checked_count"]
    assert "结果未返回可核验的约束检查明细。" not in result["evidence_package"]["explanation_limits"]
    assert "constraint_checks" in result["result_capabilities"]
    called = client.post(f"/api/skills/run_{payload['template_id']}/run", json={
        "parameters": {"demand": [10, 20], "delta_t": .5}, "options": {"mode": "sync", "explain": True},
    })
    assert called.status_code == 200, called.text
    skill = called.json()
    assert skill["objective_value"] == 40
    assert len(skill["constraint_checks"]) == summary["checked_count"]
    assert len(skill["evidence_package"]["constraint_checks"]) == summary["checked_count"]
    assert "结果未返回可核验的约束检查明细。" not in skill["evidence_package"]["explanation_limits"]
