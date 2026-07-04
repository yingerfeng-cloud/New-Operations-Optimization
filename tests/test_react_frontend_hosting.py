from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def test_react_dist_is_hosted_with_spa_fallback() -> None:
    assert Path("frontend/dist/index.html").exists(), "run npm run build in frontend first"
    client = TestClient(create_app())
    assert client.get("/").status_code == 200
    assert '<div id="root"></div>' in client.get("/").text
    assert client.get("/models/create").status_code == 200


def test_legacy_frontend_is_offline_and_api_remains_available() -> None:
    client = TestClient(create_app())
    removed_html_entry = "/" + "prototype" + ".html"
    assert client.get("/legacy").status_code == 404
    assert client.get(removed_html_entry).status_code == 404
    assert client.get("/static/js/platform-core.js").status_code == 404
    assert client.get("/api/health").json()["ok"] is True
