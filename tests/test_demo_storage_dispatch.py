import unittest

from app.services.demo_service import DemoRunRequest, demo_service


class TestDemoStorageDispatch(unittest.TestCase):
    def test_storage_demo_closed_loop(self) -> None:
        result = demo_service.run(DemoRunRequest(scenario="storage_dispatch", use_sample_data=True, business_goal="最大化峰谷套利收益"))
        self.assertEqual(result["job_status"], "SUCCESS")
        self.assertIn("electricity_price", result["forecast_inputs"])
        output = result["solve_result"]["business_output"]
        self.assertIn("charge_discharge_plan", output)
        self.assertIn("soc_curve", output)
        self.assertIn("revenue_assessment", output)
        self.assertIn("constraint_check", output)
        self.assertIn("储能", result["business_summary"])
