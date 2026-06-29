from __future__ import annotations

import os
import sys
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


os.environ.setdefault(
    "RUNTIME_STORE_PATH",
    str(Path(tempfile.gettempdir()) / f"copt_runtime_store_pytest_{uuid.uuid4().hex}.json"),
)
os.environ.setdefault("LLM_ENABLED", "false")
os.environ.setdefault("AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK", "true")
os.environ.setdefault("COPT_SYNC_JOBS", "true")


SLOW_TESTS = {
    "tests/test_agent_decoupling_fixes.py::test_agent_confirm_uses_resolved_skill_not_alias",
    "tests/test_agent_decoupling_fixes.py::test_platform_client_no_fallback_in_production",
    "tests/test_agent_llm_flow.py::TestAgentLLMFlow::test_agent_analyze_confirm_and_explain_economic_dispatch",
    "tests/test_agent_production_fixes.py::test_agent_default_confirmation_message_saved",
    "tests/test_agent_production_fixes.py::test_chat_history_persisted_after_refresh",
    "tests/test_agent_production_fixes.py::test_agent_manual_skill_selection_effective",
    "tests/test_agent_production_fixes.py::test_agent_multiturn_economic_dispatch_success",
    "tests/test_agent_latency_llm_persistence.py::test_confirm_defaults_with_missing_required_stays_collecting",
    "tests/test_agent_latency_llm_persistence.py::test_llm_extract_timeout_fallback",
    "tests/test_agent_product_iteration.py::test_agent_economic_dispatch_from_console_flow",
    "tests/test_agent_skill_package.py::test_economic_dispatch_agent_skill_full_flow",
    "tests/test_agent_state_machine_iteration.py::test_default_values_require_explicit_confirmation",
    "tests/test_agent_state_machine_iteration.py::test_parameter_example_after_completed_task",
    "tests/test_agent_state_machine_iteration.py::test_parameter_example_does_not_trigger_ready_to_invoke",
    "tests/test_skill_production_hardening.py::test_agent_confirm_invoke_passes_confirmed_parameters",
    "tests/test_iteration_agent_fixes.py::test_agent_analyze_auto_selects_skill_and_reuses_on_default_confirmation",
    "tests/test_iteration_agent_fixes.py::test_agent_default_requires_confirmation",
    "tests/test_iteration_agent_fixes.py::test_agent_multiturn_parameter_merge",
    "tests/test_iteration_agent_fixes.py::test_agent_overview_platform_unavailable",
    "tests/test_production_delivery_iteration.py::test_agent_platform_unavailable_optimization_request_returns_platform_error",
    "tests/test_pv_storage_custom_components.py::test_pv_storage_v2_components_validate",
    "tests/test_pv_storage_objectives.py::test_pv_storage_capacity_can_create_publish_invoke_from_template",
    "tests/test_pv_storage_objectives.py::test_pv_storage_capacity_changes_with_capex_and_curtailment_penalty",
    "tests/test_pv_storage_objectives.py::test_pv_storage_capacity_objective_value_changes_with_capex_or_curtailment_penalty",
    "tests/test_pv_storage_objectives.py::test_pv_storage_capacity_template_sample_invokes_successfully",
    "tests/test_pv_storage_objectives.py::test_pv_storage_day_ahead_and_intraday_templates_are_separate",
    "tests/test_pv_storage_objectives.py::test_pv_storage_day_ahead_runtime_weights_override_term_weights",
    "tests/test_pv_storage_objectives.py::test_pv_storage_dispatch_uses_price_or_cost_terms",
    "tests/test_pv_storage_objectives.py::test_pv_storage_not_all_objective_terms_are_display_only",
    "tests/test_pv_storage_sizing_compare_lite.py::test_pv_storage_sizing_compare_lite_adjusts_small_capacity_soc",
}


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    slow = pytest.mark.slow
    for item in items:
        if item.nodeid in SLOW_TESTS:
            item.add_marker(slow)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    seen: set[int] = set()
    for module in list(sys.modules.values()):
        for value in vars(module).values() if module else []:
            if isinstance(value, TestClient) and id(value) not in seen:
                seen.add(id(value))
                value.close()
