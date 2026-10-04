from __future__ import annotations

from app.agent.parameter_extractor import parameter_extractor
from app.agent.schema_parameter_analyzer import schema_parameter_analyzer
from app.storage.memory_store import MemoryStore


def _dispatch_schema() -> list[dict]:
    return [
        {
            "key": "load_forecast",
            "name": "负荷预测",
            "dimension": ["time"],
            "type": "array",
            "required": True,
            "sample_value": [100, 110, 120, 130],
            "sets": {"time": [0, 1, 2, 3]},
            "time_dimension": {"policy": "runtime_variable", "time_set": "time", "default_horizon": 4},
        },
        {
            "key": "unit_min_output",
            "name": "机组最小出力",
            "dimension": ["unit"],
            "type": "dict",
            "required": True,
            "sample_value": {"U1": 10, "U2": 10, "U3": 10},
            "sets": {"unit": ["U1", "U2", "U3"]},
        },
        {
            "key": "unit_max_output",
            "name": "机组最大出力",
            "dimension": ["unit"],
            "type": "dict",
            "required": True,
            "sample_value": {"U1": 100, "U2": 100, "U3": 100},
            "sets": {"unit": ["U1", "U2", "U3"]},
        },
        {
            "key": "fuel_cost",
            "name": "燃料成本",
            "dimension": ["unit"],
            "type": "dict",
            "required": True,
            "sample_value": {"U1": 100, "U2": 120, "U3": 150},
            "sets": {"unit": ["U1", "U2", "U3"]},
        },
    ]


def test_timestamped_forecast_and_ordered_unit_values_are_extracted_exactly() -> None:
    message = (
        "负荷为00:00→160，01:00→180，02:00→170，03:00→150；"
        "U1、U2、U3最小出力为30,20,10，最大出力为120,90,70，燃料成本为220,260,360"
    )

    result = parameter_extractor._rule_extract(message, _dispatch_schema())

    assert result["load_forecast"] == [160, 180, 170, 150]
    assert result["time"] == ["00:00", "01:00", "02:00", "03:00"]
    assert result["horizon"] == 4
    assert result["unit_min_output"] == {"U1": 30, "U2": 20, "U3": 10}
    assert result["unit_max_output"] == {"U1": 120, "U2": 90, "U3": 70}
    assert result["fuel_cost"] == {"U1": 220, "U2": 260, "U3": 360}


def test_implicit_unit_count_materializes_stable_unit_keys() -> None:
    message = (
        "负荷预测从00:00到03:00分别为160、170、180、165 MW；"
        "两台机组最小出力分别为50、60 MW，最大出力分别为120、130 MW，"
        "燃料成本分别为200、220元/MWh。"
    )

    result = parameter_extractor._rule_extract(message, _dispatch_schema())

    assert result["load_forecast"] == [160, 170, 180, 165]
    assert result["unit_min_output"] == {"U1": 50, "U2": 60}
    assert result["unit_max_output"] == {"U1": 120, "U2": 130}
    assert result["fuel_cost"] == {"U1": 200, "U2": 220}


def test_dynamic_horizon_replaces_sample_cardinality_and_semantics_gate_readiness() -> None:
    forecast = [120 + index for index in range(24)]
    parameters = {
        "load_forecast": forecast,
        "unit_min_output": {"U1": 10, "U2": 10, "U3": 10},
        "unit_max_output": {"U1": 100, "U2": 100, "U3": 100},
        "fuel_cost": {"U1": 100, "U2": 120, "U3": 150},
    }

    valid = schema_parameter_analyzer.analyze(_dispatch_schema(), parameters)

    assert valid["invalid_parameters"] == []
    assert valid["normalized_parameters"]["horizon"] == 24
    assert valid["normalized_parameters"]["time"] == list(range(24))

    parameters["unit_min_output"] = {"U1": 110, "U2": 10, "U3": 10}
    invalid = schema_parameter_analyzer.analyze(_dispatch_schema(), parameters)

    assert invalid["ready"] is False
    assert {item.get("code") for item in invalid["invalid_parameters"]} == {"UNIT_OUTPUT_BOUNDS_INVALID"}


def test_v7_migration_quarantines_shared_workflow_state_but_keeps_chat_history() -> None:
    payload = {
        "conversations": {
            "CONV-1": {
                "conversation_id": "CONV-1",
                "messages": [{"role": "user", "text": "保留这条消息"}],
                "model_messages": [{"role": "tool", "content": "internal ids"}],
                "parameter_draft": {"load_forecast": [1, 2, 3]},
                "resolved_skill_name": "run_old",
                "status": "PARAM_COLLECTING",
            }
        },
        "agent_tasks": {
            "TASK-1": {
                "task_id": "TASK-1",
                "conversation_id": "CONV-1",
                "tool_name": "optimization_create_or_continue",
                "status": "WAITING_INPUT",
                "optimization_run_id": "RUN-1",
            }
        },
        "agent_approvals": {
            "APR-1": {"approval_id": "APR-1", "task_id": "TASK-1", "status": "PENDING"}
        },
        "agent_runs": {"RUN-1": {"run_id": "RUN-1", "status": "READY"}},
        "agent_events": {},
    }

    MemoryStore._migrate_agent_tasks_to_isolated_contexts(payload)

    conversation = payload["conversations"]["CONV-1"]
    assert conversation["messages"] == [{"role": "user", "text": "保留这条消息"}]
    assert "model_messages" not in conversation
    assert "parameter_draft" not in conversation
    assert conversation["kind"] == "user"
    assert payload["agent_tasks"]["TASK-1"]["status"] == "CANCELLED"
    assert payload["agent_approvals"]["APR-1"]["status"] == "SUPERSEDED"
    assert payload["agent_runs"]["RUN-1"]["status"] == "CANCELLED"
