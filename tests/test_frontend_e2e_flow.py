from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.utils import has_highspy, has_pyomo


client = TestClient(app)


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_react_frontend_core_api_flow_equivalent() -> None:
    skills = client.get("/api/skills")
    assert skills.status_code == 200, skills.text
    economic = client.get("/api/skills/run_economic_dispatch")
    assert economic.status_code == 200, economic.text
    assert economic.json()["input_schema"]

    agent_skill = client.get("/api/agent/agent-skills/economic_dispatch")
    assert agent_skill.status_code == 200, agent_skill.text
    assert agent_skill.json()["instruction"]
    example = client.get("/api/agent/agent-skills/economic_dispatch/parameter-example")
    assert example.status_code == 200, example.text
    assert example.json()["sample_parameters"]

    import app.agent.orchestrator as orchestrator
    import app.agent_main as agent_main

    assert orchestrator.AgentOrchestrator
    assert agent_main.app


def test_frontend_can_fetch_pv_storage_v2_template_for_runtime_selection() -> None:
    template = client.get("/api/templates/pv_storage_intraday_dispatch_v2")
    assert template.status_code == 200, template.text
    body = template.json()
    assert body["model_code"] == "pv_storage_intraday_dispatch_v2"
    assert body["build_mode"] == "component_based"
    assert any(param["code"] == "deviation_limit" for param in body["parameters"])
