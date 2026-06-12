"""Tests for global-scalar extraction and per-unit broadcast.

Covers the bug: user says "机组最大出力500、燃料成本60" (no U1/U2/U3 labels)
→ system previously reported both params as still missing.
"""
from __future__ import annotations

import pytest

from app.agent.parameter_extractor import ParameterExtractor

# Minimal input_schema fragments used in tests
_SCHEMA_UNIT_MAX = {
    "key": "unit_max_output",
    "name": "机组最大出力",
    "type": "object",
    "required": True,
    "sample_value": {"U1": 500, "U2": 400, "U3": 350},
}
_SCHEMA_FUEL_COST = {
    "key": "fuel_cost",
    "name": "燃料成本",
    "type": "object",
    "required": True,
    "sample_value": {"U1": 60, "U2": 55, "U3": 50},
}
_SCHEMA_LOAD = {
    "key": "load_forecast",
    "name": "负荷预测",
    "type": "array",
    "required": True,
    "sample_value": [100, 120, 90, 110],
}
SCHEMA = [_SCHEMA_UNIT_MAX, _SCHEMA_FUEL_COST, _SCHEMA_LOAD]


@pytest.fixture()
def extractor() -> ParameterExtractor:
    return ParameterExtractor()


# ---------------------------------------------------------------------------
# Global scalar extraction (rule-based, no U-labels in message)
# ---------------------------------------------------------------------------

def test_global_unit_max_extracted_as_scalar(extractor: ParameterExtractor) -> None:
    result = extractor._rule_extract("机组最大出力500、燃料成本60", SCHEMA)
    assert "unit_max_output" in result
    assert result["unit_max_output"] == 500


def test_global_fuel_cost_extracted_as_scalar(extractor: ParameterExtractor) -> None:
    result = extractor._rule_extract("机组最大出力500、燃料成本60", SCHEMA)
    assert "fuel_cost" in result
    assert result["fuel_cost"] == 60


def test_global_extraction_does_not_conflict_with_per_unit(extractor: ParameterExtractor) -> None:
    """When U-labels group max and cost together, per-unit dict extraction fires.
    Format: 'U1最大出力500燃料成本60，U2最大出力400燃料成本55'
    """
    result = extractor._rule_extract(
        "U1最大出力500燃料成本60，U2最大出力400燃料成本55", SCHEMA
    )
    assert isinstance(result.get("unit_max_output"), dict), f"expected dict, got {result.get('unit_max_output')}"
    assert result["unit_max_output"] == {"U1": 500, "U2": 400}
    assert isinstance(result.get("fuel_cost"), dict)
    assert result["fuel_cost"] == {"U1": 60, "U2": 55}


def test_global_extraction_various_phrasings(extractor: ParameterExtractor) -> None:
    cases = [
        ("最大出力600", "unit_max_output", 600),
        ("出力上限350", "unit_max_output", 350),
        ("燃料成本80", "fuel_cost", 80),
        ("发电成本75", "fuel_cost", 75),
    ]
    for message, key, expected in cases:
        result = extractor._rule_extract(message, SCHEMA)
        assert result.get(key) == expected, f"message={message!r}: expected {key}={expected}, got {result.get(key)}"


def test_no_false_positive_without_relevant_keywords(extractor: ParameterExtractor) -> None:
    result = extractor._rule_extract("负荷是100 120 90 110", SCHEMA)
    assert "unit_max_output" not in result
    assert "fuel_cost" not in result


# ---------------------------------------------------------------------------
# Broadcast: scalar → per-unit dict (orchestrator._broadcast_scalars)
# ---------------------------------------------------------------------------

def test_broadcast_scalars_expands_to_known_units() -> None:
    from app.agent.orchestrator import AgentOrchestrator
    orch = AgentOrchestrator()
    reference = {"unit_min_output": {"U1": 30, "U2": 20, "U3": 10}}
    extracted = {"unit_max_output": 500, "fuel_cost": 60}
    result = orch._broadcast_scalars(extracted, SCHEMA, reference)
    assert result["unit_max_output"] == {"U1": 500, "U2": 500, "U3": 500}
    assert result["fuel_cost"] == {"U1": 60, "U2": 60, "U3": 60}


def test_broadcast_skips_when_no_reference_units() -> None:
    from app.agent.orchestrator import AgentOrchestrator
    orch = AgentOrchestrator()
    extracted = {"unit_max_output": 500}
    # reference_draft has no U\d+ dict → scalar passes through unchanged
    result = orch._broadcast_scalars(extracted, SCHEMA, {})
    assert result["unit_max_output"] == 500


def test_broadcast_does_not_alter_already_dict_values() -> None:
    from app.agent.orchestrator import AgentOrchestrator
    orch = AgentOrchestrator()
    reference = {"unit_min_output": {"U1": 30, "U2": 20}}
    extracted = {"unit_max_output": {"U1": 500, "U2": 400}}
    result = orch._broadcast_scalars(extracted, SCHEMA, reference)
    assert result["unit_max_output"] == {"U1": 500, "U2": 400}


def test_broadcast_does_not_alter_non_unit_scalars() -> None:
    """load_forecast is not a per-unit param (sample_value is a list) — leave as-is."""
    from app.agent.orchestrator import AgentOrchestrator
    orch = AgentOrchestrator()
    reference = {"unit_min_output": {"U1": 30, "U2": 20}}
    schema_with_list = [
        _SCHEMA_UNIT_MAX,
        {"key": "load_forecast", "name": "负荷", "type": "array", "sample_value": [100, 120]},
    ]
    extracted = {"unit_max_output": 500, "load_forecast": [100, 120]}
    result = orch._broadcast_scalars(extracted, schema_with_list, reference)
    assert result["unit_max_output"] == {"U1": 500, "U2": 500}
    assert result["load_forecast"] == [100, 120]


# ---------------------------------------------------------------------------
# End-to-end: full extract() call (rules path, LLM disabled)
# ---------------------------------------------------------------------------

def test_full_extract_global_scalar_pipeline(extractor: ParameterExtractor) -> None:
    """extract() should return scalars (not {}) so broadcast can act on them."""
    result = extractor.extract("机组最大出力500、燃料成本60", SCHEMA)
    assert "unit_max_output" in result
    assert "fuel_cost" in result
    assert result["unit_max_output"] == 500
    assert result["fuel_cost"] == 60
