from __future__ import annotations

from copy import deepcopy
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.model_draft import build_component_spec_from_draft, build_constraints_from_draft, build_mathematical_expansion
from app.model_components.registry import list_component_catalog
from app.schemas.model import ModelPackage
from app.services.model_service import model_service
from app.templates.power_templates import get_template


client = TestClient(app)


def test_model_draft_generates_component_spec() -> None:
    template = get_template("cascade_hydro_dispatch")
    draft = deepcopy(template["model_draft"])
    draft["components"][0]["enabled"] = False

    component_spec = build_component_spec_from_draft(draft)

    assert component_spec["build_mode"] == "component_based"
    assert component_spec["components"][0]["type"] != "hydro_initial_volume"
    assert component_spec["objective"]["terms"]


def test_model_draft_persists_parameter_bindings_on_component_instances() -> None:
    template = get_template("cascade_hydro_dispatch")
    draft = deepcopy(template["model_draft"])
    component = draft["components"][0]
    component["parameter_bindings"] = [
        {
            "component_parameter": "initial_volume",
            "model_parameter": "reservoir_initial_volume",
            "required": True,
            "status": "bound",
        }
    ]

    component_spec = build_component_spec_from_draft(draft)

    saved_component = next(item for item in component_spec["components"] if item["type"] == component["type"])
    assert saved_component["parameter_bindings"][0]["model_parameter"] == "reservoir_initial_volume"
    assert component_spec["parameter_bindings"][0]["component_id"] == component["type"]


def test_model_service_validates_model_parameter_as_a_complete_instance_binding() -> None:
    package = ModelPackage(
        name="binding-contract",
        scene="test",
        build_mode="component_based",
        component_spec={
            "components": [{
                "type": "efficiency_component",
                "parameter_bindings": [{
                    "component_parameter": "efficiency",
                    "model_parameter": "plant_efficiency",
                    "required": True,
                }],
            }],
        },
    )

    bindings = model_service._collect_parameter_bindings(package)

    assert bindings == [{
        "component_parameter": "efficiency",
        "model_parameter": "plant_efficiency",
        "required": True,
        "component_id": "efficiency_component",
        "component_index": 0,
    }]
    assert model_service._validate_required_parameter_bindings(package) == []


def test_component_registry_exposes_lifecycle_and_registered_builder() -> None:
    catalog = list_component_catalog()
    reservoir = next(item for item in catalog if item["component_id"] == "hydro_reservoir_balance")

    assert reservoir["version"] == "1.0.0"
    assert reservoir["status"] == "published"
    assert reservoir["backend_builder"] == "hydro_reservoir_balance"
    assert "implemented" not in reservoir
    assert "enabled" not in reservoir
    assert "hydro_cascade_inflow_delay" in reservoir["depends_on"]
    assert reservoir["generated_constraints"][0]["type"] == "state_transition"


def test_hydro_component_parameter_contract_only_lists_consumed_inputs() -> None:
    catalog = {item["component_id"]: item for item in list_component_catalog()}

    initial = catalog["hydro_initial_volume"]
    assert [item["code"] for item in initial["parameters"]] == ["initial_volume"]
    assert initial["inputs"] == ["initial_volume"]

    cascade = catalog["hydro_cascade_inflow_delay"]
    assert [item["code"] for item in cascade["parameters"]] == ["local_inflow", "edges"]
    assert next(item for item in cascade["parameters"] if item["code"] == "edges")["dimension"] == ["edge"]


def test_hydro_formula_contract_exposes_derived_symbols_without_binding_them() -> None:
    catalog = {item["component_id"]: item for item in list_component_catalog()}
    capacity = catalog["hydro_station_available_capacity"]
    reservoir = catalog["hydro_reservoir_balance"]

    assert [item["code"] for item in capacity["parameters"]] == ["units", "unit_pmax", "availability"]
    assert [item["code"] for item in capacity["derived_parameters"]] == ["station_pmax"]
    assert [item["code"] for item in reservoir["derived_parameters"]] == ["delta_v"]
    balance = reservoir["generated_constraints"][0]
    assert "volume[s,tv+1]" in balance["expression"]
    assert balance["boundary_strategy"] == "skip_last"
    assert balance["scope"] == [
        {"alias": "s", "set": "station"},
        {"alias": "t", "set": "time"},
        {"alias": "tv", "set": "time_volume"},
    ]


def test_cascade_hydro_preview_formulas_use_non_conflicting_aggregate_aliases() -> None:
    terms = get_template("cascade_hydro_dispatch")["model_draft"]["objective"]["terms"]
    expressions = [str(item.get("expression") or item.get("dsl_formula")) for item in terms]
    assert all("for station in station" not in expression for expression in expressions)


def test_legacy_asset_without_parameter_schema_gets_contract_fallback() -> None:
    package = ModelPackage(
        name="legacy-schema",
        scene="test",
        semantic_spec={"parameters": [{"code": "horizon", "name": "时段数", "dimension": []}]},
        parameters={"horizon": 4},
    )

    schema = model_service._runtime_parameter_schema(package)

    assert schema["parameters"][0]["code"] == "horizon"


