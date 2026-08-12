from app.services.result_presentation import apply_result_presentation


def _view_contract(result: dict) -> list[tuple[str, str, str]]:
    return [
        (view["key"], view["label"], view["kind"])
        for view in apply_result_presentation(result)["result_views"]
    ]


def test_domain_specific_output_uses_the_same_model_neutral_views() -> None:
    compute_power = {
        "metrics": {"objective_value": 14645.7},
        "variable_values": {"grid_power": [1.0, 2.0]},
        "business_output": {"storage_curve": [{"time": 0, "soc": 0.5}]},
    }
    hydro = {
        "metrics": {"objective_value": 268736.1},
        "variable_values": {"hydro_power": [3.0, 4.0]},
        "business_output": {"storage_curve": [{"time": 0, "volume": 100.0}]},
    }

    expected = [
        ("overview", "结果概览", "metrics"),
        ("curves", "变量曲线", "timeseries"),
        ("business_output", "业务输出", "business_output"),
        ("raw", "原始结果", "raw"),
    ]
    assert _view_contract(compute_power) == expected
    assert _view_contract(hydro) == expected


def test_presentation_replaces_stale_domain_specific_metadata() -> None:
    normalized = apply_result_presentation(
        {
            "metrics": {"objective_value": 1},
            "business_output": {"storage_curve": [{"time": 0, "soc": 0.5}]},
            "result_capabilities": ["hydro_process", "raw_result"],
            "result_metadata": {
                "capabilities": ["hydro_process", "raw_result"],
                "views": [{"key": "reservoir", "label": "水库过程", "kind": "hydro_process"}],
            },
        }
    )

    assert normalized["result_capabilities"] == ["metrics", "business_output", "raw"]
    assert normalized["result_metadata"]["capabilities"] == normalized["result_capabilities"]
    assert normalized["result_metadata"]["views"] == normalized["result_views"]
    assert normalized["result_metadata"]["presentation_schema_version"] == "1.0"
    assert all(view["label"] != "水库过程" for view in normalized["result_views"])
