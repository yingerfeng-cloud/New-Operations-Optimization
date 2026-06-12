from __future__ import annotations

from pathlib import Path
import re

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.utils import has_highspy, has_pyomo


client = TestClient(app)


def _frontend_sources() -> str:
    prototype = Path("prototype.html").read_text(encoding="utf-8")
    js = "\n".join(
        Path(match.split("?", 1)[0]).read_text(encoding="utf-8")
        for match in re.findall(r'<script\s+src="([^"]+)"\s*></script>', prototype)
    )
    return prototype + "\n" + js


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_frontend_core_e2e_flow_equivalent() -> None:
    prototype = _frontend_sources()
    agent_console = Path("agent_console.html").read_text(encoding="utf-8")
    assert "apiBase" in prototype
    assert "pageSkillAssets" in prototype
    assert "/agent/agent-skills" in agent_console

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
