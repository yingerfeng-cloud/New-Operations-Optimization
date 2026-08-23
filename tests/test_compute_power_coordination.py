from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.builders.pyomo_builder import PyomoModelBuilder
from app.explain.result_formatter import SolveResultFormatter
from app.main import app
from app.model_components.registry import get_component_builder, list_component_catalog
from app.services.model_service import model_service
from app.solvers.highs_adapter import HiGHSAdapter
from app.solvers.solver_router import solver_router
from app.storage.memory_store import STORE
from app.templates.power_templates import get_template
from tests.test_helpers import test_and_publish_model


MODEL_CODE = "compute_power_coordination_day_ahead_v1"
client = TestClient(app)


@pytest.fixture(scope="module")
def solved_case() -> dict:
    template = get_template(MODEL_CODE)
    parameters = deepcopy(template["sample_runtime_parameters"])
    model, context = PyomoModelBuilder().build(template, parameters)
    result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    formatted = SolveResultFormatter().format(MODEL_CODE, result, context)
    return {
        "template": template,
        "parameters": parameters,
        "model": model,
        "context": context,
        "result": result,
        "formatted": formatted,
    }


def test_compute_power_template_and_component_are_preset_assets() -> None:
    model_service.seed_default_templates()
    template = get_template(MODEL_CODE)
    component = get_component_builder("compute_power_coordination_core")
    catalog = list_component_catalog()
    catalog_entry = next(item for item in catalog if item["component_id"] == "compute_power_coordination_core")

    assert template["status"] == "published"
    assert template["build_mode"] == "component_based"
    assert template["problem_type"] == "MILP"
    assert template["solver"] == "HiGHS"
    assert [item["type"] for item in template["component_spec"]["components"]] == [
        "compute_power_coordination_core"
    ]
    assert template["component_spec"]["components"][0]["definition"]["version"] == "1.0.0"
    assert len(template["sample_runtime_parameters"]["time"]) == 24
    assert len(template["sample_runtime_parameters"]["workload"]) == 4
    assert len(template["sample_runtime_parameters"]["cluster"]) == 3
    assert component is not None
    assert catalog_entry["status"] == "published"
    assert catalog_entry["backend_builder"] == "compute_power_coordination_core"
    with STORE.lock:
        assert "MODEL-POWER-COMPUTE-POWER-COORDINATION-DAY-AHEAD-V1" in STORE.models
        assert STORE.skills[f"run_{MODEL_CODE}"]["status"] == "enabled"


def test_managed_compute_power_template_upgrade_refreshes_time_contract() -> None:
    model_service.seed_default_templates()
    model_id = "MODEL-POWER-COMPUTE-POWER-COORDINATION-DAY-AHEAD-V1"
    with STORE.lock:
        current = STORE.models[model_id]
        stale_semantic_spec = deepcopy(current.semantic_spec)
        stale_semantic_spec.setdefault("ui_metadata", {}).pop("time_dimension", None)
        stale_ui_metadata = deepcopy(current.ui_metadata)
        stale_ui_metadata.pop("time_dimension", None)
        stale_ui_metadata.update(
            {
                "managed_default_template": True,
                "managed_template_version": "v1.0",
            }
        )
        STORE.models[model_id] = current.model_copy(
            update={
                "version": "v1.0",
                "semantic_spec": stale_semantic_spec,
                "ui_metadata": stale_ui_metadata,
            }
        )

    model_service.seed_default_templates()

    with STORE.lock:
        upgraded = STORE.models[model_id]
    time_dimension = upgraded.semantic_spec["ui_metadata"]["time_dimension"]
    assert upgraded.version == "v1.1"
    assert upgraded.ui_metadata["managed_template_version"] == "v1.1"
    assert time_dimension["time_set"] == "time"
    assert time_dimension["state_time_set"] == "time_volume"
    assert time_dimension["label_set"] == "time_labels"
    assert time_dimension["label_generation"] == "auto"
    assert time_dimension["interval_minutes"] == 60


