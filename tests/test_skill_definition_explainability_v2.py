from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.agent.conversation_store import conversation_store
from app.agent.orchestrator import agent_orchestrator
from app.agent.skill_router import agent_skill_router
from app.agent_skill_registry import AgentSkillRegistry
from app.explainers.risk_rule_engine import risk_rule_engine
from app.schemas.model import ModelView
from app.schemas.solve import SolveRequest
from app.services.job_service import job_service
from app.services.agent_skill_service import agent_skill_service
from app.services.llm_service import llm_service
from app.services.result_post_processor import result_post_processor
from app.services.skill_definition_service import skill_definition_service
from app.services.skill_registry import skill_registry
from app.storage.memory_store import STORE
from app.services.template_service import template_library
from app.utils import has_highspy, has_pyomo, now_text


def arbitrary_model() -> SimpleNamespace:
    semantic = {
        "model_code": "arbitrary_model_7f3c",
        "parameters": [
            {
                "key": "signal_alpha",
                "name": "Signal alpha",
                "dimension": ["index_a"],
                "unit": "u-in",
                "runtime_injected": True,
                "validation": {"required": True, "type": "dict"},
            }
        ],
        "variables": [
            {
                "key": "decision_omega",
                "name": "Decision omega",
                "dimension": ["index_a"],
                "unit": "u-out",
            }
        ],
        "constraints": [
            {
                "code": "guard_delta",
                "name": "Guard delta",
                "description": "Declared arbitrary guard",
                "hard": True,
                "relaxable": False,
            }
        ],
        "objectives": [
            {"code": "objective_sigma", "name": "Objective sigma", "sense": "maximize", "unit": "score"}
        ],
    }
    return SimpleNamespace(
        id="MODEL-ARBITRARY-7F3C",
        name="Arbitrary contract model",
        scene="Contract-defined test scene",
        version="v9.4",
        content_hash="hash-arbitrary-7f3c",
        objective="objective_sigma",
        tags=["contract-test"],
        semantic_spec=semantic,
        component_spec={},
        generic_spec={},
        model_draft={},
        objective_config={},
        draft_constraints=[],
        input_contract={},
        output_contract={},
        ui_metadata={},
    )


def schemas() -> tuple[list[dict], dict]:
    return (
        [
            {
                "key": "signal_alpha",
                "name": "Signal alpha",
                "dimension": ["index_a"],
                "unit": "u-in",
                "required": True,
                "type": "dict",
            }
        ],
        {
            "objective_value": "number",
            "variables": [
                {
                    "key": "decision_omega",
                    "name": "Decision omega",
                    "dimension": ["index_a"],
                    "unit": "u-out",
                }
            ],
            "explanation_structured": "object",
            "evidence_package": "object",
        },
    )


def test_complete_skill_definition_is_compiled_without_scenario_or_field_maps() -> None:
    model = arbitrary_model()
    input_schema, output_schema = schemas()
    definition = skill_definition_service.compile(
        model=model,
        skill_name="run_arbitrary_model_7f3c",
        input_schema=input_schema,
        output_schema=output_schema,
    )

    assert definition["validation"]["status"] == "valid"
    assert definition["model_binding"] == {
        "policy": "fixed",
        "model_id": model.id,
        "model_version": model.version,
        "model_content_hash": model.content_hash,
    }
    assert definition["instructions"]
    assert definition["trigger_examples"]
    assert definition["non_trigger_examples"]
    assert definition["parameter_questions"][0]["parameter_key"] == "signal_alpha"
    explanation = definition["explanation_spec"]
    assert explanation["objective"]["key"] == "objective_sigma"
    assert explanation["variables"][0]["key"] == "decision_omega"
    assert explanation["constraints"][0]["key"] == "guard_delta"
    variable_metrics = [item for item in explanation["metrics"] if item["source"]["kind"] == "variable"]
    assert variable_metrics
    assert {item["source"]["key"] for item in variable_metrics} == {"decision_omega"}
    assert explanation["risk_rules"] == []  # the compiler never guesses thresholds


def test_metric_keys_remain_unique_for_unicode_and_punctuation() -> None:
    model = arbitrary_model()
    model.semantic_spec = deepcopy(model.semantic_spec)
    variables = [
        {"key": "决策-甲", "name": "决策甲一", "dimension": ["index_a"], "unit": "u"},
        {"key": "决策 甲", "name": "决策甲二", "dimension": ["index_a"], "unit": "u"},
    ]
    model.semantic_spec["variables"] = variables
    input_schema, output_schema = schemas()
    output_schema["variables"] = variables
    definition = skill_definition_service.compile(
        model=model,
        skill_name="run_arbitrary_model_7f3c",
        input_schema=input_schema,
        output_schema=output_schema,
    )
    metric_keys = [item["key"] for item in definition["explanation_spec"]["metrics"]]
    assert definition["validation"]["status"] == "valid"
    assert len(metric_keys) == len(set(metric_keys))
    assert any("决策_甲" in key for key in metric_keys)


