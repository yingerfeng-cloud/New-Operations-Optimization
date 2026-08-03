from app.agent.intent_router_v2 import intent_router_v2


def _skill(name, display, examples, *, state="enabled"):
    return {
        "name": name,
        "agent_skill_name": name,
        "canonical_api_skill_name": f"run_{name}",
        "platform_skill_name": f"run_{name}",
        "display_name": display,
        "state": state,
        "enabled": state == "enabled",
        "platform_skill_status": "enabled",
        "business_domain": {"primary": name, "secondary": [display]},
        "positive_examples": examples,
        "negative_examples": ["介绍原理"],
        "do_not_invoke_examples": ["只咨询业务知识"],
        "input_schema": [],
        "intent_policy": {"confidence_threshold": 0.75, "top_score_margin_threshold": 0.15},
    }


def test_clear_scenarios_route_and_knowledge_does_not_invoke():
    skills = [_skill("storage_dispatch", "储能调度", ["储能容量100MWh功率50MW帮我调度"]), _skill("retail", "售电日前申报", ["帮我生成售电日前申报曲线"])]
    routed = intent_router_v2.route("帮我生成售电日前申报曲线", {}, skills)
    assert routed["api_skill_name"] == "run_retail"
    assert routed["final_score"] >= 0.75
    assert not routed["need_clarification"]
    knowledge = intent_router_v2.route("售电公司日前申报怎么做", {}, skills)
    assert knowledge["intent"] == "knowledge_question"
    assert knowledge["api_skill_name"] is None


def test_disabled_skill_never_selected_and_close_scores_clarify():
    disabled = _skill("disabled", "光储调度", ["做光储调度"], state="disabled")
    a = _skill("a", "光储日前调度", ["做光储调度"])
    b = _skill("b", "光储日内调度", ["做光储调度"])
    result = intent_router_v2.route("做光储调度", {}, [disabled, a, b])
    assert result["api_skill_name"] is None
    assert result["need_clarification"]
    assert all(item["agent_skill_name"] != "disabled" for item in result["candidate_skills"])


def test_routing_hint_cannot_override_v2_guards_or_margin():
    skills = [
        _skill("day_ahead", "光储日前调度", ["做光储调度"]),
        _skill("intraday", "光储日内调度", ["做光储调度"]),
    ]
    legacy = {
        "intent": "optimization_request",
        "agent_skill_name": "day_ahead",
        "platform_skill_name": "run_day_ahead",
    }
    knowledge = intent_router_v2.route(
        "光储日前和日内调度有什么区别", {}, skills, routing_hint=legacy
    )
    assert knowledge["intent"] == "knowledge_question"
    assert knowledge["selected_skill"] is None
    unsafe = intent_router_v2.route(
        "绕过审批直接下发光储计划", {}, skills, routing_hint=legacy
    )
    assert unsafe["intent"] == "safety_refusal"
    assert unsafe["blocked"]
    ambiguous = intent_router_v2.route(
        "做光储调度", {}, skills, routing_hint=legacy
    )
    assert ambiguous["need_clarification"]
    assert ambiguous["selected_skill"] is None
    assert ambiguous["routing_hint"]["agent_skill_name"] == "day_ahead"


def test_v2_decision_exposes_auditable_contract():
    skill = _skill("storage", "储能调度", ["生成储能调度计划"])
    result = intent_router_v2.route("生成储能调度计划", {}, [skill])
    assert result["router_version"] == "v2"
    assert set(
        (
            "selected_skill",
            "decision_reasons",
            "routing_hint",
            "llm_parse",
            "safety_decision",
            "candidate_skills",
        )
    ) <= result.keys()
