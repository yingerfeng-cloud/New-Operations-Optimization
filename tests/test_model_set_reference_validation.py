from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services.model_set_reference_validator import validate_set_references


client = TestClient(app)


def test_scoped_time_iterator_may_index_superset_state_axis_but_not_wrong_members():
    semantic = {'sets': [{'code': 'time', 'values': [0, 1]}, {'code': 'state_time', 'values': [0, 1, 2]}],
                'variables': [{'code': 'soc', 'dimension': ['state_time']}]}
    generic = {'constraints': [{'terms': [{'var': 'soc', 'key': ['time']}]}]}
    assert validate_set_references(semantic_spec=semantic, component_spec={}, generic_spec=generic) == []
    generic['constraints'][0]['terms'][0]['key'] = ['wrong']
    errors = validate_set_references(semantic_spec=semantic, component_spec={}, generic_spec=generic)
    assert errors[0]['error'] == 'index_member_not_found'
    semantic['sets'][0]['values'] = [0, 9]
    generic['constraints'][0]['terms'][0]['key'] = ['time']
    assert validate_set_references(semantic_spec=semantic, component_spec={}, generic_spec=generic)[0]['error'] == 'index_member_not_found'


def _errors(**overrides):
    payload = {
        "semantic_spec": {"sets": [{"code": "time", "values": [0, 1]}]},
        "component_spec": {},
        "generic_spec": {},
        "model_draft": {},
    }
    payload.update(overrides)
    return validate_set_references(**payload)


def test_parameter_and_variable_references_must_exist() -> None:
    errors = _errors(semantic_spec={
        "sets": [{"code": "time", "values": [0, 1]}],
        "parameters": [{"code": "initial_soc", "dimension": ["time_volume"]}],
        "variables": [{"code": "dispatch", "indices": ["missing_period"]}],
    })
    assert {item["set"] for item in errors} == {"time_volume", "missing_period"}
    assert all(item["error"] == "set_reference_not_found" for item in errors)


def test_literal_business_members_are_coordinates_not_set_names():
    semantic = {"sets": [{"code": "origin", "values": ["A", "B"]}, {"code": "destination", "values": ["X", "Y"]}],
                "variables": [{"code": "shipment", "dimension": ["origin", "destination"]}],
                "parameters": [{"code": "supply", "dimension": ["origin"]}]}
    generic = {"sets": {"origin": ["A", "B"], "destination": ["X", "Y"]},
               "constraints": [{"terms": [{"var": "shipment", "key": ["A", "X"]}],
                                "rhs_terms": [{"factors": [{"parameter": "supply", "indices": ["A"]}]}]}]}
    assert _errors(semantic_spec=semantic, generic_spec=generic) == []
    generic["constraints"][0]["terms"][0]["key"] = ["X", "A"]
    errors = _errors(semantic_spec=semantic, generic_spec=generic)
    assert len(errors) == 2 and all(row["error"] == "index_member_not_found" for row in errors)


def test_generic_constraint_structured_index_must_exist() -> None:
    errors = _errors(generic_spec={
        "sets": {"time": [0, 1]},
        "constraints": [{"name": "balance", "indices": [{"set": "period", "alias": "t"}], "expression": "x[t] == 1"}],
    })
    assert any(item["set"] == "period" and item["field"].endswith("indices") for item in errors)


def test_component_contract_set_reference_must_exist() -> None:
    errors = _errors(component_spec={
        "sets": [{"code": "time", "values": [0, 1]}],
        "parameters": [{"code": "schedule", "dimensions": ["dispatch_slot"]}],
        "components": [{"component_id": "tracker", "index_sets": ["time", "state_slot"]}],
    })
    assert {item["set"] for item in errors} == {"dispatch_slot", "state_slot"}


def test_formula_text_is_not_guessed() -> None:
    errors = _errors(generic_spec={
        "sets": {"time": [0, 1]},
        "constraints": [{"name": "display_only", "expression": "sum(x[p] for p in missing_set) == 1"}],
    })
    assert errors == []


def test_model_draft_formula_referenced_sets_must_exist() -> None:
    errors = _errors(model_draft={
        "semantic": {"sets": [{"code": "time", "values": [0, 1]}]},
        "formulas": [{"formula_id": "constraint_1", "referenced_sets": ["ghost"], "free_indices": []}],
    })
    assert any(item["field"] == "model_draft.formulas[0].referenced_sets" and item["set"] == "ghost" for item in errors)


def test_model_draft_formula_unscoped_free_index_is_validated_as_set() -> None:
    errors = _errors(model_draft={
        "semantic": {"sets": [{"code": "time", "values": [0, 1]}]},
        "formulas": [{"formula_id": "constraint_1", "referenced_sets": [], "free_indices": ["ghost"], "foreach": []}],
    })
    assert any(item["field"] == "model_draft.formulas[0].free_indices" and item["set"] == "ghost" for item in errors)


def test_model_draft_formula_valid_sets_and_scoped_aliases_pass() -> None:
    errors = _errors(model_draft={
        "semantic": {"sets": [{"code": "time", "values": [0, 1]}]},
        "formulas": [{"formula_id": "constraint_1", "referenced_sets": ["time"], "free_indices": ["t"], "foreach": ["time"]}],
    })
    assert errors == []


def test_publish_ready_model_creation_blocks_dangling_reference() -> None:
    response = client.post("/api/models", json={
        "name": "悬空集合发布测试",
        "scene": "test",
        "status": "published",
        "build_mode": "generic_linear",
        "semantic_spec": {
            "sets": [{"code": "time", "values": [0, 1], "type": "time_period"}],
            "parameters": [{"code": "load", "dimension": ["missing_period"]}],
            "variables": [{"code": "dispatch", "dimension": ["time"], "domain": "NonNegativeReals"}],
        },
        "generic_spec": {
            "sets": {"time": [0, 1]},
            "parameters": {"load": [1, 1]},
            "variables": [{"name": "dispatch", "indices": ["time"], "domain": "NonNegativeReals"}],
            "constraints": [],
            "objective": {"sense": "minimize", "terms": [{"var": "dispatch", "foreach": ["time"], "key": ["time"], "coef": 1}]},
        },
        "ui_metadata": {"time_dimension": {"schema_version": 1, "enabled": True, "policy": "fixed", "default_horizon": 2, "time_set": "time", "state_time_set": None, "editable": False}},
    })
    assert response.status_code == 422
    assert any(item["error"] == "set_reference_not_found" for item in response.json()["detail"]["errors"])
