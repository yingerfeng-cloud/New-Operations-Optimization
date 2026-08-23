from __future__ import annotations

import json
from pathlib import Path

from app.agent.schema_parameter_analyzer import schema_parameter_analyzer
from app.agent_skill_registry import agent_skill_registry
from app.builders.unit_commitment_builder import unit_commitment_template


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_REQUIRED = ["load_forecast", "renewable_forecast"]
EXPECTED_OPTIONAL = [
    "unit_min_output",
    "unit_max_output",
    "ramp_up_limit",
    "ramp_down_limit",
    "fuel_cost",
    "startup_cost",
    "initial_unit_status",
    "initial_unit_output",
]


def test_unit_commitment_template_declares_user_requiredness() -> None:
    parameters = unit_commitment_template()["parameters"]
    required = [item["code"] for item in parameters if item.get("required") is not False]
    optional = [item["code"] for item in parameters if item.get("required") is False]

    assert required == EXPECTED_REQUIRED
    assert optional == EXPECTED_OPTIONAL
    assert all(item.get("default_policy") == "default_allowed" for item in parameters if item["code"] in EXPECTED_OPTIONAL)


def test_unit_commitment_agent_schema_keeps_defaults_out_of_missing_required() -> None:
    skill = agent_skill_registry.get_skill_local("unit_commitment_day_ahead")
    schema = skill["input_schema"]
    analysis = schema_parameter_analyzer.analyze(schema, {})

    assert skill["required_parameters"] == EXPECTED_REQUIRED
    assert skill["optional_parameters"] == EXPECTED_OPTIONAL
    assert [item["key"] for item in analysis["missing_required"]] == EXPECTED_REQUIRED
    assert {item["key"] for item in analysis["can_use_default"]} == set(EXPECTED_OPTIONAL)


def test_unit_commitment_generated_schema_matches_agent_schema() -> None:
    schema_path = ROOT / "agent_skills" / "unit_commitment_day_ahead" / "input_schema.json"
    snapshot_path = ROOT / "agent_skills" / "unit_commitment_day_ahead" / "skill_definition.snapshot.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))

    for contract in (schema, snapshot["input_schema"]):
        assert [item["key"] for item in contract if item.get("required") is not False] == EXPECTED_REQUIRED
        assert [item["key"] for item in contract if item.get("required") is False] == EXPECTED_OPTIONAL
        assert all(item.get("default_value") is not None for item in contract if item["key"] in EXPECTED_OPTIONAL)
