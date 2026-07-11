from __future__ import annotations

import math
import queue
import threading
import uuid

import pytest

from app.builders.component_model_builder import ComponentModelBuilder
from app.model_draft import build_component_spec_from_draft, create_model_draft_from_template
from app.problem_type_diagnosis import infer_problem_type_from_component_spec
from app.solvers.solver_router import SolverRouteError, solver_router
from app.storage.memory_store import STORE
from app.templates.power_templates import get_template


def test_function_asset_api_validate_and_preview(client) -> None:
    function_id = "level_volume_curve_test"
    payload = {
        "function_id": function_id,
        "name": "Level volume curve",
        "function_type": "piecewise_1d",
        "points": [[0, 0], [100, 20], [200, 45]],
        "solve_strategy": "convex_combination_lp",
    }
    response = client.post("/api/function-assets", json=payload)
    assert response.status_code == 200, response.text
    asset = response.json()
    assert asset["domain"]["x_min"] == 0
    assert asset["domain"]["x_max"] == 200
    assert asset["monotonicity"] == "increasing"
    assert asset["validation_status"] in {"valid", "warning"}
    assert asset["validation_errors"] == []

    validation = client.post(f"/api/function-assets/{function_id}/validate").json()
    assert validation["valid"] is True
    assert validation["domain"]["breakpoint_count"] == 3

    preview = client.post(f"/api/function-assets/{function_id}/preview", json={"inputs": [50, 150]}).json()
    assert preview["values"][0]["y"] == 10
    assert preview["values"][1]["y"] == 32.5


def test_function_asset_list_api_returns_references_without_deadlock(client) -> None:
    function_id = f"list_deadlock_curve_{uuid.uuid4().hex[:8]}"
    created = client.post(
        "/api/function-assets",
        json={
            "function_id": function_id,
            "name": "List deadlock curve",
            "function_type": "piecewise_1d",
            "points": [[0, 0], [10, 10], [20, 20]],
            "solve_strategy": "convex_combination_lp",
        },
    )
    assert created.status_code == 200, created.text

    result: queue.Queue[object] = queue.Queue()

    def request_assets() -> None:
        result.put(client.get("/api/function-assets"))

    thread = threading.Thread(target=request_assets, daemon=True)
    thread.start()
    thread.join(timeout=1)
    assert not thread.is_alive(), "GET /api/function-assets did not return within 1 second"

    response = result.get_nowait()
    assert response.status_code == 200, response.text
    asset = next(item for item in response.json() if item["function_id"] == function_id)
    assert "referenced_by" in asset
    assert isinstance(asset["referenced_by"], list)


def test_function_asset_list_api_returns_valid_warning_and_invalid_assets(client) -> None:
    suffix = uuid.uuid4().hex[:8]
    assets = [
        (f"list_valid_{suffix}", [[0, 0], [10, 10], [20, 20]]),
        (f"list_warning_{suffix}", [[0, 0], [10, 20], [20, 5]]),
        (f"list_invalid_{suffix}", [[0, 0], [0, 10], [20, 20]]),
    ]
    for function_id, points in assets:
        created = client.post(
            "/api/function-assets",
            json={"function_id": function_id, "name": function_id, "status": "draft", "points": points},
        )
        assert created.status_code == 200, created.text

    response = client.get("/api/function-assets")
    assert response.status_code == 200, response.text
    rows = {item["function_id"]: item for item in response.json()}
    assert rows[f"list_valid_{suffix}"]["validation_status"] == "valid"
    assert rows[f"list_warning_{suffix}"]["validation_status"] == "warning"
    assert rows[f"list_invalid_{suffix}"]["validation_status"] == "invalid"
    assert all("referenced_by" in rows[function_id] for function_id, _ in assets)


