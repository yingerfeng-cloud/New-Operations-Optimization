from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any


SCENARIO_STATUSES = {"draft", "trial", "published", "offline"}
SCENARIO_CONFIG_PATH = Path(__file__).resolve().parent / "config" / "business_scenarios.json"


def _load_business_scenarios() -> list[dict[str, Any]]:
    payload = json.loads(SCENARIO_CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError("business scenario configuration must be an array")
    seen: set[str] = set()
    scenarios: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise RuntimeError("business scenario configuration rows must be objects")
        code = str(item.get("code") or "").strip()
        label = str(item.get("label") or "").strip()
        status = str(item.get("status") or "draft").strip().lower()
        if not code or not label or code in seen or status not in SCENARIO_STATUSES:
            raise RuntimeError(f"invalid business scenario configuration: {code or '<empty>'}")
        seen.add(code)
        scenarios.append({
            **deepcopy(item),
            "code": code,
            "label": label,
            "status": status,
            "template_codes": [str(value) for value in item.get("template_codes", [])],
        })
    return scenarios


DEFAULT_BUSINESS_SCENARIOS = _load_business_scenarios()


def public_business_scenarios() -> list[dict[str, Any]]:
    return [
        {key: deepcopy(value) for key, value in item.items() if key != "template_codes"}
        for item in DEFAULT_BUSINESS_SCENARIOS
    ]


def scenario_id_for_template(template_code: str | None) -> str | None:
    code = str(template_code or "").strip()
    if not code:
        return None
    for scenario in DEFAULT_BUSINESS_SCENARIOS:
        if code in scenario.get("template_codes", []):
            return str(scenario["code"])
    return None


def business_scenario_by_id(scenario_id: str | None) -> dict[str, Any] | None:
    code = str(scenario_id or "").strip()
    return next((deepcopy(item) for item in DEFAULT_BUSINESS_SCENARIOS if item["code"] == code), None)
