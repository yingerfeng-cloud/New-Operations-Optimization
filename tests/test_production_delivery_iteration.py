from __future__ import annotations

import importlib.util
import re
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


def test_agent_console_no_duplicate_function_names() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    core = ["pageChat", "render", "shell", "pageSkills", "pageAgentSkills", "analyzeMessage", "confirmInvoke"]
    for name in core:
        assert len(re.findall(rf"\bfunction\s+{name}\s*\(", html)) == 1, name


def test_package_excludes_runtime_store_logs_reports_pycache() -> None:
    script = Path("package.ps1").read_text(encoding="utf-8")
    assert '".venv"' in script
    assert '"data\\runtime_store.json"' in script
    assert '"logs"' in script and '"*.log"' in script
    assert '"reports"' in script and '"*.html"' in script
    assert '"__pycache__"' in script

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


playwright_available = importlib.util.find_spec("playwright") is not None


def require_playwright_browser() -> None:
    if not playwright_available:
        pytest.skip("playwright is not installed")
    from playwright.sync_api import Error, sync_playwright

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            browser.close()
    except Error as exc:
        pytest.skip(f"Playwright Chromium browser is not installed: {exc}")


@pytest.mark.skipif(not playwright_available, reason="playwright is not installed")
def test_frontend_playwright_skill_modal() -> None:
    require_playwright_browser()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(Path("prototype.html").resolve().as_uri())
        page.get_by_text("模型资产中心").click()
        page.get_by_text("生成 / 查看 Skill").first.click()
        for text in ["Skill 概览", "调用入口", "输入参数", "输出结构"]:
            assert page.get_by_text(text).first.is_visible()
        browser.close()


@pytest.mark.skipif(not playwright_available, reason="playwright is not installed")
def test_frontend_playwright_agent_economic_dispatch_flow() -> None:
    require_playwright_browser()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(Path("agent_console.html").resolve().as_uri())
        page.get_by_text("新建聊天").click()
        page.locator("#chatInput").fill("帮我跑经济调度，四个时段负荷100、120、90、110，U1最大80成本10，U2最大100成本20，U3最大60成本30")
        page.get_by_text("发送").click()
        page.get_by_text("确认使用默认值").click()
        page.get_by_text("确认调用").click()
        assert page.get_by_text("5900").first.is_visible()
        page.get_by_text("Agent Skill 管理").click()
        page.get_by_text("economic_dispatch").first.click()
        for text in ["SKILL.md", "参数示例", "dry-run-request"]:
            assert page.get_by_text(text).first.is_visible()
        browser.close()
