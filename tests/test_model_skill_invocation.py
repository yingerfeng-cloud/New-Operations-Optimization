from __future__ import annotations

import uuid
import unittest
import time

from fastapi.testclient import TestClient

from app.main import app
from app.utils import has_highspy, has_pyomo

client = TestClient(app)


def minimal_dispatch_payload() -> dict:
    model_id = f"MODEL-SKILL-{uuid.uuid4().hex[:8].upper()}"
    return {
        "id": model_id,
        "name": "最小经济调度模型",
        "scene": "经济调度",
        "objective": "total_cost_min",
        "semantic_spec": {
            "model_code": "custom_optimization_model",
            "scenario": "最小经济调度模型",
            "sets": [
                {"key": "unit", "name": "机组集合", "values": ["U1", "U2"]},
                {"key": "time", "name": "时段集合", "values": ["T1", "T2", "T3"]},
            ],
            "parameters": [
                {"key": "load_forecast", "name": "负荷预测", "math_param": "load_forecast", "unit": "MW", "dimension": ["time"], "runtime_injected": True, "sample_value": {"T1": 100, "T2": 120, "T3": 90}, "validation": {"required": True, "type": "dict", "min": 0}},
                {"key": "fuel_cost", "name": "燃料成本", "math_param": "fuel_cost", "unit": "元/MWh", "dimension": ["unit"], "runtime_injected": True, "sample_value": {"U1": 10, "U2": 20}, "validation": {"required": True, "type": "dict", "min": 0}},
                {"key": "unit_max_output", "name": "机组最大出力", "math_param": "unit_max_output", "unit": "MW", "dimension": ["unit"], "runtime_injected": True, "sample_value": {"U1": 80, "U2": 100}, "validation": {"required": True, "type": "dict", "min": 0}},
            ],
            "variables": [
                {"key": "unit_output", "name": "机组出力", "math_var": "unit_output", "unit": "MW", "dimension": ["unit", "time"], "domain": "NonNegativeReals", "lb": 0, "ub_param": "unit_max_output"}
            ],
            "constraints": [{"code": "power_balance"}, {"code": "output_bound"}],
            "objectives": [{"code": "total_cost_min", "sense": "minimize"}],
        },
        "generic_spec": {
            "sense": "minimize",
            "sets": {"unit": ["U1", "U2"], "time": ["T1", "T2", "T3"]},
            "parameters": {},
            "variables": [{"name": "unit_output", "indices": ["unit", "time"], "domain": "NonNegativeReals", "lb": 0, "ub_param": "unit_max_output", "ub_key": ["unit"]}],
            "constraints": [
                {"name": "power_balance", "foreach": ["time"], "terms": [{"var": "unit_output", "foreach": ["unit"], "key": ["unit", "time"], "coef": 1}], "sense": ">=", "rhs_param": "load_forecast", "rhs_key": ["time"]},
                {"name": "output_bound", "foreach": ["unit", "time"], "terms": [{"var": "unit_output", "key": ["unit", "time"], "coef": 1}], "sense": "<=", "rhs_param": "unit_max_output", "rhs_key": ["unit"]},
            ],
            "objective": {"terms": [{"var": "unit_output", "foreach": ["unit", "time"], "key": ["unit", "time"], "coef_param": "fuel_cost", "param_key": ["unit"]}], "constant": 0},
        },
    }


