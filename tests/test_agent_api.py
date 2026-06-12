import unittest

from app.services.agent_service import AgentOptimizeRequest, agent_service


class TestAgentApi(unittest.TestCase):
    def test_agent_optimize_storage(self) -> None:
        result = agent_service.optimize(AgentOptimizeRequest(scenario="storage_dispatch", business_goal="最大化峰谷套利收益", runtime_parameters={}, explain=True))
        self.assertEqual(result["status"], "SUCCESS")
        self.assertIn("business_result", result)
        self.assertIn("summary", result)