def test_fixed_binding_uses_contract_hash_when_model_hash_is_absent() -> None:
    model = arbitrary_model()
    model.content_hash = None
    input_schema, output_schema = schemas()
    definition = skill_definition_service.compile(
        model=model,
        skill_name="run_arbitrary_model_7f3c",
        input_schema=input_schema,
        output_schema=output_schema,
    )
    binding_hash = definition["model_binding"]["model_content_hash"]
    assert binding_hash
    assert binding_hash == definition["generation"]["source_contract_hash"]
    assert definition["validation"]["status"] == "valid"


def test_llm_generation_can_only_enrich_prose_and_preserves_deterministic_invariants(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_service, "enabled", lambda: True)
    monkeypatch.setattr(llm_service, "config", lambda: {"provider": "test", "model": "test-model"})
    monkeypatch.setattr(
        llm_service,
        "chat_json",
        lambda _messages: {
            "description": "Contract-grounded human-facing description.",
            "instructions": ["Add a reviewer-facing explanation note."],
            "trigger_examples": ["Run the declared contract workflow."],
            "non_trigger_examples": ["Discuss the concept without invoking the model."],
            "manual_review_points": ["Review the evidence before operational use."],
            "narrative_guidance": {"tone": "concise", "require_evidence_references": False},
        },
    )
    input_schema, output_schema = schemas()
    definition = skill_definition_service.compile(
        model=arbitrary_model(),
        skill_name="run_arbitrary_model_7f3c",
        input_schema=input_schema,
        output_schema=output_schema,
        use_llm=True,
    )
    assert definition["validation"]["status"] == "valid"
    assert definition["generation"]["llm"]["applied"] is True
    assert "Add a reviewer-facing explanation note." in definition["instructions"]
    assert len(definition["instructions"]) > 1  # deterministic workflow was retained
    guidance = definition["explanation_spec"]["narrative_guidance"]
    assert guidance["tone"] == "concise"
    assert guidance["require_evidence_references"] is True


def test_llm_generation_rejects_unsupported_numbers_and_guarantees(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_service, "enabled", lambda: True)
    monkeypatch.setattr(llm_service, "config", lambda: {"provider": "test", "model": "test-model"})
    monkeypatch.setattr(
        llm_service,
        "chat_json",
        lambda _messages: {"description": "保证收益 999，且无需人工复核。"},
    )
    input_schema, output_schema = schemas()
    definition = skill_definition_service.compile(
        model=arbitrary_model(),
        skill_name="run_arbitrary_model_7f3c",
        input_schema=input_schema,
        output_schema=output_schema,
        use_llm=True,
    )
    audit = definition["generation"]["llm"]
    assert audit["applied"] is False
    assert audit["fallback_used"] is True
    assert audit["reason"] == "LLM_ERROR:ValueError"
    assert "999" not in definition["description"]


def test_result_post_processor_explains_arbitrary_output_with_evidence_refs() -> None:
    processed = result_post_processor.process(
        result={
            "status": "SUCCESS",
            "termination_condition": "optimal",
            "objective_value": 12.5,
            "variable_values": {"decision_omega": {"A": 2.5, "B": 10.0}},
            "constraint_checks": [{"key": "guard_delta", "name": "Guard delta", "status": "binding", "margin": 0}],
        },
        model=arbitrary_model(),
        parameters={"signal_alpha": {"A": 1.0, "B": 4.0}},
    )

    assert processed["evidence_package"]["evidence_schema_version"] == "2.0"
    assert processed["explanation_structured"]["grounded_on"] == "evidence_package"
    assert processed["explanation_structured"]["fact_items"]
    assert all(item.get("evidence_refs") for item in processed["explanation_structured"]["fact_items"])
    metrics = processed["evidence_package"]["derived_metrics"]
    assert metrics["variable_decision_omega_sum_value"]["value"] == 12.5
    assert processed["explanation_audit"]["definition_source"] == "ephemeral_contract_compiler"
    assert processed["requires_human_review"] is True