def test_constraints_generated_from_components_and_custom_constraints() -> None:
    template = get_template("cascade_hydro_dispatch")
    draft = deepcopy(template["model_draft"])
    draft["constraints"].append({"name": "limit_s1_t0", "expression": "station_power[S1,0] <= 120", "scope": "station,time"})

    constraints = build_constraints_from_draft(draft)

    assert any(row["source_component"] == "hydro_reservoir_balance" and row["core"] for row in constraints)
    assert any(row["constraint_id"] == "limit_s1_t0" and row["editable"] for row in constraints)


def test_objective_builder_terms_update_weights() -> None:
    template = get_template("cascade_hydro_dispatch")
    draft = deepcopy(template["model_draft"])
    term = next(item for item in draft["objective"]["terms"] if item["weight_key"] == "load_deviation")
    term["weight"] = 2000
    term["enabled"] = False
    component_spec = build_component_spec_from_draft(draft)

    saved_term = next(item for item in component_spec["objective"]["terms"] if item["weight_key"] == "load_deviation")
    assert saved_term["weight"] == 2000
    assert saved_term["enabled"] is False


def test_cascade_hydro_objective_terms_are_unique_by_backend_weight_key() -> None:
    template = get_template("cascade_hydro_dispatch")
    terms = template["model_draft"]["objective"]["terms"]
    weight_keys = [term["weight_key"] for term in terms]

    assert len(terms) == 6
    assert len(weight_keys) == len(set(weight_keys))
    assert set(weight_keys) == {"load_deviation", "spill", "terminal_volume", "ramp", "generation", "revenue"}
    load_term = next(term for term in terms if term["weight_key"] == "load_deviation")
    assert load_term["term_id"] == "load_tracking_penalty"
    assert load_term["source_component"] == "hydro_load_tracking"
    assert load_term["supported_by_backend"] is True


def test_multi_formula_hydro_components_have_distinct_display_names() -> None:
    catalog = {item["component_id"]: item for item in list_component_catalog()}

    for component_id in (
        "hydro_volume_bounds",
        "hydro_generation_flow_bounds",
        "hydro_outflow_bounds",
        "hydro_spill_bounds",
        "hydro_ramp_smoothing",
    ):
        constraints = catalog[component_id]["generated_constraints"]
        assert len(constraints) == 2
        assert len({constraint["constraint_id"] for constraint in constraints}) == 2
        assert len({constraint["name"] for constraint in constraints}) == 2


def test_math_expansion_generated_from_draft() -> None:
    template = get_template("cascade_hydro_dispatch")
    expansion = build_mathematical_expansion(template["model_draft"])

    assert expansion["source"] == "model_draft_generated"
    assert expansion["sections"]
    assert expansion["objective"]["terms"]


def test_hydro_template_is_recommended_draft_not_static_html() -> None:
    response = client.get("/api/templates/cascade_hydro_dispatch/model-draft")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["basic_info"]["model_code"] == "cascade_hydro_dispatch"
    assert body["components"][0]["definition"]["component_id"] == "hydro_initial_volume"


def test_save_model_package_contains_full_draft_fields() -> None:
    template = get_template("cascade_hydro_dispatch")
    package = ModelPackage(
        template_id="cascade_hydro_dispatch",
        name="draft-save-check",
        scene="梯级水电日前调度",
        build_mode="component_based",
        semantic_spec=template,
        component_spec=template["component_spec"],
        model_draft=template["model_draft"],
        parameters=template["sample_runtime_parameters"],
    )

    model = model_service.create_model(package)

    assert model.model_draft["mathematical_expansion"]["source"] == "model_draft_generated"
    assert model.objective_config["terms"]
    assert model.draft_constraints
    assert model.component_spec["objective"]["terms"]


def _component_package_with_constraint(expression: str) -> dict:
    template = get_template("cascade_hydro_dispatch")
    custom_code = f"cascade_hydro_dispatch_custom_{uuid.uuid4().hex[:8]}"
    component_spec = deepcopy(template["component_spec"])
    component_spec["model_code"] = custom_code
    component_spec["additional_custom_constraints"] = [{"name": "invalid_extra", "expression": expression, "scope": "station,time"}]
    return {
        "id": f"MODEL-TEST-{uuid.uuid4().hex[:8].upper()}",
        "template_id": custom_code,
        "name": "invalid-constraint-publish-check",
        "scene": "梯级水电日前调度",
        "status": "developing",
        "build_mode": "component_based",
        "semantic_spec": {**template, "code": custom_code, "model_code": custom_code, "component_spec": component_spec},
        "component_spec": component_spec,
        "parameters": template["sample_runtime_parameters"],
    }


