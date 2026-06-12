import unittest

from app.services.demo_service import DemoRunRequest, demo_service


class TestDemoUnitCommitment(unittest.TestCase):
    def test_unit_commitment_demo_closed_loop(self) -> None:
        result = demo_service.run(DemoRunRequest(scenario="unit_commitment_day_ahead", use_sample_data=True, business_goal="生成日前机组启停计划"))
        self.assertEqual(result["job_status"], "SUCCESS")
        self.assertIn("load_forecast", result["forecast_inputs"])
        output = result["solve_result"]["business_output"]
        self.assertIn("unit_start_stop_plan", output)
        self.assertIn("unit_output_plan", output)
        self.assertIn("cost_breakdown", output)
        self.assertIn("reserve_margin", output)
        self.assertIn("系统", result["business_summary"])
