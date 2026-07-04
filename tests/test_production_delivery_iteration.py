from __future__ import annotations

import uuid
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent.conversation_store import conversation_store
from app.agent.platform_client import platform_client
from app.main import app


client = TestClient(app)
PLATFORM_ERROR = "Agent 服务在线，但无法连接运筹优化平台，暂不能调用模型。请检查平台服务地址、Token 和服务状态。"


@pytest.fixture()
def unavailable_platform(monkeypatch):
    original_base_url = platform_client.base_url
    monkeypatch.setenv("AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK", "false")
    monkeypatch.setattr(platform_client, "base_url", "http://127.0.0.1:1")
    yield
    platform_client.base_url = original_base_url


def test_agent_platform_unavailable_optimization_request_returns_platform_error(unavailable_platform) -> None:
    response = client.post("/api/agent/analyze", json={"conversation_id": "CONV-PLATFORM-DOWN", "message": "请帮我跑经济调度"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["response_type"] == "platform_unavailable"
    assert body["message"] == PLATFORM_ERROR
    assert "我可以帮你完成经济调度" not in body["message"]


def test_agent_platform_unavailable_confirm_defaults_returns_no_active_task(unavailable_platform) -> None:
    response = client.post(
        "/api/agent/analyze",
        json={"conversation_id": "CONV-NO-DEFAULTS", "message": "确认使用默认值", "confirm_defaults": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["message"] == "当前没有待确认默认值的优化任务。"


def test_agent_platform_unavailable_confirm_invoke_returns_no_active_task(unavailable_platform) -> None:
    response = client.post("/api/agent/confirm-invoke", json={"conversation_id": "CONV-NO-INVOKE"})
    assert response.status_code == 200, response.text
    assert response.json()["message"] == "当前会话没有可调用的优化任务。"


def test_cascade_hydro_analyze_and_run_missing_required_consistent() -> None:
    analyzed = client.post("/api/skills/run_cascade_hydro_dispatch/analyze-input", json={"partial_parameters": {}})
    assert analyzed.status_code == 200, analyzed.text
    run = client.post("/api/skills/run_cascade_hydro_dispatch/run", json={"parameters": {}})
    assert run.status_code == 422, run.text
    analyze_missing = {item["key"] for item in analyzed.json()["missing_required"]}
    run_missing = {item["key"] for item in run.json()["detail"]["missing_required"]}
    assert analyze_missing == run_missing
    assert {"local_inflow", "load_forecast"} <= run_missing


def test_package_excludes_runtime_store_logs_reports_pycache() -> None:
    script = Path("package.ps1").read_text(encoding="utf-8")
    assert "\\\\.venv" in script
    assert '"data\\runtime_store.json"' in script
    assert '"logs"' in script and '"*.log"' in script
    assert '"reports"' in script and '"*.html"' in script
    assert '"__pycache__"' in script
    assert "\\artifacts" in script
    assert "\\\\frontend\\\\dist" in script
    assert "\\\\frontend\\\\playwright-report" in script
    assert "\\\\frontend\\\\node_modules" in script
    assert '$IncludeItems' in script

    output = Path(f"copt-500-test-{uuid.uuid4().hex}.zip")
    sample_names = [
        "data/runtime_store.json",
        "data/runtime_store.example.json",
        "logs/platform.log",
        "reports/report.html",
        "app/__pycache__/x.pyc",
        "README.md",
    ]
    with zipfile.ZipFile(output, "w") as archive:
        for name in sample_names:
            normalized = name.replace("\\", "/")
            if normalized == "data/runtime_store.json":
                continue
            if normalized.startswith("logs/") and normalized.endswith(".log"):
                continue
            if normalized.startswith("reports/") and normalized.endswith(".html"):
                continue
            if "__pycache__/" in normalized or normalized.endswith(".pyc"):
                continue
            archive.writestr(normalized, "x")
    with zipfile.ZipFile(output) as archive:
        names = {name.replace("\\", "/") for name in archive.namelist()}
    output.unlink()
    assert "data/runtime_store.json" not in names
    assert "data/runtime_store.example.json" in names
    assert not any(name.startswith("logs/") and name.endswith(".log") for name in names)
    assert not any(name.startswith("reports/") and name.endswith(".html") for name in names)
    assert not any("__pycache__/" in name or name.endswith(".pyc") for name in names)
