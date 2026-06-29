from __future__ import annotations

from fastapi.testclient import TestClient

from app.agent_main import create_agent_app
from app.platform_main import create_platform_app


def test_platform_app_exposes_skill_api_without_agent_routes() -> None:
    client = TestClient(create_platform_app(enforce_token=False))
    assert client.get("/api/skills").status_code == 200
    component_catalog = client.get("/api/components/catalog")
    assert component_catalog.status_code == 200
    assert any(item["component_id"] == "hydro_reservoir_balance" for item in component_catalog.json())
    assert client.post("/api/agent/analyze", json={}).status_code in {404, 405}


def test_agent_app_exposes_agent_routes_without_platform_routes() -> None:
    client = TestClient(create_agent_app())
    assert client.get("/api/skills").status_code == 404
    assert client.post("/api/llm/test").status_code == 200


def test_platform_token_middleware(monkeypatch) -> None:
    monkeypatch.setenv("OPTIMIZATION_PLATFORM_API_TOKEN", "secret-token")
    client = TestClient(create_platform_app(enforce_token=True))
    assert client.get("/api/skills").status_code == 401
    assert client.get("/api/skills", headers={"Authorization": "Bearer secret-token"}).status_code == 200
