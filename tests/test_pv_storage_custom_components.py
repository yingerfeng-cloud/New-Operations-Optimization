from __future__ import annotations

from app.model_components.formula_components import validate_component_definition
from app.services.model_service import model_service
from app.storage.memory_store import STORE


def _component(component_id: str) -> dict:
    model_service.seed_default_templates()
    return STORE.custom_components[component_id]


def test_pv_storage_v2_components_validate() -> None:
    for component_id in ["deviation_penalty_component", "storage_charge_discharge_exclusive", "storage_soc_bounds"]:
        result = validate_component_definition(_component(component_id))
        assert result["valid"], result["errors"]


def test_storage_charge_discharge_exclusive_declares_binary_variables() -> None:
    component = _component("storage_charge_discharge_exclusive")
    variables = {item["code"]: item for item in component["variables"]}

    assert variables["u_ch"]["domain"] == "Binary"
    assert variables["u_dis"]["domain"] == "Binary"
    assert any("storage_power_capacity * u_ch[t]" in item["expression"] for item in component["constraints"])


def test_invalid_variable_product_is_rejected() -> None:
    component = {
        "component_id": "invalid_product_component",
        "sets": [{"code": "time"}],
        "variables": [
            {"code": "x", "dimension": ["time"], "domain": "NonNegativeReals"},
            {"code": "y", "dimension": ["time"], "domain": "NonNegativeReals"},
        ],
        "constraints": [{"constraint_id": "bad", "indices": ["time"], "expression": "x[t] * y[t] <= 1"}],
    }

    result = validate_component_definition(component)
    assert result["valid"] is False
    assert result["errors"]
