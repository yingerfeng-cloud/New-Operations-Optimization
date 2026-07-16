from app.agent.llm_intent_parser_v2 import llm_intent_parser_v2


def test_parser_is_optional_when_llm_is_disabled(monkeypatch):
    monkeypatch.setattr("app.agent.llm_intent_parser_v2.llm_service.enabled", lambda: False)
    assert llm_intent_parser_v2.parse("做储能调度", {}, []) is None


def test_parser_filters_unknown_candidates(monkeypatch):
    monkeypatch.setattr("app.agent.llm_intent_parser_v2.llm_service.enabled", lambda: True)
    monkeypatch.setattr(
        "app.agent.llm_intent_parser_v2.llm_service.chat_json",
        lambda _: {
            "intent_type": "optimization_run",
            "is_execution_request": True,
            "candidate_skills": [
                {"platform_skill_name": "run_allowed", "confidence": 0.9, "reason": "match"},
                {"platform_skill_name": "run_invented", "confidence": 1.0, "reason": "hallucinated"},
            ],
        },
    )
    result = llm_intent_parser_v2.parse("运行", {}, [{"name": "allowed", "platform_skill_name": "run_allowed", "enabled": True, "state": "enabled"}])
    assert result is not None
    assert result["candidate_skills"] == [{"platform_skill_name": "run_allowed", "confidence": 0.9, "reason": "match"}]
