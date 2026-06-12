from __future__ import annotations

import importlib
import tempfile
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from app.agent.parameter_extractor import parameter_extractor
from app.main import app


client = TestClient(app)


def _cid(name: str) -> str:
    return f"CONV-{name}-{uuid.uuid4().hex[:8].upper()}"


def test_analyze_help_does_not_call_llm_extractor(monkeypatch) -> None:
    called = {"value": False}

    def fake_extract(*args, **kwargs):
        called["value"] = True
        return {"extracted_parameters": {}}

    monkeypatch.setattr("app.services.llm_service.llm_service.extract_parameters", fake_extract)
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("HOWTO-NOLLM"), "message": "我该怎么用呢"})
    assert res.status_code == 200, res.text
    assert res.json()["response_type"] == "how_to_use"
    assert called["value"] is False


def test_required_parameters_does_not_call_llm_extractor(monkeypatch) -> None:
    called = {"value": False}

    def fake_extract(*args, **kwargs):
        called["value"] = True
        return {"extracted_parameters": {}}

    monkeypatch.setattr("app.services.llm_service.llm_service.extract_parameters", fake_extract)
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("REQ-NOLLM"), "message": "我需要提供哪些参数"})
    assert res.status_code == 200, res.text
    assert res.json()["response_type"] in {"required_parameters_overview", "skill_selection_required"}
    assert called["value"] is False


def test_skill_only_request_skips_llm_extractor(monkeypatch) -> None:
    called = {"value": False}

    def fake_extract(*args, **kwargs):
        called["value"] = True
        return {"extracted_parameters": {"load_forecast": [1, 2, 3]}}

    monkeypatch.setattr("app.services.llm_service.llm_service.extract_parameters", fake_extract)
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("HYDRO-NOLLM"), "message": "帮我做梯级水电调度计划"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["agent_skill_name"] == "cascade_hydro_dispatch"
    assert body["workflow_state"] == "PARAM_COLLECTING"
    assert body["missing_required"]
    assert called["value"] is False


def test_llm_extract_timeout_fallback(monkeypatch) -> None:
    def fake_rule(message, input_schema):
        return {}

    def fake_extract(*args, **kwargs):
        raise TimeoutError("llm timed out")

    monkeypatch.setattr(parameter_extractor, "_rule_extract", fake_rule)
    monkeypatch.setattr("app.services.llm_service.llm_service.extract_parameters", fake_extract)
    msg = "帮我跑经济调度，负荷100、120，U1最大80成本10，U2最大100成本20"
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("LLM-TIMEOUT"), "message": msg})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["llm_timeout"] is True
    assert body["fallback_mode"] == "rule_based"


def test_analyze_returns_timing() -> None:
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("TIMING"), "message": "我该怎么用呢"})
    assert res.status_code == 200, res.text
    timing = res.json()["timing"]
    assert "total_ms" in timing
    assert timing["llm_extract_ms"] == 0


def test_runtime_store_path_unified(monkeypatch) -> None:
    monkeypatch.delenv("RUNTIME_STORE_PATH", raising=False)
    from app.storage.memory_store import MemoryStore

    store = MemoryStore()
    assert store.persistence_path.name == "runtime_store.json"
    assert store.persistence_path.parent.name == "data"
    assert "runtime_store.local.json" not in str(store.persistence_path)


def test_llm_config_persists_after_restart(monkeypatch) -> None:
    store_path = Path(tempfile.gettempdir()) / f"runtime_store_test_{uuid.uuid4().hex}.json"
    monkeypatch.setenv("RUNTIME_STORE_PATH", str(store_path))
    import app.storage.memory_store as memory_store
    import app.services.llm_service as llm_module

    reloaded_store = importlib.reload(memory_store)
    monkeypatch.setattr(llm_module, "STORE", reloaded_store.STORE)
    service = llm_module.LLMService()
    saved = service.update_config({"provider": "volcengine_ark", "base_url": "https://ark.example/v3", "model": "endpoint", "enabled": True, "api_key": "secret"})
    assert saved["api_key_configured"] is True
    assert saved["config_source"] == "runtime_store"
    assert saved["persistence_path"] == str(store_path)

    reloaded_store = importlib.reload(memory_store)
    monkeypatch.setattr(llm_module, "STORE", reloaded_store.STORE)
    restored = llm_module.LLMService().config()
    assert restored["enabled"] is True
    assert restored["api_key_configured"] is True
    assert restored["model"] == "endpoint"


def test_package_excludes_runtime_store() -> None:
    script = Path("package.ps1").read_text(encoding="utf-8")
    assert "runtime_store.json" in script
    assert "runtime_store.local.json" in script
    assert "__pycache__" in script
    assert "reports" in script


def test_frontend_has_abort_controller() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert "AbortController" in html
    assert "timeoutMs=15000" in html
    assert "本轮响应超时" in html


def test_frontend_single_active_loading() -> None:
    html = Path("agent_console.html").read_text(encoding="utf-8")
    assert "isSending" in html
    assert "activeRequestId" in html
    assert "clearLoadingMessages()" in html
    assert "上一轮请求仍在处理中" in html


def test_missing_required_state_priority() -> None:
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("STATE"), "message": "帮我做储能调度"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["missing_required"]
    assert body["workflow_state"] == "PARAM_COLLECTING"
    assert body["requires_default_confirmation"] is False


def test_confirm_defaults_with_missing_required_stays_collecting() -> None:
    cid = _cid("DEFAULT-MISSING")
    first = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我做储能调度"})
    assert first.status_code == 200, first.text
    confirmed = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "确认使用默认值", "confirm_defaults": True})
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()
    assert body["workflow_state"] == "PARAM_COLLECTING"
    assert body["ready_to_invoke"] is False
    assert body["missing_required"]
    assert "参数还不完整" in body["message"]


def test_storage_parameter_names_are_business_chinese() -> None:
    res = client.post("/api/agent/analyze", json={"conversation_id": _cid("ZH-NAMES"), "message": "帮我做储能调度"})
    assert res.status_code == 200, res.text
    body = res.json()
    names = [item["name"] for item in body["missing_required"] + body["can_use_default"]]
    assert {"电价", "储能容量", "最大充电功率", "最大放电功率", "充电效率", "放电效率", "初始SOC"} <= set(names)
    assert not any(any(bad in name for bad in ["鏁", "鐢", "璋", "搴", "鍖", "绯", "Max charge", "Max discharge"]) for name in names)


def test_required_parameters_schema_consistent() -> None:
    cid = _cid("UC-REQ-CONSISTENT")
    first = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "帮我跑日前机组组合"})
    assert first.status_code == 200, first.text
    missing = {item["key"] for item in first.json()["missing_required"]}
    params = client.post("/api/agent/analyze", json={"conversation_id": cid, "message": "我需要提供哪些参数"}).json()
    required = {item["key"] for item in params["required_parameters"]}
    assert missing.issubset(required)
    assert len(params["required_parameters"]) >= len(missing)
