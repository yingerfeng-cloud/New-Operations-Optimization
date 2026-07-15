from __future__ import annotations

import uuid
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.utils import has_pyomo


client = TestClient(app)


def unique_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


def valid_custom_model(model_id: str | None = None) -> dict:
    model_code = f"custom_optimization_model_{uuid.uuid4().hex[:8]}"
    return {
        "id": model_id,
        "name": f"valid-custom-{uuid.uuid4().hex[:6]}",
        "scene": "自定义模型",
        "semantic_spec": {
            "model_code": model_code,
            "scenario": "自定义模型",
            "sets": [
                {"key": "unit", "name": "机组集合", "values": ["U1", "U2"]},
                {"key": "time", "name": "时段集合", "values": [0, 1]},
            ],
            "parameters": [
                {"key": "fuel_cost", "math_param": "fuel_cost", "dimension": ["unit"], "default_value": {"U1": 10, "U2": 20}},
            ],
            "variables": [
                {"key": "unit_output", "math_var": "unit_output", "dimension": ["unit", "time"], "domain": "NonNegativeReals"},
            ],
            "constraints": [],
            "objectives": [{"code": "cost_min", "name": "成本最小", "sense": "minimize"}],
        },
        "generic_spec": {
            "sense": "minimize",
            "sets": {"unit": ["U1", "U2"], "time": [0, 1]},
            "parameters": {"fuel_cost": {"U1": 10, "U2": 20}},
            "variables": [{"name": "unit_output", "indices": ["unit", "time"], "domain": "NonNegativeReals", "lb": 0}],
            "constraints": [],
            "objective": {
                "terms": [
                    {"var": "unit_output", "foreach": ["unit", "time"], "key": ["unit", "time"], "coef_param": "fuel_cost", "param_key": ["unit"]}
                ],
                "constant": 0,
            },
        },
    }


def minimal_time_dispatch_model(model_id: str | None = None, *, include_defaults: bool = False) -> dict:
    model_code = f"custom_time_dispatch_{uuid.uuid4().hex[:8]}"
    parameters = [
        {"key": "load_forecast", "math_param": "load_forecast", "dimension": ["time"], "runtime_injected": True, "validation": {"required": True, "type": "dict", "min": 0}},
        {"key": "fuel_cost", "math_param": "fuel_cost", "dimension": ["unit"], "runtime_injected": True, "validation": {"required": True, "type": "dict", "min": 0}},
        {"key": "unit_max_output", "math_param": "unit_max_output", "dimension": ["unit"], "runtime_injected": True, "validation": {"required": True, "type": "dict", "min": 0, "default": 999}},
    ]
    if include_defaults:
        parameters[0]["default_value"] = {"T0": 100, "T1": 120, "T2": 90}
        parameters[1]["default_value"] = {"U1": 10, "U2": 20}
        parameters[2]["default_value"] = {"U1": 80, "U2": 100}
    return {
        "id": model_id,
        "name": f"minimal-time-dispatch-{uuid.uuid4().hex[:6]}",
        "scene": "自定义模型",
        "semantic_spec": {
            "model_code": model_code,
            "scenario": "最小经济调度自定义模型",
            "sets": [
                {"key": "unit", "name": "机组集合", "values": ["U1", "U2"]},
                {"key": "time", "name": "时段集合", "values": ["T0", "T1", "T2"]},
            ],
            "parameters": parameters,
            "variables": [
                {"key": "unit_output", "math_var": "unit_output", "dimension": ["unit", "time"], "domain": "NonNegativeReals", "lb": 0, "ub_param": "unit_max_output"},
            ],
            "constraints": [
                {"code": "power_balance", "foreach": ["time"], "business_rule": "sum unit_output >= load"},
                {"code": "output_bound", "foreach": ["unit", "time"], "business_rule": "unit output <= max"},
            ],
            "objectives": [{"code": "total_cost_min", "name": "总发电成本最小", "sense": "minimize"}],
        },
        "generic_spec": {
            "sense": "minimize",
            "sets": {"unit": ["U1", "U2"], "time": ["T0", "T1", "T2"]},
            "parameters": {} if not include_defaults else {
                "load_forecast": {"T0": 100, "T1": 120, "T2": 90},
                "fuel_cost": {"U1": 10, "U2": 20},
                "unit_max_output": {"U1": 80, "U2": 100},
            },
            "variables": [{"name": "unit_output", "indices": ["unit", "time"], "domain": "NonNegativeReals", "lb": 0, "ub_param": "unit_max_output", "ub_key": ["unit"]}],
            "constraints": [
                {"name": "power_balance", "foreach": ["time"], "terms": [{"var": "unit_output", "foreach": ["unit"], "key": ["unit", "time"], "coef": 1}], "sense": ">=", "rhs_param": "load_forecast", "rhs_key": ["time"]},
                {"name": "output_bound", "foreach": ["unit", "time"], "terms": [{"var": "unit_output", "key": ["unit", "time"], "coef": 1}], "sense": "<=", "rhs_param": "unit_max_output", "rhs_key": ["unit"]},
            ],
            "objective": {
                "terms": [{"var": "unit_output", "foreach": ["unit", "time"], "key": ["unit", "time"], "coef_param": "fuel_cost", "param_key": ["unit"]}],
                "constant": 0,
            },
        },
    }


