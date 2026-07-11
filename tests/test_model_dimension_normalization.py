from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.model_dimensions import extract_dimensions, validate_dimension_field_consistency
from app.schemas.time_dimension import validate_time_dimension_contract
from app.services.time_dimension_service import normalize_runtime_time_dimension
from app.services.model_set_reference_validator import validate_set_references


@pytest.mark.parametrize("field", ["dimension", "dimensions", "indices", "index_sets"])
def test_all_dimension_field_aliases_are_recognized(field: str) -> None:
    assert extract_dimensions({field: ["time"]}) == ["time"]
    assert extract_dimensions({field: "time"}) == ["time"]


def test_dimension_values_are_ordered_deduplicated_and_ignore_numbers() -> None:
    assert extract_dimensions({"dimension": ["unit", "time", "unit", 3, None]}) == ["unit", "time"]


def test_conflicting_dimension_fields_return_structured_error() -> None:
    errors = validate_dimension_field_consistency(
        {"dimension": ["unit", "time"], "dimensions": ["unit", "time_volume"]},
        path="semantic_spec.parameters[0]",
    )
    assert errors[0]["error"] == "dimension_fields_conflict"
    model_errors = validate_set_references(
        semantic_spec={"sets": [{"code": "unit"}, {"code": "time"}], "parameters": [{"code": "load", "dimension": ["unit", "time"], "dimensions": ["unit", "time_volume"]}]},
        component_spec={},
        generic_spec={},
    )
    assert any(item["error"] == "dimension_fields_conflict" for item in model_errors)


def test_dimensions_alias_participates_in_publish_sample_validation() -> None:
    errors, _ = validate_time_dimension_contract(
        config={"schema_version": 1, "enabled": True, "policy": "fixed", "default_horizon": 4, "time_set": "time", "state_time_set": None, "editable": False},
        semantic_spec={
            "sets": [{"code": "time", "values": [0, 1, 2, 3], "type": "time_period"}],
            "parameters": [{"code": "load", "dimensions": ["time"], "default": [1, 2]}],
        },
        component_spec={},
        generic_spec={},
        parameters={"load": [1, 2]},
        require_publish_ready=True,
    )
    assert any(item["field"] == "parameters.load" and item["expected"] == 4 for item in errors)


def test_data_derived_and_runtime_length_validation_support_dimensions_alias() -> None:
    semantic = {
        "sets": [{"code": "time", "values": [0, 1]}],
        "parameters": [{"code": "load", "dimensions": ["time"]}],
    }
    config = {"schema_version": 1, "enabled": True, "policy": "data_derived", "time_set": "time", "state_time_set": None, "derive_from": "load", "editable": False}
    params, _, _, _ = normalize_runtime_time_dimension(
        semantic_spec=semantic,
        component_spec=None,
        generic_spec=None,
        runtime_parameters={"load": [1, 2, 3]},
        explicit_horizon=None,
        explicitly_provided_keys={"load"},
        time_dimension=config,
    )
    assert params["horizon"] == 3

    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec=semantic,
            component_spec=None,
            generic_spec=None,
            runtime_parameters={"load": [1, 2]},
            explicit_horizon=4,
            explicitly_provided_keys={"load", "horizon"},
            time_dimension={"schema_version": 1, "enabled": True, "policy": "runtime_variable", "default_horizon": 2, "time_set": "time", "state_time_set": None, "editable": True},
        )
    assert exc.value.detail["errors"][0]["field"] == "load"
