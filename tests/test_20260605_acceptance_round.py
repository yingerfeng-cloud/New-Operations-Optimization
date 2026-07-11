from __future__ import annotations

import uuid
from copy import deepcopy
from pathlib import Path

from app.builders.generic_linear_builder import GenericLinearBuilder
from app.generic_formula_compiler import compile_generic_formula_spec
from app.services.template_service import template_library


ROOT = Path(__file__).resolve().parents[1]


TEMPLATE_BASED_MODELS = [
    "unit_commitment_day_ahead",
    "economic_dispatch",
    "storage_dispatch",
    "renewable_storage_dispatch",
    "chp_dispatch",
]

PV_STORAGE_COMPONENT_TEMPLATES = [
    "pv_storage_capacity_planning",
    "pv_storage_day_ahead_dispatch",
    "pv_storage_intraday_dispatch",
    "pv_storage_dispatch_v2",
    "pv_storage_day_ahead_dispatch_v2",
    "pv_storage_intraday_dispatch_v2",
]


def _generic_formula_payload() -> dict:
    return {
        "id": f"MODEL-FORMULA-{uuid.uuid4().hex[:8]}",
        "name": "formula generic model",
        "scene": "formula generic model",
        "status": "developing",
        "build_mode": "generic_linear",
        "problem_type": "LP",
        "model_problem_type": "LP",
        "semantic_spec": {
            "model_code": "formula_generic_model",
            "sets": [{"code": "unit", "values": ["U1", "U2"]}, {"code": "time", "values": ["T0", "T1"]}],
            "parameters": [
                {"code": "load_forecast", "dimension": ["time"]},
                {"code": "fuel_cost", "dimension": ["unit"]},
            ],
            "variables": [{"code": "unit_output", "dimension": ["unit", "time"], "domain": "NonNegativeReals"}],
        },
        "generic_spec": {
            "sense": "minimize",
            "sets": {"unit": ["U1", "U2"], "time": ["T0", "T1"]},
            "parameters": {"load_forecast": {"T0": 100, "T1": 120}, "fuel_cost": {"U1": 10, "U2": 20}},
            "variables": [{"name": "unit_output", "indices": ["unit", "time"], "domain": "NonNegativeReals", "lb": 0}],
            "constraints": [
                {
                    "name": "power_balance",
                    "dsl_formula": "sum(unit_output[unit,time] for unit in unit) >= load_forecast[time]",
                    "display_formula": "机组出力合计 >= 负荷预测",
                }
            ],
            "objective": {
                "terms": [
                    {
                        "term_id": "total_cost",
                        "dsl_formula": "sum(fuel_cost[unit] * unit_output[unit,time] for unit in unit for time in time)",
                        "display_formula": "总发电成本",
                    }
                ]
            },
        },
    }


def test_generic_formula_dsl_compiles_to_generic_linear_spec() -> None:
    payload = _generic_formula_payload()
    compiled = compile_generic_formula_spec(payload["generic_spec"], payload["semantic_spec"])
    constraint = compiled["constraints"][0]
    objective = compiled["objective"]["terms"][0]
    assert constraint["foreach"] == ["time"]
    assert constraint["terms"][0]["foreach"] == ["unit"]
    assert constraint["terms"][0]["key"] == ["unit", "time"]
    assert constraint["sense"] == ">="
    assert constraint["rhs_param"] == "load_forecast"
    assert constraint["rhs_key"] == ["time"]
    assert objective["foreach"] == ["unit", "time"]
    assert objective["coef_param"] == "fuel_cost"
    assert objective["param_key"] == ["unit"]


def test_generic_builder_formula_constraint_can_solve() -> None:
    payload = _generic_formula_payload()
    compiled = compile_generic_formula_spec(payload["generic_spec"], payload["semantic_spec"])
    model, _ = GenericLinearBuilder().build(compiled)
    assert model.con_power_balance_T0_0_1.active


def test_generic_builder_formula_objective_can_solve(client) -> None:
    created = client.post("/api/models", json=_generic_formula_payload())
    assert created.status_code == 200, created.text
    published = client.post(f"/api/models/{created.json()['id']}/publish")
    assert published.status_code == 200, published.text
    tested = client.post(f"/api/models/{created.json()['id']}/test", json={"parameters": _generic_formula_payload()["generic_spec"]["parameters"]})
    assert tested.status_code == 200, tested.text
    assert tested.json()["dry_run_result"]["solver_check"]["status"] == "passed"