class ModelCreationValidationTest(unittest.TestCase):
    def test_create_empty_model_as_draft_allowed_but_publish_rejected(self) -> None:
        payload = {"id": unique_id("MODEL-EMPTY"), "name": "空白测试", "scene": "自定义模型"}
        created = client.post("/api/models", json=payload)
        self.assertEqual(created.status_code, 200, created.text)

        published = client.post(f"/api/models/{created.json()['id']}/publish")
        self.assertEqual(published.status_code, 422)
        detail = published.json()["detail"]
        self.assertEqual(detail["message"], "模型发布失败")
        fields = [item["field"] for item in detail["errors"]]
        self.assertIn("semantic_spec", fields)
        self.assertIn("generic_spec", fields)

    def test_create_duplicate_model_id_rejected(self) -> None:
        model_id = unique_id("MODEL-DUP")
        first = client.post("/api/models", json={"id": model_id, "name": "A", "scene": "S"})
        self.assertEqual(first.status_code, 200, first.text)
        second = client.post("/api/models", json={"id": model_id, "name": "B", "scene": "S"})
        self.assertEqual(second.status_code, 409)

    def test_delete_model_removes_it_from_assets(self) -> None:
        model_id = unique_id("MODEL-DEL")
        created = client.post("/api/models", json={"id": model_id, "name": "delete-me", "scene": "S"})
        self.assertEqual(created.status_code, 200, created.text)

        deleted = client.delete(f"/api/models/{model_id}")
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(deleted.json()["status"], "deleted")

        missing = client.get(f"/api/models/{model_id}")
        self.assertEqual(missing.status_code, 404)

    def test_create_bad_generic_model_rejected(self) -> None:
        payload = {
            "id": unique_id("MODEL-BAD"),
            "name": "坏模型",
            "scene": "自定义模型",
            "semantic_spec": {"model_code": "custom_optimization_model", "sets": [], "parameters": [], "variables": []},
            "generic_spec": {
                "sets": {},
                "parameters": {},
                "variables": [{"name": "x", "indices": ["time"], "domain": "NonNegativeReals"}],
                "constraints": [{"name": "bad", "foreach": ["time"], "terms": [{"var": "x", "key": ["time"], "coef": 1}], "sense": ">=", "rhs_param": "missing"}],
                "objective": {"terms": [{"var": "x", "coef": 1}], "constant": 0},
            },
        }
        res = client.post("/api/models", json=payload)
        self.assertEqual(res.status_code, 422)
        errors = res.json()["detail"]["errors"]
        self.assertTrue(any(item["field"] == "generic_spec.variables.x" for item in errors))
        self.assertTrue(any(item["actual"] == "missing" for item in errors))

    def test_publish_empty_objective_rejected(self) -> None:
        payload = valid_custom_model(unique_id("MODEL-NOOBJ"))
        payload["generic_spec"]["objective"] = {"terms": [], "constant": 0}
        created = client.post("/api/models", json={**payload, "status": "developing"})
        self.assertEqual(created.status_code, 422)

    def test_valid_custom_model_can_be_created_and_published(self) -> None:
        payload = valid_custom_model(unique_id("MODEL-VALID"))
        created = client.post("/api/models", json=payload)
        self.assertEqual(created.status_code, 200, created.text)
        published = client.post(f"/api/models/{created.json()['id']}/publish")
        self.assertEqual(published.status_code, 200, published.text)
        self.assertEqual(published.json()["status"], "published")

    def test_constraint_term_key_must_match_variable_indices(self) -> None:
        payload = valid_custom_model(unique_id("MODEL-BADKEY-C"))
        payload["generic_spec"]["constraints"] = [
            {
                "name": "c",
                "foreach": ["time"],
                "terms": [{"var": "unit_output", "key": ["time"], "coef": 1}],
                "sense": ">=",
                "rhs": 0,
            }
        ]
        res = client.post("/api/models", json=payload)
        self.assertEqual(res.status_code, 422)
        self.assertTrue(any(item["error"] == "variable key mismatch" for item in res.json()["detail"]["errors"]))

    def test_objective_term_key_must_match_variable_indices(self) -> None:
        payload = valid_custom_model(unique_id("MODEL-BADKEY-O"))
        payload["generic_spec"]["objective"]["terms"][0]["key"] = ["time"]
        payload["generic_spec"]["objective"]["terms"][0]["foreach"] = ["time"]
        res = client.post("/api/models", json=payload)
        self.assertEqual(res.status_code, 422)
        self.assertTrue(any(item["field"] == "generic_spec.objective.terms.key" for item in res.json()["detail"]["errors"]))

    def test_generic_sets_must_include_variable_indices(self) -> None:
        payload = valid_custom_model(unique_id("MODEL-MISSING-GSET"))
        del payload["generic_spec"]["sets"]["unit"]
        res = client.post("/api/models", json=payload)
        self.assertEqual(res.status_code, 422)
        self.assertTrue(any(item["field"] == "generic_spec.sets.unit" for item in res.json()["detail"]["errors"]))

    def test_publish_rejects_empty_generic_set(self) -> None:
        payload = valid_custom_model(unique_id("MODEL-EMPTY-GSET"))
        payload["generic_spec"]["sets"]["unit"] = []
        res = client.post("/api/models", json=payload)
        self.assertEqual(res.status_code, 422)
        self.assertTrue(any(item["field"] == "generic_spec.sets.unit" for item in res.json()["detail"]["errors"]))

    def test_publish_blocks_skipped_pyomo_dry_run_when_dependency_missing_in_dev_mode(self) -> None:
        payload = valid_custom_model(unique_id("MODEL-NOPYOMO"))
        created = client.post("/api/models", json=payload)
        self.assertEqual(created.status_code, 200, created.text)
        with patch("app.services.model_service.has_pyomo", return_value=False), patch("app.services.model_service.require_pyomo_for_publish", return_value=False):
            published = client.post(f"/api/models/{created.json()['id']}/publish")
        self.assertEqual(published.status_code, 422, published.text)
        detail = published.json()["detail"]
        self.assertEqual(detail["dry_run_result"]["solver_check"]["status"], "skipped")
        self.assertTrue(any(item.get("field") == "environment.pyomo" and item.get("level") == "warning" for item in detail["errors"]))

    def test_publish_generic_model_uses_dry_run_parameters_from_semantic_spec(self) -> None:
        payload = minimal_time_dispatch_model(unique_id("MODEL-DRY-RUNTIME"), include_defaults=False)
        created = client.post("/api/models", json=payload)
        self.assertEqual(created.status_code, 200, created.text)
        published = client.post(f"/api/models/{created.json()['id']}/publish")
        self.assertEqual(published.status_code, 200, published.text)
        self.assertEqual(published.json()["status"], "published")

    def test_time_dimension_dict_runtime_parameters_can_solve_custom_dispatch(self) -> None:
        if not has_pyomo():
            self.skipTest("pyomo/highspy are required for solve integration test")
        try:
            import highspy  # noqa: F401
        except Exception:
            self.skipTest("highspy is required for solve integration test")

        payload = minimal_time_dispatch_model(unique_id("MODEL-TIME-DICT"), include_defaults=False)
        created = client.post("/api/models", json=payload)
        self.assertEqual(created.status_code, 200, created.text)
        published = client.post(f"/api/models/{created.json()['id']}/publish")
        self.assertEqual(published.status_code, 200, published.text)

        task = client.post(
            "/api/tasks",
            json={
                "model_id": created.json()["id"],
                "parameters": {
                    "load_forecast": {"T0": 100, "T1": 120, "T2": 90},
                    "fuel_cost": {"U1": 10, "U2": 20},
                    "unit_max_output": {"U1": 80, "U2": 100},
                },
                "time_limit_seconds": 60,
            },
        )
        self.assertEqual(task.status_code, 200, task.text)
        task_id = task.json()["id"]
        final_task = task.json()
        for _ in range(50):
            final_task = client.get(f"/api/tasks/{task_id}").json()
            if final_task["status"] in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT"}:
                break
            time.sleep(0.1)
        self.assertEqual(final_task["status"], "SUCCESS", final_task)

        result = client.get(f"/api/tasks/{task_id}/result")
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertAlmostEqual(float(body["objective_value"]), 3800.0)
        unit_output = body["variable_values"]["unit_output"]
        self.assertEqual(unit_output["U1,T0"], 80.0)
        self.assertEqual(unit_output["U2,T1"], 40.0)


if __name__ == "__main__":
    unittest.main()
