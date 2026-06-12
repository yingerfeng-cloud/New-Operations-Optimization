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


def test_component_registry_can_describe_add_remove_enable_disable_inputs() -> None:
    catalog = list_component_catalog()
    reservoir = next(item for item in catalog if item["component_id"] == "hydro_reservoir_balance")

    assert reservoir["version"] == "1.0.0"
    assert reservoir["implemented"] is True
    assert "hydro_cascade_inflow_delay" in reservoir["depends_on"]
    assert reservoir["generated_constraints"][0]["type"] == "state_transition"


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
    component_spec = deepcopy(template["component_spec"])
    component_spec["additional_custom_constraints"] = [{"name": "invalid_extra", "expression": expression, "scope": "station,time"}]
    return {
        "id": f"MODEL-TEST-{uuid.uuid4().hex[:8].upper()}",
        "template_id": f"cascade_hydro_dispatch_custom_{uuid.uuid4().hex[:4]}",
        "name": "invalid-constraint-publish-check",
        "scene": "梯级水电日前调度",
        "status": "developing",
        "build_mode": "component_based",
        "semantic_spec": {**template, "component_spec": component_spec},
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
        assert current.json()["status"] == "publish_failed"


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
        "implemented": False,
        "enabled": True,
        "depends_on": [],
        "generated_constraints": [{"constraint_id": "custom_balance", "name": "自定义平衡", "formula": "x[t] = y[t]"}],
        "generated_objective_terms": [{"term_id": "custom_penalty", "name": "自定义惩罚", "weight_key": "custom", "supported_by_backend": False}],
    }
    created = client.post("/api/components/catalog", json=payload)
    assert created.status_code == 200, created.text
    assert created.json()["component_id"] == component_id

    updated = client.put(f"/api/components/{component_id}", json={**payload, "enabled": False, "version": "1.0.1", "change_note": "disable for review"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["enabled"] is False
    assert updated.json()["versions"][-1]["change_note"] == "disable for review"

    copied = client.post(f"/api/components/{component_id}/copy-version", json={"version": "1.0.2", "change_note": "copy for staging"})
    assert copied.status_code == 200, copied.text
    assert copied.json()["version"] == "1.0.2"
    assert copied.json()["enabled"] is False

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
