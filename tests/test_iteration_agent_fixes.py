from __future__ import annotations

import importlib
import tempfile
from pathlib import Path
import uuid
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.agent.platform_client import OptimizationPlatformClient
from app.main import app
from app.services.llm_service import LLMService
from app.storage.memory_store import STORE
from app.utils import has_highspy, has_pyomo
from tests.test_model_skill_invocation import minimal_dispatch_payload
from tests.test_helpers import test_and_publish_model


client = TestClient(app)


def test_llm_config_save_and_reload(monkeypatch) -> None:
    store_path = Path(tempfile.gettempdir()) / f"runtime_store_test_{uuid.uuid4().hex}.json"
    monkeypatch.setenv("RUNTIME_STORE_PATH", str(store_path))
    import app.storage.memory_store as memory_store

    reloaded_store = importlib.reload(memory_store)
    monkeypatch.setattr("app.services.llm_service.STORE", reloaded_store.STORE)
    service = LLMService()
    saved = service.update_config(
        {
            "provider": "openai_compatible",
            "base_url": "https://llm.example.test/v1",
            "model": "test-model",
            "enabled": True,
            "api_key": "secret-key",
        }
    )
    assert saved["api_key_configured"] is True
    assert "api_key" not in saved

    reloaded_store = importlib.reload(memory_store)
    monkeypatch.setattr("app.services.llm_service.STORE", reloaded_store.STORE)
    restored = LLMService().config()
    assert restored["provider"] == "openai_compatible"
    assert restored["model"] == "test-model"
    assert restored["api_key_configured"] is True
    assert "api_key" not in restored


def test_agent_overview_platform_unavailable(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK", "false")
    platform = OptimizationPlatformClient(base_url="http://127.0.0.1:1")
    with pytest.raises(Exception):
        platform.list_skills()


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_agent_multiturn_parameter_merge() -> None:
    payload = minimal_dispatch_payload()
    payload["id"] = f"MODEL-MULTI-{uuid.uuid4().hex[:8].upper()}"
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    model_id = created.json()["id"]
    test_and_publish_model(client, model_id)

    cid = f"CONV-MULTI-{uuid.uuid4().hex[:8].upper()}"
    first = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "帮我跑经济调度，三个时段负荷100、120、90。", "skill_name": "run_economic_dispatch"},
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["ready_to_invoke"] is False
    assert first_body["requires_default_confirmation"] is True
    assert first_body["parameter_draft"]["load_forecast"] == {"T1": 100, "T2": 120, "T3": 90}

    second = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "U1最大80成本10，U2最大100成本20。", "skill_name": "run_economic_dispatch"},
    )
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["ready_to_invoke"] is True, body
    assert body["parameter_draft"]["load_forecast"] == {"T1": 100, "T2": 120, "T3": 90}
    assert body["parameter_draft"]["unit_max_output"] == {"U1": 80, "U2": 100}
    assert body["parameter_draft"]["fuel_cost"] == {"U1": 10, "U2": 20}
    assert body["parameter_sources"]["load_forecast"] == "user_provided"

    invoked = client.post("/api/agent/confirm-invoke", json={"conversation_id": cid})
    assert invoked.status_code == 200, invoked.text
    result = invoked.json()
    assert result["status"] == "SUCCESS"
    assert float(result["result"]["objective_value"]) == pytest.approx(3800.0)


def test_agent_default_requires_confirmation() -> None:
    payload = minimal_dispatch_payload()
    payload["id"] = f"MODEL-DEFAULT-{uuid.uuid4().hex[:8].upper()}"
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    model_id = created.json()["id"]
    test_and_publish_model(client, model_id)

    cid = f"CONV-DEFAULT-{uuid.uuid4().hex[:8].upper()}"
    analyzed = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "帮我跑经济调度，三个时段负荷100、120、90。", "skill_name": "run_economic_dispatch"},
    )
    assert analyzed.status_code == 200, analyzed.text
    body = analyzed.json()
    assert body["ready_to_invoke"] is False
    assert body["requires_default_confirmation"] is True
    assert {item["key"] for item in body["can_use_default"]} >= {"unit_max_output", "fuel_cost"}


def test_template_model_offline_then_republish() -> None:
    models = client.get("/api/models")
    assert models.status_code == 200, models.text
    model = next(item for item in models.json() if item["id"] == "MODEL-POWER-ECONOMIC-DISPATCH")

    offline = client.post(f"/api/models/{model['id']}/offline")
    assert offline.status_code == 200, offline.text
    assert offline.json()["status"] == "offline"

    republished = test_and_publish_model(client, model["id"])
    assert republished.status_code == 200, republished.text
    assert republished.json()["status"] == "published"


def test_template_detail_can_be_posted_as_model_package() -> None:
    template = client.get("/api/templates/cascade_hydro_dispatch")
    assert template.status_code == 200, template.text
    payload = template.json()
    payload["name"] = f"{payload['name']}-direct-{uuid.uuid4().hex[:4]}"
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["template_id"] == "cascade_hydro_dispatch"
    assert isinstance(body["constraints"], dict)
    assert isinstance(body["parameters"], dict)


def test_unpublished_model_invoke_returns_409() -> None:
    payload = minimal_dispatch_payload()
    payload["id"] = f"MODEL-UNPUBLISHED-{uuid.uuid4().hex[:8].upper()}"
    payload["status"] = "developing"
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    invoked = client.post(f"/api/models/{created.json()['id']}/invoke", json={"parameters": {}})
    assert invoked.status_code == 409, invoked.text


def test_component_model_publish_rejects_all_display_only_objectives() -> None:
    template = client.get("/api/templates/cascade_hydro_dispatch").json()
    payload = deepcopy(template)
    unique_code = f"cascade_hydro_dispatch_display_only_{uuid.uuid4().hex[:6]}"
    payload["id"] = f"MODEL-FEAS-{uuid.uuid4().hex[:8].upper()}"
    payload["code"] = unique_code
    payload["model_code"] = unique_code
    payload["template_id"] = unique_code
    payload["status"] = "developing"
    payload["name"] = f"{template['name']}-display-only"
    payload["component_spec"]["model_code"] = unique_code
    for term in payload["component_spec"]["objective"]["terms"]:
        term["solve_participation"] = "display_only"
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    published = client.post(f"/api/models/{created.json()['id']}/publish")
    assert published.status_code == 422, published.text
    errors = published.json()["detail"]["errors"]
    assert any("display_only" in str(err) and "solve_active" in str(err) for err in errors)
    client.delete(f"/api/models/{created.json()['id']}")


def test_agent_analyze_auto_selects_skill_and_reuses_on_default_confirmation() -> None:
    cid = f"CONV-AUTO-{uuid.uuid4().hex[:8].upper()}"
    first = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "帮我跑经济调度，四个时段负荷100、120、90、110。"},
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["resolved_skill_name"].startswith("run_economic_dispatch")
    assert first_body["ready_to_invoke"] is False

    second = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "U1最大80成本10，U2最大100成本20，U3最大60成本30。"},
    )
    assert second.status_code == 200, second.text
    second_body = second.json()
    assert second_body["resolved_skill_name"].startswith("run_economic_dispatch")

    confirmed = client.post(
        "/api/agent/analyze",
        json={"conversation_id": cid, "message": "确认使用默认值", "confirm_defaults": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    confirmed_body = confirmed.json()
    assert confirmed_body["resolved_skill_name"] == second_body["resolved_skill_name"]
    assert confirmed_body["requires_default_confirmation"] is False
    assert confirmed_body["parameter_sources"]
