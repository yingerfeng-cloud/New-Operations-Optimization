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
        "metrics",
        "timeseries",
        "business_output",
        "explanation",
        "raw",
    ]


def test_result_capabilities_do_not_use_model_code() -> None:
    capabilities = JobRunner._result_capabilities({"model_code": "cascade_hydro_dispatch_v1", "problem_type": "LP"})
    assert capabilities == ["metrics", "raw"]


def test_storage_curve_does_not_imply_a_hydro_specific_view() -> None:
    capabilities = JobRunner._result_capabilities(
        {
            "problem_type": "MILP",
            "business_output": {"storage_curve": [{"time": 1, "soc": 0.5}]},
        }
    )

    assert capabilities == ["metrics", "business_output", "raw"]
    assert "hydro_process" not in capabilities
