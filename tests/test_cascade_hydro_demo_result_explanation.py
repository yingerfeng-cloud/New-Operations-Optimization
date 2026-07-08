def test_cascade_hydro_demo_result_explanation_shape() -> None:
    result = {
        "problem_type": "MILP",
        "solver": "HiGHS",
        "metrics": {
            "total_generation_MWh": 1000,
            "total_spill_million_m3": 0,
            "total_abs_load_deviation_MW": 1.5,
            "terminal_storage_deviation": 0.1,
        },
        "business_output": {
            "storage_curve": [{"time": 0, "reservoir": "R1", "storage": 100}],
            "power_curve": [{"time": 0, "reservoir": "R1", "power": 50}],
            "function_asset_interpolation": [
                {
                    "level_storage": {"function_asset_id": "cascade_hydro_level_storage_v1"},
                    "tailwater_outflow": {"function_asset_id": "cascade_hydro_tailwater_outflow_v1"},
                    "power_surface": {"function_asset_id": "cascade_hydro_power_surface_v1", "selected_triangle": [0, 1, 2], "lambda": [0.2, 0.3, 0.5]},
                }
            ],
        },
    }
    assert result["metrics"]["total_generation_MWh"] == 1000
    assert result["business_output"]["function_asset_interpolation"][0]["power_surface"]["selected_triangle"]
