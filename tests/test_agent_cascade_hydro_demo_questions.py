from app.agent.orchestrator import agent_orchestrator


def test_agent_answers_cascade_hydro_fixed_questions() -> None:
    response = agent_orchestrator.analyze({"message": "当前有哪些水电调度模型？"})
    assert response["response_type"] == "demo_answer"
    assert "cascade_hydro_dispatch" in response["message"]

    response = agent_orchestrator.analyze({"message": "这个模型为什么是 MILP？"})
    assert "triangulated_milp_exact" in response["message"]
    assert "HiGHS" in response["message"]

    response = agent_orchestrator.analyze({"message": "二维出力曲面用了多少三角形？"})
    assert "cascade_hydro_power_surface_v1" in response["message"]
