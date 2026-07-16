from __future__ import annotations

import uuid
from copy import deepcopy

from fastapi.testclient import TestClient

from app.main import app
from app.templates.power_templates import get_template
from tests.test_helpers import test_and_publish_model


client = TestClient(app)


def _soc_component(component_id: str) -> dict:
    return {
        "component_id": component_id,
        "name": "储能 SOC 平衡组件",
        "domain": "储能调度",
        "category": "状态递推类",
        "version": "1.0.0",
        "problem_types": ["LP"],
        "solver_capabilities": ["LP"],
        "sets": [{"code": "time"}, {"code": "time_volume"}],
        "parameters": [
            {"code": "eta_ch", "dimension": [], "default": 0.95},
            {"code": "eta_dis", "dimension": [], "default": 0.95},
            {"code": "delta_t", "dimension": [], "default": 1},
        ],
        "variables": [
            {"code": "soc", "dimension": ["time_volume"], "type": "continuous", "lower_bound": 0},
            {"code": "p_ch", "dimension": ["time"], "type": "continuous", "lower_bound": 0},
            {"code": "p_dis", "dimension": ["time"], "type": "continuous", "lower_bound": 0},
        ],
        "constraints": [
            {
                "constraint_id": "soc_balance",
                "name": "SOC 平衡",
                "indices": [{"set": "time", "alias": "t"}],
                "expression": "soc[t+1] == soc[t] + eta_ch * p_ch[t] * delta_t - p_dis[t] / eta_dis * delta_t",
                "business_meaning": "SOC 状态递推",
            }
        ],
        "math_template": {"formula": "SOC[t+1] = SOC[t] + eta_ch * P_ch[t] - P_dis[t] / eta_dis"},
    }


def test_component_create_validate_publish_and_catalog() -> None:
    component_id = f"custom_soc_{uuid.uuid4().hex[:8]}"
    created = client.post("/api/components/catalog", json=_soc_component(component_id))
    assert created.status_code == 200, created.text

    validated = client.post(f"/api/components/{component_id}/validate")
    assert validated.status_code == 200, validated.text
    assert validated.json()["valid"] is True

    published = client.post(f"/api/components/{component_id}/publish")
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    assert published.json()["implemented"] is True

    catalog = client.get("/api/components/catalog")
    assert catalog.status_code == 200
    assert any(item["component_id"] == component_id and item["status"] == "published" for item in catalog.json())


def test_component_formula_validation_unknown_variable_blocks_publish() -> None:
    component_id = f"bad_formula_{uuid.uuid4().hex[:8]}"
    payload = _soc_component(component_id)
    payload["constraints"][0]["expression"] = "p_unknown[t] == p_ch[t]"
    created = client.post("/api/components/catalog", json=payload)
    assert created.status_code == 200, created.text

    validated = client.post(f"/api/components/{component_id}/validate")
    assert validated.status_code == 200
    assert validated.json()["valid"] is False
    assert "p_unknown" in str(validated.json()["errors"])

    published = client.post(f"/api/components/{component_id}/publish")
    assert published.status_code == 422


def test_published_custom_component_can_generate_dry_run_model() -> None:
    component_id = f"custom_soc_model_{uuid.uuid4().hex[:8]}"
    assert client.post("/api/components/catalog", json=_soc_component(component_id)).status_code == 200
    assert client.post(f"/api/components/{component_id}/publish").status_code == 200

    model_id = f"MODEL-CUSTOM-SOC-{uuid.uuid4().hex[:8]}"
    draft = {
        "basic_info": {"name": "自定义 SOC 模型", "model_code": model_id.lower(), "problem_type": "LP", "builder_mode": "component_based"},
        "semantic": {"sets": [{"code": "time", "values": [0, 1]}, {"code": "time_volume", "values": [0, 1, 2]}], "parameters": [], "variables": []},
        "components": [{"type": component_id, "component_id": component_id, "enabled": True}],
        "constraints": [],
        "objective": {"sense": "minimize", "terms": [{"term_id": "display", "weight_key": "display", "solve_participation": "display_only", "enabled": True}]},
        "advanced": {"component_spec": {"model_code": model_id.lower(), "build_mode": "component_based", "required_solver_capabilities": ["LP"]}},
    }
    payload = {
        "id": model_id,
        "name": "自定义 SOC 模型",
        "scene": "储能调度",
        "status": "developing",
        "build_mode": "component_based",
        "model_draft": draft,
        "parameters": {"horizon": 2, "time": [0, 1], "time_volume": [0, 1, 2], "eta_ch": 0.95, "eta_dis": 0.95, "delta_t": 1},
    }
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    assert any(item["name"] == "soc" for item in created.json()["component_spec"]["variables"])

    published = test_and_publish_model(client, model_id)
    assert published.status_code == 200, published.text
    assert published.json()["dry_run_result"]["structure_check"]["status"] == "passed"


