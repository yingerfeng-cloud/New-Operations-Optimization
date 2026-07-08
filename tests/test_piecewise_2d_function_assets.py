from __future__ import annotations

import math
import uuid

from fastapi.testclient import TestClient

from app.builders.component_model_builder import ComponentModelBuilder
from app.main import app
from app.problem_type_diagnosis import infer_problem_type_from_component_spec
from app.solvers.solver_router import solver_router
from app.storage.memory_store import STORE


client = TestClient(app)


# Asset, validation, and preview coverage
def _surface_payload(function_id: str) -> dict:
    return {
        "function_id": function_id,
        "name": "Plane surface",
        "function_type": "piecewise_2d",
        "input_schema": [{"code": "x"}, {"code": "y"}],
        "output_schema": {"code": "z"},
        "points_2d": [[0, 0, 1], [10, 0, 21], [0, 10, 31], [10, 10, 51]],
        "solve_strategy": "triangulated_milp_exact",
        "status": "draft",
    }


def test_function_asset_api_creates_piecewise_1d() -> None:
    function_id = f"curve_{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/function-assets",
        json={
            "function_id": function_id,
            "name": "Level curve",
            "function_type": "piecewise_1d",
            "input_schema": [{"code": "storage", "name": "storage", "unit": "m3"}],
            "output_schema": {"code": "level", "name": "level", "unit": "m"},
            "points": [[1000, 245.0], [1200, 246.3]],
            "solve_strategy": "convex_combination_lp",
            "status": "draft",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["function_type"] == "piecewise_1d"
    assert body["function_id"] == function_id
    assert body["points"] == [[1000.0, 245.0], [1200.0, 246.3]]


def test_function_asset_api_creates_piecewise_2d() -> None:
    function_id = f"surface_create_{uuid.uuid4().hex[:8]}"
    response = client.post("/api/function-assets", json=_surface_payload(function_id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["function_type"] == "piecewise_2d"
    assert body["function_id"] == function_id
    assert len(body["points_2d"]) == 4
    assert len(body["triangles"]) == 2


def test_piecewise_2d_asset_auto_triangulates_and_previews_plane() -> None:
    function_id = f"surface_{uuid.uuid4().hex[:8]}"
    response = client.post("/api/function-assets", json=_surface_payload(function_id))
    assert response.status_code == 200, response.text
    asset = response.json()
    assert asset["function_type"] == "piecewise_2d"
    assert asset["validation_status"] == "valid"
    assert asset["domain"]["x_min"] == 0
    assert asset["domain"]["y_max"] == 10
    assert asset["z_range"] == [1.0, 51.0]
    assert len(asset["triangles"]) == 2
    assert asset["triangulation_status"] == "auto_grid_triangulated"

    preview = client.post(f"/api/function-assets/{function_id}/preview", json={"x": 5, "y": 5})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["status"] == "inside_domain"
    assert math.isclose(body["z"], 26.0, abs_tol=1e-6)
    assert len(body["lambda"]) == 3


def test_piecewise_2d_scattered_surface_with_triangles_is_valid_without_grid_warning() -> None:
    function_id = f"scattered_surface_{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/function-assets",
        json={
            "function_id": function_id,
            "name": "Scattered surface",
            "function_type": "piecewise_2d",
            "input_schema": [{"code": "flow"}, {"code": "head"}],
            "output_schema": {"code": "power"},
            "points_2d": [[40, 35, 11.9], [160, 35, 47.6], [160, 65, 88.4]],
            "triangles": [[0, 1, 2]],
            "solve_strategy": "triangulated_milp_exact",
            "status": "draft",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["validation_status"] == "valid"
    assert body["triangulation_status"] == "provided"
    assert body["validation_warnings"] == []
    assert body["surface_diagnostics"]["can_triangulate"] is True


def test_piecewise_2d_rejects_duplicate_xy_and_degenerate_triangle() -> None:
    duplicate = client.post(
        "/api/function-assets/bad_2d/validate",
        json={
            "function_id": "bad_2d",
            "name": "Bad 2D",
            "function_type": "piecewise_2d",
            "points_2d": [[0, 0, 1], [0, 0, 2], [1, 0, 3]],
            "triangles": [[0, 1, 2]],
        },
    ).json()
    assert duplicate["valid"] is False
    assert any("duplicate" in item["message"] for item in duplicate["errors"])

    degenerate = client.post(
        "/api/function-assets/bad_tri/validate",
        json={
            "function_id": "bad_tri",
            "name": "Bad triangle",
            "function_type": "piecewise_2d",
            "points_2d": [[0, 0, 1], [1, 0, 2], [2, 0, 3]],
            "triangles": [[0, 1, 2]],
            "solve_strategy": "triangulated_milp_exact",
        },
    ).json()
    assert degenerate["valid"] is False
    assert any("degenerate" in item["message"] for item in degenerate["errors"])


# CSV import coverage
def test_piecewise_1d_csv_import_maps_xy_fields() -> None:
    function_id = f"csv_curve_{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/function-assets/import-csv",
        json={
            "function_id": function_id,
            "name": "CSV curve",
            "function_type": "piecewise_1d",
            "csv_text": "storage,level\n1000,245.0\n1200,246.3\n",
            "x_field": "storage",
            "y_field": "level",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["function_type"] == "piecewise_1d"
    assert body["metadata"]["field_mapping"] == {"x": "storage", "y": "level", "z": None, "group": None}
    assert body["points"] == [[1000.0, 245.0], [1200.0, 246.3]]


def test_piecewise_2d_csv_import_maps_xyz_fields() -> None:
    function_id = f"csv_surface_{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/function-assets/import-csv",
        json={
            "function_id": function_id,
            "name": "CSV surface",
            "function_type": "piecewise_2d",
            "csv_text": "flow,head,power\n0,0,1\n10,0,21\n0,10,31\n10,10,51\n",
            "x_field": "flow",
            "y_field": "head",
            "z_field": "power",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["validation_status"] == "valid"
    assert body["metadata"]["field_mapping"] == {"x": "flow", "y": "head", "z": "power", "group": None}
    assert len(body["points_2d"]) == 4


# Component, builder, and solver coverage
def test_piecewise_2d_component_builds_milp_and_solves_plane() -> None:
    function_id = "plane_surface_for_solve"
    with STORE.lock:
        STORE.function_assets[function_id] = _surface_payload(function_id)
    spec = {
        "model_code": "piecewise_2d_solve",
        "build_mode": "component_based",
        "required_solver_capabilities": ["MILP"],
        "sets": [{"code": "time", "values": [0]}],
        "variables": [
            {"name": "flow", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 10},
            {"name": "head", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 10},
            {"name": "power", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "components": [
            {
                "type": "function_mapping_2d_component",
                "function_asset_id": function_id,
                "x": "flow[t]",
                "y": "head[t]",
                "z": "power[t]",
                "indices": [{"set": "time", "alias": "t"}],
                "solve_strategy": "triangulated_milp_exact",
                "constraint_id": "power_surface",
            }
        ],
        "objective": {"sense": "minimize", "terms": [{"term_id": "min_power", "expression": "sum(power[t] for t in time)", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True}]},
    }
    model, context = ComponentModelBuilder().build(spec, {"time": [0], "horizon": 1})
    model.flow[0].fix(5)
    model.head[0].fix(5)
    result = solver_router.solve(model, problem_type="MILP", requested_solver="HiGHS", time_limit_seconds=30)
    assert result.status == "optimal"
    assert math.isclose(result.variable_values["power"]["power[0]"], 26.0, abs_tol=1e-5)
    assert context["metadata"]["piecewise_2d_constraints"][0]["compiler"] == "triangulated_milp_exact"


# Problem-type diagnosis coverage
def test_piecewise_2d_problem_type_diagnosis() -> None:
    diagnosis = infer_problem_type_from_component_spec(
        {
            "components": [
                {
                    "type": "function_mapping_2d_component",
                    "function_asset_id": "surface_x",
                    "solve_strategy": "triangulated_milp_exact",
                }
            ],
            "model_problem_type": "MILP",
        },
        solver_name="HiGHS",
    )
    assert diagnosis["inferred_problem_type"] == "MILP"

    display = infer_problem_type_from_component_spec(
        {
            "components": [
                {
                    "type": "function_mapping_2d_component",
                    "function_asset_id": "surface_x",
                    "solve_strategy": "display_only",
                }
            ],
            "model_problem_type": "LP",
        },
        solver_name="HiGHS",
    )
    assert display["inferred_problem_type"] == "LP"