def test_compute_power_sample_is_a_single_joint_milp(solved_case: dict) -> None:
    context = solved_case["context"]
    result = solved_case["result"]
    output = solved_case["formatted"]["business_output"]

    assert result.status == "optimal"
    assert solver_router.infer_problem_type_from_model(solved_case["model"]) == "MILP"
    assert context["build_mode"] == "component_based"
    assert context["component_types"] == ["compute_power_coordination_core"]
    assert context["model_size"]["binary_variables"] > 0
    assert output["single_model_joint_optimization"] is True
    assert len(output["compute_schedule_curve"]) == 24
    assert len(output["power_supply_curve"]) == 24
    assert len(output["storage_curve"]) == 24


def test_compute_power_sample_meets_core_business_constraints(solved_case: dict) -> None:
    metrics = solved_case["formatted"]["metrics"]
    checks = solved_case["formatted"]["business_output"]["constraint_check"]

    assert metrics["total_compute_executed"] > 0
    assert metrics["terminal_backlog"] == pytest.approx(0, abs=1e-6)
    assert metrics["inference_sla_violation"] == pytest.approx(0, abs=1e-6)
    assert metrics["pv_utilization_rate"] == pytest.approx(1, abs=1e-6)
    assert metrics["terminal_soc_gap"] == pytest.approx(0, abs=1e-6)
    assert checks["terminal_backlog_cleared"] is True
    assert checks["inference_sla_satisfied"] is True
    assert checks["charge_discharge_exclusive"] is True
    assert checks["soc_within_bounds"] is True
    assert checks["terminal_soc_satisfied"] is True


def test_compute_power_schedule_preserves_energy_balance_and_compatibility(solved_case: dict) -> None:
    parameters = solved_case["parameters"]
    result = solved_case["result"]
    rows = solved_case["formatted"]["series"]

    for index, row in enumerate(rows):
        assert row["grid_buy"] + row["pv_used"] + row["discharge"] == pytest.approx(
            row["facility_load"] + row["charge"], abs=1e-5
        )
        assert row["pv_used"] + row["pv_curtail"] == pytest.approx(parameters["pv_forecast"][index], abs=1e-5)
        assert not (row["charge"] > 1e-6 and row["discharge"] > 1e-6)

    assignments = result.variable_values["work_execute"]
    for workload in parameters["workload"]:
        for cluster in parameters["cluster"]:
            if parameters["cluster_compatibility"][workload][cluster] == 1:
                continue
            prefix = f"work_execute[{workload},{cluster},"
            assert all(abs(value) <= 1e-6 for key, value in assignments.items() if key.startswith(prefix))


def test_compute_power_template_can_clone_test_and_publish() -> None:
    clone = client.post(f"/api/templates/{MODEL_CODE}/clone")
    assert clone.status_code == 200, clone.text
    model_id = clone.json()["id"]
    parameters = deepcopy(get_template(MODEL_CODE)["sample_runtime_parameters"])

    published = test_and_publish_model(client, model_id, parameters)

    assert published.status_code == 200, published.text
    assert published.json()["problem_type"] == "MILP"
    invoked = client.post(
        f"/api/models/{model_id}/invoke",
        json={"parameters": parameters, "options": {"mode": "sync", "time_limit_seconds": 30}},
    )
    assert invoked.status_code == 200, invoked.text
    body = invoked.json()
    assert body["status"] == "SUCCESS", body
    assert body["business_result"]["single_model_joint_optimization"] is True


def test_compute_power_task_summary_uses_solver_objective_value() -> None:
    parameters = deepcopy(get_template(MODEL_CODE)["sample_runtime_parameters"])
    created = client.post(
        "/api/tasks",
        json={
            "model_id": "MODEL-POWER-COMPUTE-POWER-COORDINATION-DAY-AHEAD-V1",
            "parameters": parameters,
            "async_run": False,
            "time_limit_seconds": 30,
        },
    )

    assert created.status_code == 200, created.text
    task = created.json()
    result_response = client.get(f"/api/optimize/result/{task['id']}")
    assert result_response.status_code == 200, result_response.text
    result = result_response.json()
    assert task["objective_value"] == pytest.approx(result["objective_value"], abs=0.01)
    assert task["objective_value"] > 0
    assert task["cost"] == pytest.approx(result["metrics"]["total_operating_cost"], abs=0.01)
