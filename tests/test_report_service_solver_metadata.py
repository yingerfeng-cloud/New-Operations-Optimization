from pathlib import Path

from app.services.report_service import ReportExportRequest, report_service


def test_report_service_uses_dynamic_solver_metadata_for_nlp() -> None:
    report = report_service.export(
        ReportExportRequest(
            scenario="nonlinear_hydro_power_demo",
            solve_result={
                "status": "SUCCESS",
                "job_id": "TASK-NLP",
                "model_code": "nonlinear_hydro_power_demo",
                "solver": "Ipopt",
                "problem_type": "NLP",
                "termination_condition": "locallyOptimal",
                "constraint_violation_summary": {"max_violation": 0},
                "metrics": {"objective_value": 123},
                "business_output": {"variable_values": {"flow": [1, 2]}},
                "business_explanation": {"summary": "NLP result"},
            },
            format="html",
        )
    )
    text = Path(report["file_path"]).read_text(encoding="utf-8")
    assert "求解器：Ipopt" in text
    assert "问题类型：NLP" in text
    assert "模型编码：nonlinear_hydro_power_demo" in text
    assert "局部最优风险：是" in text
    assert "求解器：HiGHS" not in text
