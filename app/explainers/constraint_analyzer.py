from __future__ import annotations

from typing import Any
from app.services.result_diagnostics import result_diagnostics


class ConstraintAnalyzer:
    def analyze(self, result: dict[str, Any]) -> list[dict[str, Any]]:
        result = {**result, **result_diagnostics(result)}
        business_output = result.get("business_output") if isinstance(result.get("business_output"), dict) else {}
        raw = (
            result.get("constraint_checks")
            or result.get("constraint_violation_summary")
            or business_output.get("constraint_check")
            or business_output.get("constraint_checks")
            or []
        )
        if isinstance(raw, dict):
            nested = raw.get("checks") if isinstance(raw.get("checks"), list) else raw.get("violations")
            if isinstance(nested, list):
                raw = nested
            else:
                raw = [
                    {"key": key, "name": key, "status": "satisfied" if value is True else "violated" if value is False else "reported", "value": value}
                    for key, value in raw.items()
                ]
        output: list[dict[str, Any]] = []
        for index, item in enumerate(raw if isinstance(raw, list) else []):
            if not isinstance(item, dict):
                continue
            value, limit = item.get("value"), item.get("limit")
            margin = item.get("margin")
            if margin is None and isinstance(value, (int, float)) and isinstance(limit, (int, float)):
                margin = limit - value
            status = item.get("status") or ("binding" if isinstance(margin, (int, float)) and abs(margin) <= 1e-7 else "satisfied")
            output.append({
                **item,
                "key": item.get("key") or item.get("name") or item.get("constraint") or f"constraint_{index + 1}",
                "name": item.get("name") or item.get("constraint") or f"constraint_{index + 1}",
                "business_name": item.get("business_name") or item.get("label") or item.get("name"),
                "status": status,
                "period": item.get("period") if item.get("period") is not None else item.get("time"),
                "value": value,
                "limit": limit,
                "margin": margin,
                "evidence_ref": f"constraint_checks.{index}",
            })
        return output


constraint_analyzer = ConstraintAnalyzer()