def test_violated_constraint_becomes_an_evidence_backed_risk() -> None:
    processed = result_post_processor.process(
        result={
            "status": "SUCCESS",
            "objective_value": 1.0,
            "variable_values": {"decision_omega": {"A": 1.0}},
            "constraint_checks": [{"key": "guard_delta", "name": "Guard delta", "status": "violated", "margin": -1}],
        },
        model=arbitrary_model(),
    )
    risks = processed["evidence_package"]["risk_notes"]
    assert risks[0]["level"] == "high"
    assert risks[0]["evidence_ref"] == "constraint_checks.0"
    assert processed["explanation_structured"]["inference_items"][0]["evidence_refs"] == ["constraint_checks.0"]


def test_missing_risk_metric_is_skipped_instead_of_becoming_zero() -> None:
    notes, limitations = risk_rule_engine.evaluate_with_diagnostics(
        {
            "risk_rules": [
                {
                    "key": "missing_upper",
                    "metric_key": "not_returned",
                    "operator": "gte",
                    "threshold": 0,
                    "message": "must not trigger",
                }
            ]
        },
        {},
    )
    assert notes == []
    assert limitations and "not_returned" in limitations[0]


def test_declared_result_metric_risk_rule_is_compiled_and_evaluated() -> None:
    model = arbitrary_model()
    model.semantic_spec = deepcopy(model.semantic_spec)
    model.semantic_spec["metrics_config"] = {
        "metrics": [{"key": "metric_tau", "name": "Metric tau", "unit": "score"}],
    }
    model.semantic_spec["explanation_risk_rules"] = [{
        "key": "tau_limit",
        "metric_key": "metric_tau",
        "operator": "gte",
        "threshold": 5,
        "level": "high",
        "message": "Declared tau limit reached.",
    }]
    input_schema, output_schema = schemas()
    definition = skill_definition_service.compile(
        model=model,
        skill_name="run_arbitrary_model_7f3c",
        input_schema=input_schema,
        output_schema=output_schema,
    )
    assert definition["validation"]["status"] == "valid"
    assert definition["explanation_spec"]["risk_rules"][0]["metric_key"] == "result_metric_tau_value"
    processed = result_post_processor.process(
        result={
            "status": "SUCCESS",
            "objective_value": 1,
            "variable_values": {"decision_omega": {"A": 1}},
            "metrics": {"metric_tau": 7},
        },
        model=model,
    )
    assert processed["evidence_package"]["risk_notes"][0]["key"] == "tau_limit"
    assert processed["evidence_package"]["risk_notes"][0]["evidence_ref"] == "derived_metrics.result_metric_tau_value"


