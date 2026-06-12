from __future__ import annotations

import html
import uuid
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field


class ReportExportRequest(BaseModel):
    scenario: str
    forecast_inputs: dict[str, Any] = Field(default_factory=dict)
    solve_result: dict[str, Any] = Field(default_factory=dict)
    business_summary: str = ""
    warnings: list[str] = Field(default_factory=list)
    format: Literal["html", "word"] = "html"


class ReportService:
    def export(self, req: ReportExportRequest) -> dict[str, Any]:
        report_dir = Path.cwd() / "reports"
        report_dir.mkdir(exist_ok=True)
        suffix = "doc" if req.format == "word" else "html"
        path = report_dir / f"optimization_report_{req.scenario}_{uuid.uuid4().hex[:8]}.{suffix}"
        content = self._html(req)
        path.write_text(content, encoding="utf-8")
        return {
            "status": "SUCCESS",
            "format": req.format,
            "file_path": str(path),
            "download_url": f"/reports/{path.name}",
            "summary": "优化报告已生成。",
        }

    def _html(self, req: ReportExportRequest) -> str:
        result = req.solve_result or {}
        metrics = result.get("metrics", {})
        output = result.get("business_output", {})
        explanation = result.get("business_explanation", {})
        explanation_text = explanation.get("summary") if isinstance(explanation, dict) else str(explanation)
        return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>电力优化演示报告</title>
  <style>
    body {{ font-family: "Microsoft YaHei", Arial, sans-serif; margin: 32px; color: #172033; }}
    h1 {{ font-size: 24px; }}
    h2 {{ margin-top: 24px; font-size: 18px; border-bottom: 1px solid #d6dde8; padding-bottom: 6px; }}
    pre {{ background: #f6f8fb; padding: 12px; border-radius: 6px; white-space: pre-wrap; }}
    .metric {{ display: inline-block; margin: 6px 12px 6px 0; padding: 8px 10px; background: #eef5ff; border-radius: 6px; }}
  </style>
</head>
<body>
  <h1>电力优化演示报告</h1>
  <h2>场景说明</h2>
  <p>{html.escape(req.scenario)}</p>
  <h2>输入参数</h2>
  <pre>{html.escape(_json(req.forecast_inputs))}</pre>
  <h2>求解状态</h2>
  <p>状态：{html.escape(str(result.get("status", "-")))}；求解器：HiGHS；任务ID：{html.escape(str(result.get("job_id", "-")))}</p>
  <h2>成本/收益测算</h2>
  {''.join(f'<span class="metric">{html.escape(str(k))}: {html.escape(str(v))}</span>' for k, v in metrics.items())}
  <h2>优化结果</h2>
  <pre>{html.escape(_json(output))}</pre>
  <h2>约束校核</h2>
  <pre>{html.escape(_json(output.get("constraint_check", output.get("constraint_tightness", {}))))}</pre>
  <h2>中文业务解释</h2>
  <p>{html.escape(req.business_summary or explanation_text or "-")}</p>
  <h2>风险提示</h2>
  <pre>{html.escape(_json(req.warnings))}</pre>
</body>
</html>"""


def _json(value: Any) -> str:
    import json

    return json.dumps(value, ensure_ascii=False, indent=2)


report_service = ReportService()
