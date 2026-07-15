from app.jobs.job_runner import JobRunner


def test_result_capabilities_are_structure_driven() -> None:
    result = {
        "problem_type": "MILP",
        "variable_values": {"power": [1, 2]},
        "business_output": {
            "storage_curve": [{"time": 1, "storage": 10}],
            "power_curve": [{"time": 1, "power": 2}],
            "function_asset_interpolation": [{"triangle": 1}],
        },
        "business_explanation": {"summary": "ok"},
    }
    capabilities = JobRunner._result_capabilities(result)
    assert capabilities == [
        "summary",
        "variable_series",
        "hydro_process",
        "dispatch_series",
        "pwl_diagnostics",
        "business_explanation",
        "raw_result",
    ]


def test_result_capabilities_do_not_use_model_code() -> None:
    capabilities = JobRunner._result_capabilities({"model_code": "cascade_hydro_dispatch_v1", "problem_type": "LP"})
    assert capabilities == ["summary", "raw_result"]