def test_publish_rejects_invalid_additional_custom_constraints() -> None:
    cases = [
        ("not_a_var[S1,0] <= 10", "不存在的变量"),
        ("station_power[S9,0] <= 10", "不存在的索引"),
        ("sum(station_power[*,0]) <= 10", "表达式不合法"),
    ]
    for expression, expected in cases:
        created = client.post("/api/models", json=_component_package_with_constraint(expression))
        assert created.status_code == 200, created.text
        model_id = created.json()["id"]

        published = client.post(f"/api/models/{model_id}/publish")

        assert published.status_code == 422, published.text
        assert expected in published.text
        current = client.get(f"/api/models/{model_id}")
        assert current.status_code == 200, current.text
        assert current.json()["status"] == "developing"


def test_component_catalog_and_dependency_api() -> None:
    catalog = client.get("/api/components/catalog")
    assert catalog.status_code == 200, catalog.text
    assert any(item["component_id"] == "hydro_reservoir_balance" for item in catalog.json())

    detail = client.get("/api/components/hydro_reservoir_balance")
    assert detail.status_code == 200, detail.text
    assert "hydro_cascade_inflow_delay" in detail.json()["depends_on"]

    validation = client.post("/api/components/validate-dependencies", json={"components": [{"type": "hydro_reservoir_balance"}]})
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is False
    assert validation.json()["errors"][0]["missing_dependency"] == "hydro_cascade_inflow_delay"


def test_component_library_metadata_edit_version_and_references() -> None:
    component_id = f"custom_balance_{uuid.uuid4().hex[:8]}"
    payload = {
        "component_id": component_id,
        "name": "自定义平衡组件",
        "domain": "通用",
        "category": "基础组件",
        "version": "1.0.0",
        "depends_on": [],
        "generated_constraints": [{"constraint_id": "custom_balance", "name": "自定义平衡", "formula": "x[t] = y[t]"}],
        "generated_objective_terms": [{"term_id": "custom_penalty", "name": "自定义惩罚", "weight_key": "custom", "supported_by_backend": False}],
    }
    created = client.post("/api/components/catalog", json=payload)
    assert created.status_code == 200, created.text
    assert created.json()["component_id"] == component_id

    updated = client.put(f"/api/components/{component_id}", json={**payload, "version": "1.0.1", "change_note": "metadata revision"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["status"] == "draft"
    assert "enabled" not in updated.json()
    assert "implemented" not in updated.json()
    assert updated.json()["versions"][-1]["change_note"] == "metadata revision"

    copied = client.post(f"/api/components/{component_id}/copy-version", json={"version": "1.0.2", "change_note": "copy for staging"})
    assert copied.status_code == 200, copied.text
    assert copied.json()["version"] == "1.0.2"
    assert copied.json()["status"] == "draft"
    assert "enabled" not in copied.json()
    assert "implemented" not in copied.json()

    model_payload = {
        "id": f"MODEL-COMP-REF-{uuid.uuid4().hex[:8].upper()}",
        "name": "component-reference-check",
        "scene": "自定义模型",
        "status": "developing",
        "build_mode": "component_based",
        "semantic_spec": {"model_code": "component_reference_check", "build_mode": "component_based"},
        "component_spec": {"build_mode": "component_based", "model_code": "component_reference_check", "components": [{"type": component_id}]},
    }
    model = client.post("/api/models", json=model_payload)
    assert model.status_code == 200, model.text
    detail = client.get(f"/api/components/{component_id}")
    assert detail.status_code == 200, detail.text
    assert any(item["model_id"] == model_payload["id"] for item in detail.json()["referenced_by"])


def test_model_asset_detail_contains_closed_loop_sections() -> None:
    model_id = "MODEL-POWER-CASCADE-HYDRO-DISPATCH"
    response = client.get(f"/api/models/{model_id}/asset-detail")
    assert response.status_code == 200, response.text
    body = response.json()
    for key in [
        "basic_info",
        "semantic_spec",
        "model_draft",
        "component_spec",
        "constraints",
        "objective",
        "mathematical_expansion",
        "parameters",
        "parameter_schema",
        "publish_info",
        "skill_info",
        "test_result",
        "version_info",
        "recent_invocations",
        "recent_tasks",
    ]:
        assert key in body
    assert body["skill_info"]["model_id"] == model_id
    assert "component_versions" in body["version_info"]


def test_publish_rejects_enabled_unsupported_custom_objective_term() -> None:
    template = get_template("cascade_hydro_dispatch")
    component_spec = deepcopy(template["component_spec"])
    component_spec["objective"]["terms"].append(
        {
            "term_id": "custom_sum_power",
            "name": "用户新增总出力目标",
            "source": "custom",
            "expression": "Σ(station_power[s,t])",
            "weight_key": "custom_power",
            "weight": 1,
            "enabled": True,
        }
    )
    package = _component_package_with_constraint("station_power[S1,0] <= 120")
    package["component_spec"] = component_spec
    package["semantic_spec"] = {**template, "component_spec": component_spec}
    created = client.post("/api/models", json=package)
    assert created.status_code == 422, created.text
    assert "目标函数项暂不支持参与后端求解" in created.text
