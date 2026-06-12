import unittest

from app.services.agent_service import AgentOptimizeRequest, agent_service


class TestAgentOptimizeNaturalLanguage(unittest.TestCase):
    def test_storage_goal_matches_storage_template(self) -> None:
        result = agent_service.optimize(AgentOptimizeRequest(business_goal="在满足SOC约束下最大化峰谷套利收益"))
        self.assertEqual(result["status"], "SUCCESS")
        self.assertEqual(result["matched_scenario"], "storage_dispatch")
        self.assertIn("forecast_inputs", result)
        self.assertIn("business_result", result)

    def test_unit_goal_matches_unit_commitment_template(self) -> None:
        result = agent_service.optimize(AgentOptimizeRequest(business_goal="根据明日负荷预测生成机组启停和备用计划"))
        self.assertEqual(result["status"], "SUCCESS")
        self.assertEqual(result["matched_scenario"], "unit_commitment_day_ahead")
        self.assertIn("unit_start_stop_plan", result["business_result"])