def test_explanation_failure_never_masks_a_valid_solver_result(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_evidence(**_kwargs):
        raise RuntimeError("synthetic explanation failure")

    monkeypatch.setattr("app.services.result_post_processor.evidence_builder.build", fail_evidence)
    processed = result_post_processor.process(
        result={"status": "SUCCESS", "objective_value": 3.5, "termination_condition": "optimal"},
        model=arbitrary_model(),
    )
    assert processed["status"] == "SUCCESS"
    assert processed["evidence_package"]["solver"]["objective_value"] == 3.5
    assert processed["explanation_audit"]["fallback"]["used"] is True
    assert "EVIDENCE_PROCESSING_ERROR" in processed["explanation_audit"]["fallback"]["reason"]


def test_agent_result_explanation_uses_the_actual_saved_result() -> None:
    conversation_id = "CONV-ACTUAL-EXPLANATION-V2"
    actual = {
        "status": "SUCCESS",
        "requires_human_review": True,
        "explanation_structured": {
            "summary": "actual-result-summary-7f3c",
            "facts": ["actual-result-fact-12.5"],
            "inferences": [],
            "recommendations": ["review-actual-result"],
            "risk_notes": [],
            "manual_review_points": ["review-actual-result"],
            "limitations": [],
            "grounded_on": "evidence_package",
        },
        "evidence_package": {"solver": {"objective_value": 12.5}},
        "explanation_audit": {"processor": "result_post_processor_v2"},
    }
    conversation_store.upsert(
        conversation_id,
        {
            "resolved_skill_name": "run_arbitrary_model_7f3c",
            "last_result": actual,
            "status": "RESULT_READY",
            "messages": [],
        },
    )
    response = agent_orchestrator.explain_result({"conversation_id": conversation_id})
    assert response["summary"] == "actual-result-summary-7f3c"
    assert "actual-result-fact-12.5" in response["message"]
    assert response["evidence_package"] == actual["evidence_package"]


def test_agent_api_binding_uses_generated_metadata_for_arbitrary_skill(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        agent_skill_service,
        "list_skills",
        lambda: [{
            "name": "arbitrary_agent_7f3c",
            "canonical_api_skill_name": "run_arbitrary_model_7f3c",
        }],
    )
    assert agent_orchestrator._agent_skill_for_api("run_arbitrary_model_7f3c") == "arbitrary_agent_7f3c"
    assert agent_orchestrator._agent_skill_for_api("run_arbitrary_model_7f3c_v9_model") == "arbitrary_agent_7f3c"


def test_generated_skill_is_persisted_versioned_fixed_and_manually_editable(tmp_path) -> None:
    source = arbitrary_model()
    timestamp = now_text()
    model = ModelView(
        id=source.id,
        name=source.name,
        scene=source.scene,
        version=source.version,
        status="published",
        is_active_version=True,
        semantic_spec=source.semantic_spec,
        content_hash=source.content_hash,
        created_at=timestamp,
        updated_at=timestamp,
    )
    skill_name = "run_arbitrary_model_7f3c"
    with STORE.lock:
        previous_model = STORE.models.get(model.id)
        previous_skill = STORE.skills.get(skill_name)
        STORE.models[model.id] = model
        STORE.skills.pop(skill_name, None)
    try:
        generated = skill_registry.generate_skill(model.id)
        assert generated["generated"] is True
        assert generated["binding_policy"] == "fixed"
        assert generated["definition_revision"] == 1
        assert generated["definition_validation"]["status"] == "valid"
        assert skill_registry._model_for_skill(skill_name).id == model.id

        agent_registry = AgentSkillRegistry(tmp_path / "agent_skills")
        package = agent_registry.create_from_api_skill(skill_name)
        package_path = tmp_path / "agent_skills" / "arbitrary_model_7f3c"
        assert package["validation"]["status"] == "valid"
        assert (package_path / "SKILL.md").is_file()
        assert (package_path / "skill_definition.snapshot.json").is_file()
        assert (package_path / "prompts" / "result_explanation.md").is_file()
        manual_skill_text = "# Human-reviewed Skill\n\nKeep this manual change.\n"
        (package_path / "SKILL.md").write_text(manual_skill_text, encoding="utf-8")
        agent_registry.create_from_api_skill(skill_name)
        assert (package_path / "SKILL.md").read_text(encoding="utf-8") == manual_skill_text
        agent_registry.set_state("arbitrary_model_7f3c", "enabled")
        route = agent_skill_router.route(
            "请运行 Arbitrary contract model",
            {},
            agent_registry.list_skills(),
        )
        assert route["intent"] == "optimization_request"
        assert route["agent_skill_name"] == "arbitrary_model_7f3c"

        edited_definition = dict(generated["definition"])
        edited_definition["description"] = "Human-edited description retained as a revision."
        edited = skill_registry.update_skill(skill_name, {"definition": edited_definition})
        assert edited["definition_revision"] == 2
        assert edited["definition"]["description"] == "Human-edited description retained as a revision."
        invalid_contract_edit = deepcopy(edited["definition"])
        invalid_contract_edit["input_schema"] = []
        with pytest.raises(HTTPException) as exc:
            skill_registry.update_skill(skill_name, {"definition": invalid_contract_edit})
        error_codes = {item["code"] for item in exc.value.detail["errors"]}
        assert "INPUT_SCHEMA_CONTRACT_MISMATCH" in error_codes
        assert "UNKNOWN_PARAMETER_QUESTION" in error_codes
        versions = skill_registry.list_skill_versions(skill_name)
        assert [item["revision"] for item in versions] == [2, 1]
        assert all(item["definition_hash"] for item in versions)
    finally:
        with STORE.lock:
            if previous_model is None:
                STORE.models.pop(model.id, None)
            else:
                STORE.models[model.id] = previous_model
            if previous_skill is None:
                STORE.skills.pop(skill_name, None)
            else:
                STORE.skills[skill_name] = previous_skill
            STORE.save_runtime()


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_direct_task_path_uses_the_same_explanation_contract() -> None:
    parameters = template_library.sample_runtime_parameters("economic_dispatch")
    task = job_service.create_task(
        SolveRequest(
            model_id="MODEL-POWER-ECONOMIC-DISPATCH",
            parameters=parameters,
            async_run=False,
        )
    )
    assert task.status == "SUCCESS"
    result = task.result or {}
    assert result["evidence_package"]["evidence_schema_version"] == "2.0"
    assert result["explanation_structured"]["explanation_schema_version"] == "2.0"
    assert result["explanation_audit"]["processor"] == "result_post_processor_v2"
    assert result["business_explanation"] == result["explanation_structured"]
    metrics = result["evidence_package"]["derived_metrics"]
    assert metrics["variable_unit_output_sum_value"]["value"] == pytest.approx(sum(parameters["load_forecast"]))
    assert any(
        "derived_metrics.variable_unit_output_sum_value" in item.get("evidence_refs", [])
        for item in result["explanation_structured"]["fact_items"]
    )
