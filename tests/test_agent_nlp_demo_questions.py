from app.agent.orchestrator import agent_orchestrator


def test_agent_answers_nlp_fixed_questions() -> None:
    response = agent_orchestrator.analyze({"message": "当前平台是否支持 NLP？"})
    assert response["response_type"] == "demo_answer"
    assert "NLP / Ipopt 已支持真实求解" in response["message"]

    response = agent_orchestrator.analyze({"message": "Ipopt 求解结果是不是全局最优？"})
    assert "不是全局最优承诺" in response["message"]

    response = agent_orchestrator.analyze({"message": "当前平台是否支持生产级 MINLP？"})
    assert "MINLP_RESERVED" in response["message"]
    assert "不作为生产级能力" in response["message"] or "不把" in response["message"]
