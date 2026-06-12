from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.utils import has_highspy, has_pyomo
from tests.test_model_skill_invocation import minimal_dispatch_payload


client = TestClient(app)


@unittest.skipUnless(has_pyomo() and has_highspy(), "pyomo/highspy are required for agent skill invocation")
class TestAgentLLMFlow(unittest.TestCase):
    def test_llm_test_disabled_is_safe(self) -> None:
        res = client.post("/api/llm/test")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIn("enabled", res.json())

    def test_agent_analyze_confirm_and_explain_economic_dispatch(self) -> None:
        created = client.post("/api/models", json=minimal_dispatch_payload())
        self.assertEqual(created.status_code, 200, created.text)
        model_id = created.json()["id"]
        published = client.post(f"/api/models/{model_id}/publish")
        self.assertEqual(published.status_code, 200, published.text)

        message = "帮我跑一下 U1、U2 两台机组三个时段的经济调度，负荷是100、120、90，U1最大80成本10，U2最大100成本20。"
        analyzed = client.post(
            "/api/agent/analyze",
            json={"conversation_id": "CONV-TEST-ED", "message": message, "skill_name": "run_economic_dispatch"},
        )
        self.assertEqual(analyzed.status_code, 200, analyzed.text)
        body = analyzed.json()
        self.assertTrue(body["ready_to_invoke"], body)
        self.assertEqual(body["normalized_parameters"]["load_forecast"]["T1"], 100)
        self.assertEqual(body["normalized_parameters"]["unit_max_output"]["U1"], 80)
        self.assertEqual(body["normalized_parameters"]["fuel_cost"]["U2"], 20)

        invoked = client.post("/api/agent/confirm-invoke", json={"conversation_id": "CONV-TEST-ED"})
        self.assertEqual(invoked.status_code, 200, invoked.text)
        result = invoked.json()
        self.assertEqual(result["status"], "SUCCESS")
        self.assertAlmostEqual(float(result["result"]["objective_value"]), 3800.0)
        self.assertIn("U1", result["explanation"])

        explained = client.post("/api/agent/explain-result", json={"conversation_id": "CONV-TEST-ED", "use_llm": False})
        self.assertEqual(explained.status_code, 200, explained.text)
        self.assertIn("summary", explained.json())
        self.assertTrue(explained.json()["requires_human_review"])


if __name__ == "__main__":
    unittest.main()