def test_pv_storage_templates_are_component_library_based() -> None:
    capacity = get_template("pv_storage_capacity_planning")
    dispatch = get_template("pv_storage_day_ahead_dispatch")
    for template in (capacity, dispatch):
        component_ids = {item["type"] for item in template["component_spec"]["components"]}
        assert "storage_soc_balance" in component_ids
        assert "pv_available_output" in component_ids
        assert template["model_draft"]["advanced"]["component_spec"]["components"]
        assert template["mathematical_expansion"]["sections"]
        assert template["ui_metadata"]["component_spec_collapsed"] is True


def test_hydro_components_are_seeded_as_published_component_assets() -> None:
    response = client.get("/api/components/hydro_reservoir_balance")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["component_id"] == "hydro_reservoir_balance"
    assert body["status"] == "published"
    assert body["enabled"] is True
    assert body["domain"] == "梯级水电日前调度"
    assert body["generated_constraints"]


def test_cascade_hydro_template_catalog_comes_from_component_library() -> None:
    template = get_template("cascade_hydro_dispatch")
    draft_components = template["model_draft"]["components"]
    assert draft_components
    reservoir = next(item for item in draft_components if item["type"] == "hydro_reservoir_balance")
    assert reservoir["definition"]["status"] == "published"
    assert reservoir["definition"]["domain"] == "梯级水电日前调度"
    catalog_ids = {item["component_id"] for item in template["component_schema"]["components"]}
    assert "hydro_initial_volume" in catalog_ids
    assert "hydro_reservoir_balance" in catalog_ids


def test_component_catalog_has_chinese_metadata_and_problem_types() -> None:
    response = client.get("/api/components/catalog")
    assert response.status_code == 200, response.text
    catalog = {item["component_id"]: item for item in response.json()}

    deviation = catalog["deviation_penalty_component"]
    assert deviation["name"] == "偏差考核组件"
    assert deviation["domain"] == "光储一体化"
    assert deviation["category"] == "计划偏差/市场考核"
    assert deviation["problem_types"] == ["LP"]
    assert deviation["solver_capabilities"] == ["LP"]
    assert "偏差考核" in deviation["description"]
    assert {param["name"] for param in deviation["parameters"]} >= {"允许偏差", "偏差考核单价", "时间步长"}

    grid_limit = catalog["grid_power_limit"]
    assert grid_limit["name"] == "并网功率限制组件"
    assert grid_limit["problem_types"] == ["LP"]
    assert grid_limit["description"] == "限制各时段并网功率不超过电网接入上限。"

    exclusive = catalog["storage_charge_discharge_exclusive"]
    assert exclusive["name"] == "储能充放电互斥组件"
    assert exclusive["domain"] == "光储一体化"
    assert exclusive["problem_types"] == ["MILP"]
    assert "二进制变量" in exclusive["ui_hint"]

    soc_bounds = catalog["storage_soc_bounds"]
    assert soc_bounds["name"] == "储能SOC上下限组件"
    assert soc_bounds["problem_types"] == ["LP"]

    for component_id in ["deviation_penalty_component", "grid_power_limit", "storage_charge_discharge_exclusive", "storage_soc_bounds"]:
        item = catalog[component_id]
        assert item["problem_types"], component_id
        assert item["name"] != component_id
        assert item["domain"] != "pv_storage"
        assert "pv_storage /" not in item["category"]


def _formula_component(component_id: str, expression: str, indices: list[dict] | None = None, variables: list[dict] | None = None, parameters: list[dict] | None = None) -> dict:
    variables = variables or [{"code": "x", "dimension": ["time"], "type": "continuous"}, {"code": "p_ch", "dimension": ["time"], "type": "continuous"}, {"code": "is_charging", "dimension": ["time"], "type": "binary"}]
    parameters = parameters or [{"code": "limit", "dimension": ["time"], "default": 100}, {"code": "total", "dimension": [], "default": 100}, {"code": "M", "dimension": [], "default": 100}]
    set_codes = []
    for row in [*variables, *parameters]:
        for dim in row.get("dimension", []):
            if dim not in set_codes:
                set_codes.append(dim)
    return {
        "component_id": component_id,
        "name": component_id,
        "domain": "公式测试",
        "category": "公式测试",
        "sets": [{"code": code} for code in set_codes],
        "parameters": parameters,
        "variables": variables,
        "constraints": [{"constraint_id": "c1", "name": "c1", "indices": indices or [{"set": "time", "alias": "t"}], "expression": expression, "boundary_strategy": "skip_out_of_range"}],
    }


