from __future__ import annotations

from copy import deepcopy

from app.api.system_config import DEFAULT_SYSTEM_CONFIG, _migrate_scenario_items, _normalize_scenario_items
from app.services.model_service import model_service
from app.templates.power_templates import power_template_library


def test_new_business_scenario_defaults_to_draft_and_preserves_metadata() -> None:
    rows = _normalize_scenario_items([
        {
            "code": "new_scenario",
            "label": "新场景",
            "description": "由用户定义的业务边界",
            "enabled": True,
            "sort_order": 10,
        }
    ])
    assert rows == [
        {
            "code": "new_scenario",
            "label": "新场景",
            "description": "由用户定义的业务边界",
            "status": "draft",
            "enabled": True,
            "sort_order": 10,
        }
    ]


def test_legacy_scenario_code_is_migrated_by_unique_label() -> None:
    defaults = deepcopy(DEFAULT_SYSTEM_CONFIG["dictionaries"]["business_scenarios"])
    migrated = _migrate_scenario_items(
        [{"code": "legacy-code\u200c", "label": "算电协同", "enabled": True, "sort_order": 90}],
        defaults,
    )
    assert migrated[0]["code"] == "compute_power_coordination"
    assert migrated[0]["status"] == "published"
    assert migrated[0]["description"]


def test_templates_and_managed_models_share_explicit_scenario_id() -> None:
    template = power_template_library()["compute_power_coordination_day_ahead_v1"]
    assert template["scenario_id"] == "compute_power_coordination"
    assert template["model_draft"]["basic_info"]["scenario_id"] == "compute_power_coordination"

    model_service.seed_default_templates()
    model = model_service.get_model("MODEL-POWER-COMPUTE-POWER-COORDINATION-DAY-AHEAD-V1")
    assert model.scenario_id == "compute_power_coordination"
    assert model.scene == "算电协同"
