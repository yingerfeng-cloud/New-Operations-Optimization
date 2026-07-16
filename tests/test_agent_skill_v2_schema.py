from app.agent.agent_skill_schema import AgentSkillState, AgentSkillV2, normalize_agent_skill_v2


def test_v2_schema_normalizes_legacy_package():
    payload = normalize_agent_skill_v2(
        {"name": "demo", "canonical_api_skill_name": "run_demo", "trigger_intents": ["运行示例"], "enabled": True},
        [{"key": "load", "name": "负荷", "required": True}],
        {"positive_examples": [{"user": "运行示例"}], "negative_examples": [{"user": "介绍原理"}], "do_not_invoke_examples": [{"user": "只咨询"}]},
    )
    model = AgentSkillV2.model_validate(payload)
    assert model.schema_version == "2.0"
    assert model.state == AgentSkillState.ENABLED
    assert model.required_data[0].name == "load"


def test_v2_state_machine_contains_required_states():
    assert {item.value for item in AgentSkillState} == {"not_created", "draft", "valid", "enabled", "disabled", "invalid", "deprecated"}