def test_function_asset_rejects_duplicate_breakpoints(client) -> None:
    response = client.post(
        "/api/function-assets/bad_curve/validate",
        json={"function_id": "bad_curve", "name": "Bad", "points": [[0, 0], [0, 1]]},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["valid"] is False
    assert result["validation_status"] == "invalid"
    assert any("strictly increasing" in item["message"] for item in result["errors"])


def test_invalid_function_asset_draft_saved_but_published_rejected_and_preview_blocked(client) -> None:
    draft = client.post(
        "/api/function-assets",
        json={"function_id": "bad_curve_draft", "name": "Bad draft", "status": "draft", "points": [[0, 0], [0, 1]]},
    )
    assert draft.status_code == 200, draft.text
    assert draft.json()["validation_status"] == "invalid"
    assert draft.json()["validation_errors"]

    published = client.post(
        "/api/function-assets",
        json={"function_id": "bad_curve_published", "name": "Bad published", "status": "published", "points": [[0, 0], [0, 1]]},
    )
    assert published.status_code == 422

    preview = client.post("/api/function-assets/bad_curve_draft/preview")
    assert preview.status_code == 422


def test_csv_import_creates_valid_draft_curve(client) -> None:
    response = client.post(
        "/api/function-assets/import-csv",
        json={
            "function_id": "csv_curve_test",
            "name": "CSV curve",
            "csv_text": "storage,level\n1000,245.0\n1200,246.3\n1500,248.1\n",
            "x_field": "storage",
            "y_field": "level",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["function_id"] == "csv_curve_test"
    assert body["status"] == "draft"
    assert body["validation_status"] in {"valid", "warning"}
    assert body["domain"]["breakpoint_count"] == 3


def test_csv_import_group_field_marks_first_group_for_solving(client) -> None:
    response = client.post(
        "/api/function-assets/import-csv",
        json={
            "function_id": f"csv_group_curve_{uuid.uuid4().hex[:8]}",
            "name": "CSV grouped curve",
            "csv_text": "plant,storage,level\nA,1000,245.0\nA,1200,246.3\nB,1000,250.0\nB,1200,251.0\n",
            "x_field": "storage",
            "y_field": "level",
            "group_field": "plant",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["metadata"]["groups_used_for_solving"] == ["A"]
    assert body["metadata"]["reserved_capability"] == "multi_group_curve_solving"
    assert "仅使用第一组曲线参与求解" in body["metadata"]["warning"]


def test_function_mapping_component_uses_asset_and_solves_lp() -> None:
    with STORE.lock:
        STORE.function_assets["mapping_curve"] = {
            "function_id": "mapping_curve",
            "name": "Mapping curve",
            "function_type": "piecewise_1d",
            "interpolation": "linear",
            "points": [[0, 0], [10, 100], [20, 260]],
            "domain": {"x_min": 0, "x_max": 20, "breakpoint_count": 3},
            "solve_strategy": "convex_combination_lp",
        }
    spec = {
        "model_code": "function_mapping_test",
        "build_mode": "component_based",
        "sets": [{"code": "time", "values": [0, 1]}],
        "variables": [
            {"name": "volume", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 20},
            {"name": "level", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "components": [
            {
                "type": "function_mapping_component",
                "function_asset_id": "mapping_curve",
                "x": "volume[t]",
                "y": "level[t]",
                "indices": [{"set": "time", "alias": "t"}],
                "solve_strategy": "convex_combination_lp",
            }
        ],
        "objective": {"sense": "minimize", "terms": [{"term_id": "min_level", "expression": "sum(level[t] for t in time)", "weight_key": "piecewise_cost", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True}]},
    }
    model, context = ComponentModelBuilder().build(spec, {"time": [0, 1], "horizon": 2})
    model.volume[0].fix(10)
    model.volume[1].fix(20)
    result = solver_router.solve(model, problem_type="LP", requested_solver="HiGHS", time_limit_seconds=30)
    assert result.status == "optimal"
    assert math.isclose(result.variable_values["level"]["level[0]"], 100.0, abs_tol=1e-5)
    assert math.isclose(result.variable_values["level"]["level[1]"], 260.0, abs_tol=1e-5)
    assert context["metadata"]["function_assets_used"][0]["function_asset_id"] == "mapping_curve"


def test_function_mapping_config_shape_uses_asset_and_solves_lp() -> None:
    with STORE.lock:
        STORE.function_assets["mapping_curve_config"] = {
            "function_id": "mapping_curve_config",
            "name": "Mapping curve config",
            "function_type": "piecewise_1d",
            "interpolation": "linear",
            "points": [[0, 0], [10, 100], [20, 260]],
            "domain": {"x_min": 0, "x_max": 20, "breakpoint_count": 3},
            "solve_strategy": "convex_combination_lp",
        }
    spec = {
        "model_code": "function_mapping_config_test",
        "build_mode": "component_based",
        "sets": [{"code": "time", "values": [0]}],
        "variables": [
            {"name": "volume", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 20},
            {"name": "level", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "components": [
            {
                "type": "function_mapping_component",
                "config": {
                    "function_asset_id": "mapping_curve_config",
                    "x": "volume[t]",
                    "y": "level[t]",
                    "indices": [{"set": "time", "alias": "t"}],
                    "solve_strategy": "convex_combination_lp",
                },
            }
        ],
        "objective": {"sense": "minimize", "terms": [{"term_id": "min_level", "expression": "sum(level[t] for t in time)", "weight_key": "piecewise_cost", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True}]},
    }
    model, _ = ComponentModelBuilder().build(spec, {"time": [0], "horizon": 1})
    model.volume[0].fix(10)
    result = solver_router.solve(model, problem_type="LP", requested_solver="HiGHS", time_limit_seconds=30)
    assert result.status == "optimal"
    assert math.isclose(result.variable_values["level"]["level[0]"], 100.0, abs_tol=1e-5)


def test_model_draft_preserves_function_mapping_fields() -> None:
    draft = {
        "basic_info": {"model_code": "draft_mapping", "solver": "HiGHS"},
        "semantic": {
            "sets": [{"code": "time", "values": [0]}],
            "parameters": [],
            "variables": [{"code": "volume", "indices": ["time"]}, {"code": "level", "indices": ["time"]}],
        },
        "components": [
            {
                "component_id": "function_mapping_component",
                "type": "function_mapping_component",
                "enabled": True,
                "function_asset_id": "curve_xxx",
                "x": "volume[t]",
                "y": "level[t]",
                "indices": [{"set": "time", "alias": "t"}],
                "solve_strategy": "convex_combination_lp",
            }
        ],
        "constraints": [],
        "objective": {"sense": "minimize", "terms": [{"term_id": "obj", "expression": "sum(level[t] for t in time)", "solve_participation": "solve_active"}]},
        "advanced": {"component_spec": {}},
    }
    spec = build_component_spec_from_draft(draft)
    component = spec["components"][0]
    assert component["function_asset_id"] == "curve_xxx"
    assert component["x"] == "volume[t]"
    assert component["y"] == "level[t]"
    assert component["indices"] == [{"set": "time", "alias": "t"}]
    assert component["solve_strategy"] == "convex_combination_lp"


def test_function_asset_referenced_by_tracks_model_component(client) -> None:
    asset_id = f"ref_curve_{uuid.uuid4().hex[:8]}"
    created_asset = client.post(
        "/api/function-assets",
        json={"function_id": asset_id, "name": "Referenced curve", "points": [[0, 0], [10, 10], [20, 20]]},
    )
    assert created_asset.status_code == 200, created_asset.text
    model_payload = {
        "id": f"MODEL-REF-{uuid.uuid4().hex[:8]}",
        "name": "Reference model",
        "scene": "function asset reference",
        "status": "developing",
        "build_mode": "component_based",
        "problem_type": "LP",
        "model_problem_type": "LP",
        "semantic_spec": {"model_code": "ref_model", "build_mode": "component_based", "component_spec": {}},
        "component_spec": {
            "model_code": "ref_model",
            "build_mode": "component_based",
            "sets": [{"code": "time", "values": [0]}],
            "variables": [
                {"name": "volume", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 20},
                {"name": "level", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            ],
            "components": [
                {
                    "type": "function_mapping_component",
                    "function_asset_id": asset_id,
                    "x": "volume[t]",
                    "y": "level[t]",
                    "indices": [{"set": "time", "alias": "t"}],
                    "solve_strategy": "convex_combination_lp",
                    "constraint_id": "level_curve_mapping",
                }
            ],
            "objective": {"sense": "minimize", "terms": [{"term_id": "obj", "expression": "sum(level[t] for t in time)", "weight_key": "piecewise_cost", "solve_participation": "solve_active"}]},
        },
    }
    created_model = client.post("/api/models", json=model_payload)
    assert created_model.status_code == 200, created_model.text
    asset = client.get(f"/api/function-assets/{asset_id}").json()
    refs = asset["referenced_by"]
    assert any(ref["model_id"] == created_model.json()["id"] and ref["component_id"] == "function_mapping_component" for ref in refs)


def test_model_create_prefers_model_draft_components_over_stale_component_spec(client) -> None:
    draft = create_model_draft_from_template(get_template("cascade_hydro_dispatch"))
    stale_component_spec = {
        **draft["advanced"]["component_spec"],
        "components": list(draft["advanced"]["component_spec"].get("components") or []),
    }
    draft["components"].append(
        {
            "component_id": "function_mapping_component",
            "type": "function_mapping_component",
            "enabled": True,
            "function_asset_id": "storage_level_curve_frontend_added",
            "x": "volume[S1,t]",
            "y": "level[S1,t]",
            "indices": [{"set": "time", "alias": "t"}],
            "solve_strategy": "convex_combination_lp",
            "constraint_id": "storage_level_mapping",
        }
    )
    payload = {
        "id": f"MODEL-DRAFT-MERGE-{uuid.uuid4().hex[:8]}",
        "name": "Draft merge model",
        "scene": "cascade hydro",
        "template_id": "cascade_hydro_dispatch",
        "build_mode": "component_based",
        "status": "developing",
        "model_draft": draft,
        "semantic_spec": draft["semantic"],
        "component_spec": stale_component_spec,
        "parameters": draft["runtime_parameters"],
    }

    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    components = created.json()["component_spec"]["components"]
    mapping = next(item for item in components if item.get("function_asset_id") == "storage_level_curve_frontend_added")
    assert mapping["function_asset_id"] == "storage_level_curve_frontend_added"
    assert mapping["x"] == "volume[S1,t]"
    assert mapping["y"] == "level[S1,t]"


def test_invalid_function_asset_publish_blocks_solver_dry_run_noise(client) -> None:
    asset_id = f"bad_publish_curve_{uuid.uuid4().hex[:8]}"
    created_asset = client.post(
        "/api/function-assets",
        json={"function_id": asset_id, "name": "Bad publish curve", "status": "draft", "points": [[0, 0], [0, 1]]},
    )
    assert created_asset.status_code == 200, created_asset.text
    assert created_asset.json()["validation_status"] == "invalid"
    payload = {
        "id": f"MODEL-BAD-FUNC-{uuid.uuid4().hex[:8]}",
        "name": "Invalid function asset model",
        "scene": "function asset publish",
        "status": "developing",
        "build_mode": "component_based",
        "problem_type": "LP",
        "model_problem_type": "LP",
        "semantic_spec": {"model_code": "bad_func_model", "build_mode": "component_based", "component_spec": {}},
        "component_spec": {
            "model_code": "bad_func_model",
            "build_mode": "component_based",
            "sets": [{"code": "time", "values": [0]}],
            "variables": [
                {"name": "volume", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 20},
                {"name": "level", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            ],
            "components": [
                {
                    "type": "function_mapping_component",
                    "function_asset_id": asset_id,
                    "x": "volume[t]",
                    "y": "level[t]",
                    "indices": [{"set": "time", "alias": "t"}],
                    "solve_strategy": "convex_combination_lp",
                    "constraint_id": "bad_curve_mapping",
                }
            ],
            "objective": {
                "sense": "minimize",
                "terms": [{"term_id": "obj", "expression": "sum(level[t] for t in time)", "weight_key": "piecewise_cost", "solve_participation": "solve_active"}],
            },
        },
    }
    created_model = client.post("/api/models", json=payload)
    assert created_model.status_code == 200, created_model.text

    published = client.post(f"/api/models/{created_model.json()['id']}/publish")
    assert published.status_code == 422
    body = published.json()["detail"]
    error_text = str(body["errors"])
    assert "function asset validation failed" in error_text
    assert "请先修正函数/曲线资产断点、状态或绑定关系。" in error_text
    assert "solver test failed" not in error_text
    assert not body.get("dry_run_result")


def test_function_mapping_publish_rejects_missing_y_variable_before_solver(client) -> None:
    asset_id = f"missing_y_curve_{uuid.uuid4().hex[:8]}"
    created_asset = client.post(
        "/api/function-assets",
        json={"function_id": asset_id, "name": "Missing y curve", "points": [[0, 0], [10, 10], [20, 20]]},
    )
    assert created_asset.status_code == 200, created_asset.text
    payload = {
        "id": f"MODEL-MISSING-Y-{uuid.uuid4().hex[:8]}",
        "name": "Missing y mapping model",
        "scene": "function asset publish",
        "status": "developing",
        "build_mode": "component_based",
        "problem_type": "LP",
        "model_problem_type": "LP",
        "mathematical_expansion": {"components": ["function_mapping_component"]},
        "semantic_spec": {"model_code": "missing_y_model", "build_mode": "component_based", "component_spec": {}},
        "component_spec": {
            "model_code": "missing_y_model",
            "build_mode": "component_based",
            "sets": [{"code": "time", "values": [0]}],
            "variables": [{"name": "volume", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 20}],
            "components": [
                {
                    "type": "function_mapping_component",
                    "function_asset_id": asset_id,
                    "x": "volume[t]",
                    "y": "level[t]",
                    "indices": [{"set": "time", "alias": "t"}],
                    "solve_strategy": "convex_combination_lp",
                }
            ],
            "objective": {"sense": "minimize", "terms": [{"term_id": "obj", "expression": "sum(volume[t] for t in time)", "weight_key": "piecewise_cost", "solve_participation": "solve_active"}]},
        },
    }
    created_model = client.post("/api/models", json=payload)
    assert created_model.status_code == 200, created_model.text

    published = client.post(f"/api/models/{created_model.json()['id']}/publish")
    assert published.status_code == 422
    body = published.json()["detail"]
    error_text = str(body["errors"])
    assert "输出变量 level 未在语义模型变量中定义，请先在 Step2 新增该变量，或选择已有变量。" in error_text
    assert "solver test failed" not in error_text
    assert not body.get("dry_run_result")


def test_function_mapping_dry_run_error_is_classified_to_component(client) -> None:
    asset_id = f"classify_curve_{uuid.uuid4().hex[:8]}"
    created_asset = client.post(
        "/api/function-assets",
        json={"function_id": asset_id, "name": "Classify curve", "points": [[0, 0], [10, 10], [20, 20]]},
    )
    assert created_asset.status_code == 200, created_asset.text
    payload = {
        "id": f"MODEL-FUNC-CLASSIFY-{uuid.uuid4().hex[:8]}",
        "name": "Function classify model",
        "scene": "function asset publish",
        "status": "developing",
        "build_mode": "component_based",
        "problem_type": "LP",
        "model_problem_type": "LP",
        "mathematical_expansion": {"components": ["function_mapping_component"]},
        "semantic_spec": {"model_code": "function_classify_model", "build_mode": "component_based", "component_spec": {}},
        "component_spec": {
            "model_code": "function_classify_model",
            "build_mode": "component_based",
            "sets": [{"code": "time", "values": [0]}],
            "variables": [
                {"name": "volume", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 20},
                {"name": "level", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            ],
            "components": [
                {
                    "type": "function_mapping_component",
                    "function_asset_id": asset_id,
                    "x": "missing_volume[t]",
                    "y": "level[t]",
                    "indices": [{"set": "time", "alias": "t"}],
                    "solve_strategy": "convex_combination_lp",
                }
            ],
            "objective": {"sense": "minimize", "terms": [{"term_id": "obj", "expression": "sum(level[t] for t in time)", "weight_key": "piecewise_cost", "solve_participation": "solve_active"}]},
        },
    }
    created_model = client.post("/api/models", json=payload)
    assert created_model.status_code == 200, created_model.text

    published = client.post(f"/api/models/{created_model.json()['id']}/publish")
    assert published.status_code == 422
    body = published.json()["detail"]
    error_text = str(body["errors"])
    assert "component_spec.components[0]" in error_text
    assert "请检查函数映射组件的 x/y 变量、索引集合、函数资产定义域和求解策略。" in error_text
    assert "component_spec.additional_custom_constraints" not in error_text


def test_binary_segment_function_mapping_infers_milp() -> None:
    diagnosis = infer_problem_type_from_component_spec(
        {
            "variables": [{"name": "volume", "domain": "NonNegativeReals"}, {"name": "level", "domain": "NonNegativeReals"}],
            "components": [
                {
                    "type": "function_mapping_component",
                    "function_asset_id": "curve_binary",
                    "x": "volume[t]",
                    "y": "level[t]",
                    "solve_strategy": "binary_segment_milp",
                }
            ],
        },
        solver_name="HiGHS",
    )
    assert diagnosis["inferred_problem_type"] == "MILP"
    assert diagnosis["recommended_solver"] == "HiGHS"
    assert diagnosis["function_assets_used"][0]["function_asset_id"] == "curve_binary"


def test_binary_segment_function_mapping_config_shape_infers_milp() -> None:
    diagnosis = infer_problem_type_from_component_spec(
        {
            "variables": [{"name": "volume", "domain": "NonNegativeReals"}, {"name": "level", "domain": "NonNegativeReals"}],
            "components": [
                {
                    "type": "function_mapping_component",
                    "config": {
                        "function_asset_id": "curve_binary_config",
                        "x": "volume[t]",
                        "y": "level[t]",
                        "solve_strategy": "binary_segment_milp",
                    },
                }
            ],
        },
        solver_name="HiGHS",
    )
    assert diagnosis["inferred_problem_type"] == "MILP"
    assert diagnosis["function_assets_used"][0]["function_asset_id"] == "curve_binary_config"
    assert diagnosis["function_assets_used"][0]["solve_strategy"] == "binary_segment_milp"


def test_solver_router_returns_structured_error_without_highs_fallback_for_nlp() -> None:
    route = solver_router.route("NLP")
    assert route["selected_solver"] == "Ipopt"
    if route["available"]:
        assert route["ok"] is True
        assert route["status"] == "ok"
    else:
        assert route["ok"] is False
        assert route["status"] == "solver_unavailable"
        assert route["error_code"] == "SOLVER_UNAVAILABLE"
        with pytest.raises(SolverRouteError) as exc_info:
            solver_router.solve(object(), problem_type="NLP")
        assert exc_info.value.payload["selected_solver"] == "Ipopt"


def test_solver_router_unknown_problem_type_is_structured_error() -> None:
    route = solver_router.route("ABC")
    assert route["ok"] is False
    assert route["status"] == "unsupported_problem_type"
    assert route["selected_solver"] is None
