from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from app.services.model_service import model_service
from app.services.template_service import template_library
from app.storage.memory_store import STORE
from app.templates.power_templates import get_power_templates


MARKET_TRADING_TEMPLATES = ["contract_spot_exposure_v1", "retail_da_spot_bidding_v1"]


def test_market_trading_templates_registered() -> None:
    templates = get_power_templates()

    assert set(MARKET_TRADING_TEMPLATES) <= set(templates)
    assert templates["contract_spot_exposure_v1"]["problem_type"] == "LP"
    assert templates["retail_da_spot_bidding_v1"]["problem_type"] == "MILP"
    for code in MARKET_TRADING_TEMPLATES:
        template = templates[code]
        assert template["solver"] == "HiGHS"
        assert template["build_mode"] == "component_based"
        assert template["component_spec"]["build_mode"] == "component_based"
        assert template["component_spec"]["components"][0]["definition"]["generated_constraints"]
        assert template["component_spec"]["objective"]["terms"][0]["supported_by_backend"] is True
        assert template["component_spec"]["output_contract"]
        assert template["component_spec"]["metrics_config"]
        assert template["component_spec"]["explanation_config"]
        assert template["sample_runtime_parameters"]
        assert template["ui_metadata"]["time_dimension"]["policy"] == "fixed"
        assert template["ui_metadata"]["time_dimension"]["default_horizon"] == 96
        assert template["ui_metadata"]["execution_policy"] == "advisory_only"
        assert template["ui_metadata"]["requires_human_review"] is True
        assert "不自动下单" in template["ui_metadata"]["capability_boundary"]


def test_market_trading_templates_clone_publish_and_test(client) -> None:
    for code in MARKET_TRADING_TEMPLATES:
        cloned = client.post(f"/api/templates/{code}/clone")
        assert cloned.status_code == 200, cloned.text
        model_id = cloned.json()["id"]

        published = client.post(f"/api/models/{model_id}/publish")
        assert published.status_code == 200, published.text

        tested = client.post(
            f"/api/models/{model_id}/test",
            json={"parameters": deepcopy(template_library.sample_runtime_parameters(code))},
        )
        assert tested.status_code == 200, tested.text
        assert tested.json()["dry_run_result"]["solver_check"]["status"] == "passed"


def test_market_trading_uses_generic_component_builder() -> None:
    root = Path(__file__).resolve().parents[1]
    assert not (root / "app" / "builders" / "market_trading_builder.py").exists()
    pyomo_builder = (root / "app" / "builders" / "pyomo_builder.py").read_text(encoding="utf-8")
    assert "MarketTradingBuilder" not in pyomo_builder


def test_market_trading_default_skills_are_enabled() -> None:
    model_service.seed_default_templates()
    with STORE.lock:
        skills = dict(STORE.skills)

    assert skills["run_contract_spot_exposure_v1"]["status"] == "enabled"
    assert skills["run_retail_da_spot_bidding_v1"]["status"] == "enabled"


def test_seed_default_templates_does_not_overwrite_user_edited_default_model() -> None:
    model_service.seed_default_templates()
    model_id = "MODEL-POWER-CONTRACT-SPOT-EXPOSURE-V1"
    edited_contract_total = 12345.678
    with STORE.lock:
        model = STORE.models[model_id]
        params = deepcopy(model.parameters)
        params["contract_total"] = edited_contract_total
        STORE.models[model_id] = model.model_copy(update={"parameters": params, "name": "用户编辑后的默认合约现货模型"})

    model_service.seed_default_templates()

    with STORE.lock:
        reseeded = STORE.models[model_id]
    assert reseeded.parameters["contract_total"] == edited_contract_total
    assert reseeded.name == "用户编辑后的默认合约现货模型"