@unittest.skipUnless(has_pyomo() and has_highspy(), "pyomo/highspy are required for skill invocation")
class ModelSkillInvocationTest(unittest.TestCase):
    def test_published_custom_dispatch_generates_skill_and_runs(self) -> None:
        created = client.post("/api/models", json=minimal_dispatch_payload())
        self.assertEqual(created.status_code, 200, created.text)
        model_id = created.json()["id"]
        published = client.post(f"/api/models/{model_id}/publish")
        self.assertEqual(published.status_code, 200, published.text)

        schema = client.get(f"/api/models/{model_id}/schema")
        self.assertEqual(schema.status_code, 200, schema.text)
        self.assertTrue(any(item["key"] == "load_forecast" for item in schema.json()["input_schema"]))

        skills = client.get("/api/skills")
        self.assertEqual(skills.status_code, 200, skills.text)
        self.assertTrue(
            any(
                "run_economic_dispatch" in item.get("skill_aliases", [item["skill_name"]]) and item["model_id"] == model_id
                for item in skills.json()
            )
        )

        result = client.post(
            "/api/skills/run_economic_dispatch/run",
            json={
                "load_forecast": {"T1": 100, "T2": 120, "T3": 90},
                "fuel_cost": {"U1": 10, "U2": 20},
                "unit_max_output": {"U1": 80, "U2": 100},
            },
        )
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(body["status"], "SUCCESS")
        self.assertEqual(body["execution_policy"], "advisory_only")
        self.assertTrue(body["requires_human_review"])
        self.assertAlmostEqual(float(body["objective_value"]), 3800.0)
        self.assertEqual(body["variable_values"]["unit_output"]["U1,T1"], 80.0)
        self.assertEqual(body["variable_values"]["unit_output"]["U2,T2"], 40.0)
        self.assertIn("U1", body["explanation"])
        self.assertIn("补足剩余负荷", body["explanation"])

        invocation = client.get(f"/api/invocations/{body['invocation_id']}")
        self.assertEqual(invocation.status_code, 200, invocation.text)
        self.assertEqual(invocation.json()["skill_name"], "run_economic_dispatch")
        self.assertIn("load_forecast", invocation.json()["parameter_summary"])
        invocations = client.get("/api/invocations")
        self.assertEqual(invocations.status_code, 200, invocations.text)
        self.assertTrue(any(item["invocation_id"] == body["invocation_id"] for item in invocations.json()))

    def test_async_invocation_refreshes_to_terminal_status(self) -> None:
        created = client.post("/api/models", json=minimal_dispatch_payload())
        self.assertEqual(created.status_code, 200, created.text)
        model_id = created.json()["id"]
        published = client.post(f"/api/models/{model_id}/publish")
        self.assertEqual(published.status_code, 200, published.text)

        result = client.post(
            "/api/skills/run_economic_dispatch/run",
            json={
                "parameters": {
                    "load_forecast": {"T1": 100, "T2": 120, "T3": 90},
                    "fuel_cost": {"U1": 10, "U2": 20},
                    "unit_max_output": {"U1": 80, "U2": 100},
                },
                "options": {"mode": "async", "explain": True},
            },
        )
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertIn("invocation_id", body)
        latest = None
        for _ in range(30):
            detail = client.get(f"/api/invocations/{body['invocation_id']}")
            self.assertEqual(detail.status_code, 200, detail.text)
            latest = detail.json()
            if latest["status"] in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
                break
            time.sleep(0.2)
        self.assertIsNotNone(latest)
        self.assertEqual(latest["status"], "SUCCESS")
        self.assertIn("response", latest)
        self.assertEqual(latest["response"]["status"], "SUCCESS")

    def test_failed_skill_call_returns_invocation_id_and_error_record(self) -> None:
        created = client.post("/api/models", json=minimal_dispatch_payload())
        self.assertEqual(created.status_code, 200, created.text)
        model_id = created.json()["id"]
        published = client.post(f"/api/models/{model_id}/publish")
        self.assertEqual(published.status_code, 200, published.text)

        result = client.post("/api/skills/run_economic_dispatch/run", json={"load_forecast": {"T1": 100}})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(body["status"], "FAILED")
        self.assertIn("invocation_id", body)
        self.assertEqual(body["error"]["type"], "parameter_validation_error")
        detail = client.get(f"/api/invocations/{body['invocation_id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["status"], "FAILED")
        self.assertIn("error", detail.json())

    def test_analyze_input_reports_missing_and_defaults(self) -> None:
        created = client.post("/api/models", json=minimal_dispatch_payload())
        self.assertEqual(created.status_code, 200, created.text)
        model_id = created.json()["id"]
        published = client.post(f"/api/models/{model_id}/publish")
        self.assertEqual(published.status_code, 200, published.text)

        analyzed = client.post("/api/skills/run_economic_dispatch/analyze-input", json={"partial_parameters": {"load_forecast": {"T1": 100}}})
        self.assertEqual(analyzed.status_code, 200, analyzed.text)
        body = analyzed.json()
        self.assertIn("ready", body)
        self.assertIn("missing_required", body)
        self.assertIn("questions", body)
        self.assertIn("normalized_parameters", body)
        self.assertTrue(body["ready"] or body["missing_required"] or body["can_use_default"])

    def test_skill_can_be_disabled_and_enabled(self) -> None:
        created = client.post("/api/models", json=minimal_dispatch_payload())
        self.assertEqual(created.status_code, 200, created.text)
        model_id = created.json()["id"]
        published = client.post(f"/api/models/{model_id}/publish")
        self.assertEqual(published.status_code, 200, published.text)

        generated = client.post(f"/api/models/{model_id}/skills/generate")
        self.assertEqual(generated.status_code, 200, generated.text)
        skill_name = generated.json()["skill_name"]
        disabled = client.post(f"/api/skills/{skill_name}/disable")
        self.assertEqual(disabled.status_code, 200, disabled.text)
        self.assertEqual(disabled.json()["skill_status"], "disabled")
        skills = client.get("/api/skills")
        self.assertEqual(skills.status_code, 200, skills.text)
        listed = next(item for item in skills.json() if item["skill_name"] == skill_name)
        self.assertEqual(listed["skill_status"], "disabled")
        self.assertFalse(listed["callable"])
        result = client.post(
            f"/api/skills/{skill_name}/run",
            json={
                "parameters": {
                    "load_forecast": {"T1": 100, "T2": 120, "T3": 90},
                    "fuel_cost": {"U1": 10, "U2": 20},
                    "unit_max_output": {"U1": 80, "U2": 100},
                },
                "options": {"mode": "sync", "explain": True},
            },
        )
        self.assertEqual(result.status_code, 409, result.text)
        enabled = client.post(f"/api/skills/{skill_name}/enable")
        self.assertEqual(enabled.status_code, 200, enabled.text)
        self.assertEqual(enabled.json()["skill_status"], "enabled")

    def test_unit_commitment_skill_returns_commitment_explanation(self) -> None:
        skills = client.get("/api/skills")
        self.assertEqual(skills.status_code, 200, skills.text)
        self.assertTrue(
            any("run_unit_commitment_day_ahead" in item.get("skill_aliases", [item["skill_name"]]) for item in skills.json())
        )

        result = client.post(
            "/api/skills/run_unit_commitment_day_ahead/run",
            json={
                "parameters": {
                    "horizon": 4,
                    "load_forecast": [120, 180, 210, 160],
                    "renewable_forecast": [20, 30, 40, 20],
                    "initial_unit_status": {"U1": 1, "U2": 0, "U3": 0},
                    "initial_unit_output": {"U1": 80, "U2": 0, "U3": 0},
                },
                "options": {"mode": "sync", "explain": True},
            },
        )
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(body["status"], "SUCCESS")
        self.assertEqual(body["execution_policy"], "advisory_only")
        self.assertTrue(body["requires_human_review"])
        self.assertIn("unit_output", body["variable_values"])
        self.assertIn("unit_on", body["variable_values"])
        self.assertIn("unit_startup", body["variable_values"])
        self.assertIn("unit_commitment_plan", body["business_variables"])
        first_plan = body["business_variables"]["unit_commitment_plan"]["rows"][0]
        self.assertIn("shutdown", first_plan)
        self.assertIn("启停计划", body["explanation"])
        self.assertIn("不会自动下发", body["explanation"])


if __name__ == "__main__":
    unittest.main()
