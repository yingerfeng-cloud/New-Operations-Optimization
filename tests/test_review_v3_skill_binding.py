from app.agent.conversation_store import conversation_store
from app.agent.orchestrator import agent_orchestrator
from app.agent.v3.models import ToolContext
from app.agent.v3.skills.optimization import optimization_task_engine
from app.agent.v3.store import agent_v3_store
from app.services.agent_runtime_service import agent_runtime_service


def test_continuation_prefers_the_recorded_callable_skill_to_the_workflow_label(monkeypatch):
    conversation = conversation_store.create("Synthetic continuation")
    task = agent_v3_store.create_task(conversation["conversation_id"], "TURN-1", "Economic", "optimization_create_or_continue")
    agent_v3_store.update_task(task["task_id"], workflow_key="economic_dispatch", result={"api_skill_name": "run_economic_dispatch"})
    observed = []
    original = agent_runtime_service.analyze

    def analyze(body):
        observed.append(body["skill_name"])
        return original(body)

    monkeypatch.setattr(agent_runtime_service, "analyze", analyze)
    result = optimization_task_engine.analyze(ToolContext(conversation_id=conversation["conversation_id"], turn_id="TURN-2",
        call_id="CALL-2", task_id=task["task_id"], user_message="请继续同一个经济调度优化任务，负荷为160、190、175、160。"), None)
    assert observed == ["run_economic_dispatch"]
    assert result["workflow_state"] != "SKILL_UNAVAILABLE"
    assert result["api_skill_name"] == "run_economic_dispatch"


def test_registered_agent_skill_name_resolves_to_its_callable_api_name():
    assert agent_orchestrator._resolve_api_skill_name("economic_dispatch") == "run_economic_dispatch"
    assert agent_orchestrator._resolve_api_skill_name("unknown_review_skill") == "unknown_review_skill"


def test_initial_dispatch_survives_agent_schema_and_controls_first_period_ramp(client):
    import json
    from copy import deepcopy
    from app.agent.parameter_extractor import parameter_extractor
    from app.services.invocation_service import invocation_service
    from app.templates.power_templates import get_template

    template = get_template("economic_dispatch")
    params = deepcopy(template["sample_runtime_parameters"])
    schema = invocation_service.input_schema(template)
    field = next(row for row in schema if row["key"] == "initial_unit_output")
    assert field["unit"] == "MW" and field["axis_order"] == ["unit"] and not field["required"]
    extracted = parameter_extractor.extract("请更新经济调度参数：" + json.dumps(params), schema)
    assert extracted["initial_unit_output"] == {"U1": 80, "U2": 50, "U3": 30}
    response = client.post("/api/tasks", json={"model_code": "economic_dispatch", "parameters": {**params, **extracted}})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SUCCESS"
    # Cheapest feasible output respects the first-period ramp from 80 MW.
    # Dropping the supplied initial output would instead produce cost 160700.
    assert response.json()["objective_value"] == 160300


def test_completed_solver_evidence_is_available_to_explanation_without_reexecution():
    from copy import deepcopy
    from app.agent.v3.runtime import AgentV3Runtime
    from app.agent.v3.models import ModelTurn
    from app.storage.memory_store import STORE
    conversation = conversation_store.create("Explain recorded result")
    task = agent_v3_store.create_task(conversation["conversation_id"], "TURN-1", "Economic", "optimization_create_or_continue")
    evidence = {"model": {"model_version": "v2"}, "solver": {"status": "success", "objective_value": 160300},
                "inputs_summary": {"parameters": {"initial_unit_output": {"U1": 80}}}}
    original = {"workflow_state": "SUCCESS", "evidence_package": evidence,
        "result": {"raw_result": {"result_metadata": {"function_dependencies": {"F": {"revision": 1}}}}}}
    agent_v3_store.update_task(task["task_id"], status="SUCCEEDED", result=deepcopy(original))
    calls = []

    class InspectGateway:
        def complete(self, messages, tools):
            calls.append(messages)
            return ModelTurn(content="已完成的 v2 模型成本为160300。")

    solver_ids = set(STORE.tasks)
    response = AgentV3Runtime(gateway=InspectGateway()).run_turn(conversation["conversation_id"], "请解释已经完成的结果，不要重新求解。")
    assert "160300" in calls[0][1]["content"] and '"read_only": true' in calls[0][1]["content"]
    assert '"revision": 1' in calls[0][1]["content"]
    assert response["tasks"] == [] and set(STORE.tasks) == solver_ids
    assert agent_v3_store.get_task(task["task_id"])["result"] == original


def test_explanation_integrates_power_only_with_a_recorded_time_step(monkeypatch):
    from types import SimpleNamespace
    from app.agent.v3.runtime import AgentV3Runtime
    from app.storage.memory_store import STORE
    conversation = conversation_store.create("Synthetic physical explanation")
    task = agent_v3_store.create_task(conversation["conversation_id"], "TURN-1", "Economic", "optimization_create_or_continue")
    agent_v3_store.update_task(task["task_id"], status="SUCCEEDED", result={"result": {"task_id": "JOB"},
        "evidence_package": {"variables_summary": [{"name": "unit_output", "unit": "MW", "dimension": ["unit", "time"], "sum": 675}]}})
    for hours, expected in [(None, {}), (1, {"unit_output": {"value": 675, "unit": "MWh"}}), (0.25, {"unit_output": {"value": 168.75, "unit": "MWh"}})]:
        with monkeypatch.context() as change:
            change.setitem(STORE.tasks, "JOB", SimpleNamespace(request=SimpleNamespace(payload={"delta_t": hours})))
            context = AgentV3Runtime._task_context(conversation["conversation_id"])[0]
            assert context["physical_aggregates"] == expected


def test_temporal_power_sum_uses_recorded_energy_fallback():
    from app.agent.v3.result_grounding import ground_completed_explanation
    context = [{"status": "SUCCEEDED", "read_only": True, "recorded_time_step_hours": 1,
        "recorded_result": {"model": {"model_version": "v2", "objective": {"name": "发电成本最小"}},
                            "solver": {"objective_value": 160300, "solver_name": "HiGHS"}},
        "physical_aggregates": {"unit_output": {"value": 675, "unit": "MWh"}}}]
    for text in ("全周期总负荷需求为675MW。", "U1全周期累计出力480MW。"):
        safe, audit = ground_completed_explanation(text, context)
        assert audit["reason"] == "power_sum_unit_mismatch"
        assert "675 MWh" in safe and "160300" in safe and "v2" in safe
        assert "675MW" not in safe and "480MW" not in safe
    valid = "第1时段功率为160MW，累计电量675MWh。"
    assert ground_completed_explanation(valid, context) == (valid, None)
