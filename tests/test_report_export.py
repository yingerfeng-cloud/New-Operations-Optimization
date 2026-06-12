import unittest
from pathlib import Path

from app.services.demo_service import DemoRunRequest, demo_service
from app.services.report_service import ReportExportRequest, report_service


class TestReportExport(unittest.TestCase):
    def test_export_html_report(self) -> None:
        demo = demo_service.run(DemoRunRequest(scenario="storage_dispatch", use_sample_data=True, business_goal="导出演示报告"))
        report = report_service.export(
            ReportExportRequest(
                scenario=demo["scenario"],
                forecast_inputs=demo["forecast_inputs"],
                solve_result=demo["solve_result"],
                business_summary=demo["business_summary"],
                warnings=demo["warnings"],
                format="html",
            )
        )
        path = Path(report["file_path"])
        self.assertTrue(path.exists())
        text = path.read_text(encoding="utf-8")
        self.assertIn("电力优化演示报告", text)
        self.assertIn("中文业务解释", text)
