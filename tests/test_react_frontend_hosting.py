from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def test_react_dist_is_hosted_with_spa_fallback() -> None:
    assert Path("frontend/dist/index.html").exists(), "run npm run build in frontend first"
    client = TestClient(create_app())
    assert client.get("/").status_code == 200
    assert '<div id="root"></div>' in client.get("/").text
    assert client.get("/models/create").status_code == 200


def test_legacy_frontend_and_api_remain_available() -> None:
    client = TestClient(create_app())
    assert client.get("/legacy").status_code == 200
    assert "prototype" not in client.get("/legacy").text.lower() or "platform" in client.get("/legacy").text.lower()
    assert client.get("/prototype.html").status_code == 200
    assert client.get("/api/health").json()["ok"] is True