def test_default_frontend_sample_formula_alias_compiles_and_dry_runs() -> None:
    component_id = f"default_x_limit_{uuid.uuid4().hex[:8]}"
    payload = _formula_component(component_id, "x[t] <= limit[t]", variables=[{"code": "x", "dimension": ["time"], "type": "continuous"}])
    created = client.post("/api/components/catalog", json=payload)
    assert created.status_code == 200, created.text
    validated = client.post(f"/api/components/{component_id}/validate", json=payload)
    assert validated.status_code == 200, validated.text
    assert validated.json()["valid"] is True
    assert client.post(f"/api/components/{component_id}/publish").status_code == 200

    model_id = f"MODEL-X-LIMIT-{uuid.uuid4().hex[:8]}"
    draft = {
        "basic_info": {"name": "x limit", "model_code": model_id.lower(), "problem_type": "LP", "builder_mode": "component_based"},
        "semantic": {"sets": [{"code": "time", "values": [0, 1, 2]}], "parameters": [], "variables": []},
        "components": [{"type": component_id, "component_id": component_id, "enabled": True}],
        "constraints": [],
        "objective": {"sense": "minimize", "terms": [{"term_id": "display", "weight_key": "display", "solve_participation": "display_only", "enabled": True}]},
        "advanced": {"component_spec": {"model_code": model_id.lower(), "build_mode": "component_based", "required_solver_capabilities": ["LP"]}},
    }
    created_model = client.post("/api/models", json={"id": model_id, "name": "x limit", "scene": "公式测试", "status": "developing", "build_mode": "component_based", "model_draft": draft, "parameters": {"horizon": 3, "time": [0, 1, 2], "limit": [10, 20, 30]}})
    assert created_model.status_code == 200, created_model.text
    published = test_and_publish_model(client, model_id)
    assert published.status_code == 200, published.text


def test_formula_validation_covers_sum_big_m_soc_and_start_stop_boundaries() -> None:
    cases = [
        _formula_component(f"sum_formula_{uuid.uuid4().hex[:8]}", "sum(x[t] for t in time) <= total", []),
        _formula_component(f"big_m_{uuid.uuid4().hex[:8]}", "p_ch[t] <= M * is_charging[t]"),
        _formula_component(
            f"soc_formula_{uuid.uuid4().hex[:8]}",
            "soc[t+1] == soc[t] + eta_ch * p_ch[t] * delta_t - p_dis[t] / eta_dis * delta_t",
            [{"set": "time", "alias": "t"}],
            [{"code": "soc", "dimension": ["time_volume"], "type": "continuous"}, {"code": "p_ch", "dimension": ["time"], "type": "continuous"}, {"code": "p_dis", "dimension": ["time"], "type": "continuous"}],
            [{"code": "eta_ch", "dimension": [], "default": 0.95}, {"code": "eta_dis", "dimension": [], "default": 0.95}, {"code": "delta_t", "dimension": [], "default": 1}],
        ),
        _formula_component(
            f"start_stop_{uuid.uuid4().hex[:8]}",
            "start[u,t] - stop[u,t] == on[u,t] - on[u,t-1]",
            [{"set": "unit", "alias": "u"}, {"set": "time", "alias": "t"}],
            [{"code": "start", "dimension": ["unit", "time"], "type": "binary"}, {"code": "stop", "dimension": ["unit", "time"], "type": "binary"}, {"code": "on", "dimension": ["unit", "time"], "type": "binary"}],
            [],
        ),
    ]
    for payload in cases:
        created = client.post("/api/components/catalog", json=payload)
        assert created.status_code == 200, created.text
        validated = client.post(f"/api/components/{payload['component_id']}/validate", json=payload)
        assert validated.status_code == 200, validated.text
        assert validated.json()["valid"] is True, validated.json()


def test_mip_capability_is_normalized_to_milp_for_publish() -> None:
    component_id = f"mip_alias_{uuid.uuid4().hex[:8]}"
    payload = _formula_component(
        component_id,
        "p_ch[t] <= M * is_charging[t]",
        [{"set": "time", "alias": "t"}],
        [{"code": "p_ch", "dimension": ["time"], "type": "continuous"}, {"code": "is_charging", "dimension": ["time"], "type": "binary"}],
        [{"code": "M", "dimension": [], "default": 100}],
    )
    payload["problem_types"] = ["MIP"]
    payload["solver_capabilities"] = ["MIP"]
    created = client.post("/api/components/catalog", json=payload)
    assert created.status_code == 200, created.text
    published_component = client.post(f"/api/components/{component_id}/publish")
    assert published_component.status_code == 200, published_component.text
    assert "MILP" in published_component.json()["solver_capabilities"]

    model_id = f"MODEL-MIP-{uuid.uuid4().hex[:8]}"
    draft = {
        "basic_info": {"name": "mip alias", "model_code": model_id.lower(), "problem_type": "MIP", "builder_mode": "component_based"},
        "semantic": {"sets": [{"code": "time", "values": [0, 1, 2]}], "parameters": [], "variables": []},
        "components": [{"type": component_id, "component_id": component_id, "enabled": True}],
        "constraints": [],
        "objective": {"sense": "minimize", "terms": [{"term_id": "display", "weight_key": "display", "solve_participation": "display_only", "enabled": True}]},
        "advanced": {"component_spec": {"model_code": model_id.lower(), "build_mode": "component_based", "required_solver_capabilities": ["MIP"]}},
    }
    created_model = client.post("/api/models", json={"id": model_id, "name": "mip alias", "scene": "公式测试", "status": "developing", "build_mode": "component_based", "model_draft": draft, "parameters": {"horizon": 3, "time": [0, 1, 2], "M": 100}})
    assert created_model.status_code == 200, created_model.text
    published = test_and_publish_model(client, model_id)
    assert published.status_code == 200, published.text