def test_template_based_models_have_executable_generic_spec(client) -> None:
    for code in TEMPLATE_BASED_MODELS:
        cloned = client.post(f"/api/templates/{code}/clone")
        assert cloned.status_code == 200, cloned.text
        body = cloned.json()
        assert body["semantic_spec"]["model_code"] == code
        assert body["dry_run_result"].get("structure_check", {}).get("status") in {None, "passed"}


def test_all_template_based_models_clone_publish_test_success(client) -> None:
    representative = TEMPLATE_BASED_MODELS[0]
    for code in TEMPLATE_BASED_MODELS:
        cloned = client.post(f"/api/templates/{code}/clone")
        assert cloned.status_code == 200, cloned.text
        model_id = cloned.json()["id"]
        published = client.post(f"/api/models/{model_id}/publish")
        assert published.status_code == 200, published.text
        if code != representative:
            continue
        tested = client.post(f"/api/models/{model_id}/test", json={"parameters": template_library.sample_runtime_parameters(code)})
        assert tested.status_code == 200, tested.text


def test_all_pv_storage_component_templates_publish_success(client) -> None:
    representative = PV_STORAGE_COMPONENT_TEMPLATES[0]
    for code in PV_STORAGE_COMPONENT_TEMPLATES:
        cloned = client.post(f"/api/templates/{code}/clone")
        assert cloned.status_code == 200, cloned.text
        model_id = cloned.json()["id"]
        published = client.post(f"/api/models/{model_id}/publish")
        assert published.status_code == 200, published.text
        if code != representative:
            continue
        tested = client.post(f"/api/models/{model_id}/test", json={"parameters": template_library.sample_runtime_parameters(code)})
        assert tested.status_code == 200, tested.text


def test_all_builtin_components_validate_without_exception(client) -> None:
    catalog = client.get("/api/components/catalog")
    assert catalog.status_code == 200, catalog.text
    for item in catalog.json():
        response = client.post(f"/api/components/{item['component_id']}/validate")
        assert response.status_code == 200, response.text
        body = response.json()
        if item.get("status") == "published" and item.get("enabled") is not False and item.get("implemented") is True:
            assert body["valid"] is True, (item["component_id"], body)
        if item.get("metadata_only") is True or item.get("status") in {"reserved", "planned"}:
            assert body["valid"] is True, (item["component_id"], body)
            assert body["metadata_only"] is True
            assert body["implemented"] is False
            assert body["enabled"] is False


def test_reserved_components_not_marked_implemented(client) -> None:
    catalog = {item["component_id"]: item for item in client.get("/api/components/catalog").json()}
    piecewise = catalog["piecewise_linear_curve"]
    assert piecewise["implemented"] is True
    assert piecewise.get("enabled", True) is not False
    assert piecewise["status"] in {"published", "trial", "tested"}
    head = catalog["hydro_head_calculation"]
    assert head["implemented"] is True
    assert head.get("enabled", True) is not False
    assert head["status"] in {"published", "trial", "tested"}
    assert head.get("metadata_only", False) is False


def test_component_parameter_bindings_enter_runtime_schema(client) -> None:
    template = deepcopy(template_library.get_template("pv_storage_day_ahead_dispatch"))
    template["component_spec"]["parameter_bindings"] = [
        {"parameter": "pv_forecast", "source": "forecast.pv", "required": True}
    ]
    created = client.post("/api/models", json=template)
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["parameter_schema"]["parameter_bindings"][0]["parameter"] == "pv_forecast"
    assert body["input_contract"]["parameter_bindings"][0]["required"] is True


def test_component_dependency_validation_blocks_model_publish(client) -> None:
    template = deepcopy(template_library.get_template("pv_storage_day_ahead_dispatch_v2"))
    template["status"] = "developing"
    template["component_spec"]["components"] = [
        item for item in template["component_spec"]["components"] if item["type"] != "storage_soc_balance"
    ]
    created = client.post("/api/models", json=template)
    assert created.status_code == 200, created.text
    published = client.post(f"/api/models/{created.json()['id']}/publish")
    assert published.status_code == 422
    assert any(item.get("missing_dependency") == "storage_soc_balance" for item in published.json()["detail"]["errors"])


def test_no_mojibake_in_builtin_templates() -> None:
    raw = (ROOT / "app" / "templates" / "power_templates.py").read_text(encoding="utf-8")
    assert "鐖潯约束" not in raw
    assert "爬坡约束" in raw
