from __future__ import annotations

import importlib
import json
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent.parameter_extractor import parameter_extractor
from app.agent.skill_router import agent_skill_router
from app.main import app
from app.services.agent_skill_service import agent_skill_service
from app.services.invocation_service import invocation_service
from app.services.llm_service import LLMService
from app.services.result_interpreter import result_interpreter
from app.utils import has_highspy, has_pyomo


client = TestClient(app)


def test_disabled_skill_run_returns_409_even_for_default_skill() -> None:
    disabled = client.post("/api/skills/run_economic_dispatch/disable")
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["skill_status"] == "disabled"

    response = client.post(
        "/api/skills/run_economic_dispatch/run",
        json={"parameters": {}, "options": {"use_sample_data": True, "mode": "sync", "explain": True}},
    )

    assert response.status_code == 409, response.text
    assert "not enabled" in response.text


@pytest.mark.skipif(not (has_pyomo() and has_highspy()), reason="pyomo/highspy are required")
def test_skill_stats_and_agent_status_remain_healthy_after_successful_run() -> None:
    enabled = client.post("/api/skills/run_economic_dispatch/enable")
    assert enabled.status_code == 200, enabled.text

    before = client.get("/api/skills/run_economic_dispatch")
    assert before.status_code == 200, before.text
    before_calls = int(before.json().get("calls24h") or 0)
    before_failed = int(before.json().get("failed24h") or 0)

    response = client.post(
        "/api/skills/run_economic_dispatch/run",
        json={"parameters": {}, "options": {"use_sample_data": True, "mode": "sync", "explain": True}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SUCCESS"

    detail = client.get("/api/skills/run_economic_dispatch")
    assert detail.status_code == 200, detail.text
    assert detail.json()["calls24h"] >= before_calls + 1
    assert detail.json()["failed24h"] == before_failed
    assert detail.json()["last_invoked_at"] == detail.json()["last_invocation_at"]

    skills = client.get("/api/skills")
    assert skills.status_code == 200, skills.text
    listed = [item for item in skills.json() if "run_economic_dispatch" in item.get("skill_aliases", [item["skill_name"]])]
    assert listed
    assert any(item.get("last_invoked_at") for item in listed)

    status = client.get("/api/agent/status")
    assert status.status_code == 200, status.text
    assert status.json()["platform"]["skill_registry_ok"] is True


def test_agent_skill_package_coverage_for_platform_skills() -> None:
    names = {item["name"] for item in agent_skill_service.list_skills()}
    assert {
        "cascade_hydro_dispatch_v1",
        "pv_storage_day_ahead_dispatch",
        "pv_storage_intraday_dispatch",
        "pv_storage_dispatch_v2",
        "pv_storage_day_ahead_dispatch_v2",
        "pv_storage_intraday_dispatch_v2",
        "nonlinear_hydro_power_demo",
        "contract_spot_exposure_v1",
        "retail_da_spot_bidding_v1",
    } <= names
    for name in names:
        root = Path("agent_skills") / name
        assert (root / "tests" / "sample_input.json").is_file()
        assert (root / "tests" / "missing_parameters.json").is_file()
        assert (root / "tests" / "expected_request.json").is_file()


def test_agent_router_prioritizes_market_and_pv_storage_phrases() -> None:
    skills = agent_skill_service.list_skills()
    assert agent_skill_router.route("做售电公司日前现货申报优化", {}, skills)["agent_skill_name"] == "retail_da_spot_bidding_v1"
    assert agent_skill_router.route("做合约现货暴露控制", {}, skills)["agent_skill_name"] == "contract_spot_exposure_v1"
    assert agent_skill_router.route("做光储日前调度", {}, skills)["agent_skill_name"] == "pv_storage_day_ahead_dispatch"
    route = agent_skill_router.route("日前", {}, skills)
    assert route["agent_skill_name"] != "unit_commitment_day_ahead"


@pytest.mark.parametrize(
    "message",
    [
        "做光储日内滚动调度",
        "做光储日内滚动优化",
        "做光储实时滚动调度",
        "做光储协同日内调度",
        "跑一个光储日内滚动调度",
    ],
)
def test_agent_router_recognizes_pv_storage_intraday_rolling_phrases(message: str) -> None:
    route = agent_skill_router.route(message, {}, agent_skill_service.list_skills())
    assert route["agent_skill_name"] in {"pv_storage_intraday_dispatch", "pv_storage_intraday_dispatch_v2"}
    assert route["api_skill_name"] in {"run_pv_storage_intraday_dispatch", "run_pv_storage_intraday_dispatch_v2"}


def test_storage_parameter_extraction_keeps_price_clean_and_updates_power_pair() -> None:
    schema = agent_skill_service.get_skill_local("storage_dispatch")["input_schema"]
    params = parameter_extractor.extract("电价 300 500，容量 200，充放电功率 50MW，初始 SOC 改成 0.4", schema)
    assert params["electricity_price"] == [300, 500]
    assert params["storage_capacity"] == 200
    assert params["charge_power_max"] == 50
    assert params["discharge_power_max"] == 50
    assert params["initial_soc"] == 0.4


def test_llm_key_is_not_written_plaintext_to_runtime_store(monkeypatch) -> None:
    store_path = Path(tempfile.gettempdir()) / f"runtime_store_no_plain_key_{uuid.uuid4().hex}.json"
    monkeypatch.setenv("RUNTIME_STORE_PATH", str(store_path))
    import app.storage.memory_store as memory_store

    reloaded_store = importlib.reload(memory_store)
    monkeypatch.setattr("app.services.llm_service.STORE", reloaded_store.STORE)
    secret = "sk-test-secret-value"
    service = LLMService()
    saved = service.update_config({"provider": "openai_compatible", "base_url": "https://llm.example/v1", "model": "m", "enabled": True, "api_key": secret})
    assert saved["api_key_configured"] is True

    text = store_path.read_text(encoding="utf-8")
    assert secret not in text
    assert '"api_key"' not in text
    assert "key_ciphertext" in text

    reloaded_store = importlib.reload(memory_store)
    monkeypatch.setattr("app.services.llm_service.STORE", reloaded_store.STORE)
    assert LLMService().config()["api_key_configured"] is True


def test_failed_nlp_explanation_does_not_claim_solved_when_ipopt_missing() -> None:
    explanation = result_interpreter.interpret(
        {"model_code": "nonlinear_hydro_power_demo"},
        {"status": "FAILED", "error": "Ipopt executable not found. NLP solving is unavailable."},
    )["explanation"]
    assert "已完成求解" not in explanation
    assert "Ipopt 求解器不可用" in explanation


def test_failed_nlp_explanation_uses_raw_solver_route_error_for_ipopt_unavailable() -> None:
    explanation = result_interpreter.interpret(
        {"model_code": "nonlinear_hydro_power_demo"},
        {
            "status": "FAILED",
            "raw_result": {
                "solver_route_error": {
                    "error_code": "SOLVER_UNAVAILABLE",
                    "recommended_solver": "Ipopt",
                }
            },
        },
    )["explanation"]
    assert "已完成求解" not in explanation
    assert "Ipopt 求解器不可用" in explanation


def test_failed_skill_response_includes_top_level_ipopt_unavailable_explanation() -> None:
    response = invocation_service._failed_response(
        "INV-TEST",
        "MODEL-POWER-NONLINEAR-HYDRO-POWER-DEMO",
        "OPT-TEST",
        {
            "type": "failed",
            "message": "Ipopt executable not found. NLP solving is unavailable.",
            "details": [{"error_code": "SOLVER_UNAVAILABLE", "recommended_solver": "Ipopt"}],
        },
    )
    expected = "本次非线性水电模型未完成求解，原因是 NLP 求解器 Ipopt 不可用，平台未启用替代求解器。当前结果不是有效优化方案。请安装 Ipopt，或切换为线性化 / 分段线性近似模型后重试。"
    assert response["explanation"] == expected
    assert response["explanation_structured"]["summary"] == expected
