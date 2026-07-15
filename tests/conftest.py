from __future__ import annotations

import os
import faulthandler
import sys
import tempfile
import threading
import uuid
import weakref
from copy import deepcopy
from pathlib import Path

import pytest
import fastapi.testclient
from fastapi import FastAPI
from fastapi.testclient import TestClient as _FastAPITestClient


_OPEN_TEST_CLIENTS: weakref.WeakSet[_FastAPITestClient] = weakref.WeakSet()
_BASE_STORE_SNAPSHOT: dict[str, object] | None = None
_BASE_REGISTRY_SNAPSHOT: dict[str, object] | None = None


class ManagedTestClient(_FastAPITestClient):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        _OPEN_TEST_CLIENTS.add(self)

    def close(self) -> None:
        try:
            super().close()
        finally:
            _OPEN_TEST_CLIENTS.discard(self)


fastapi.testclient.TestClient = ManagedTestClient
TestClient = ManagedTestClient


def _close_tracked_test_clients() -> None:
    seen: set[int] = set()
    for value in list(_OPEN_TEST_CLIENTS):
        if id(value) not in seen:
            seen.add(id(value))
            value.close()
    for module in list(sys.modules.values()):
        for value in vars(module).values() if module else []:
            if isinstance(value, TestClient) and id(value) not in seen:
                seen.add(id(value))
                value.close()


def _clear_fastapi_dependency_overrides() -> None:
    for module_name in ("app.main", "app.platform_main", "app.agent_main"):
        module = sys.modules.get(module_name)
        if not module:
            continue
        for value in vars(module).values():
            if isinstance(value, FastAPI):
                value.dependency_overrides.clear()


os.environ.setdefault(
    "RUNTIME_STORE_PATH",
    str(Path(tempfile.gettempdir()) / f"copt_runtime_store_pytest_{uuid.uuid4().hex}.json"),
)
os.environ.setdefault("LLM_ENABLED", "false")
os.environ.setdefault("AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK", "true")
os.environ.setdefault("COPT_SYNC_JOBS", "true")

try:
    faulthandler.enable()
except Exception:
    pass


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


@pytest.fixture(autouse=True)
def reset_runtime_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    global _BASE_STORE_SNAPSHOT, _BASE_REGISTRY_SNAPSHOT

    from app.storage.memory_store import STORE
    from app.model_components import registry as component_registry
    from app.services.model_service import model_service

    runtime_path = tmp_path / "runtime_store.json"
    original_path = STORE.persistence_path
    monkeypatch.setenv("RUNTIME_STORE_PATH", str(runtime_path))
    STORE._persistence_path = runtime_path
    required_default_components = {
        "pv_available_output",
        "storage_soc_balance",
        "pv_storage_power_balance",
        "grid_power_limit",
        "storage_capacity_decision",
        "schedule_tracking",
        "storage_terminal_soc_tracking",
    }
    with STORE.lock:
        needs_seed = not STORE.models or not required_default_components.issubset(STORE.custom_components)
    if needs_seed:
        model_service.seed_default_templates()

    store_keys = (
        "models",
        "assets",
        "tasks",
        "results",
        "invocations",
        "skills",
        "conversations",
        "llm_config",
        "template_status",
        "rolling_jobs",
        "custom_components",
        "function_assets",
        "model_versions",
        "active_model_versions",
    )
    registry_keys = (
        "COMPONENT_REGISTRY",
        "COMPONENT_DEPENDENCIES",
        "COMPONENT_OUTPUTS",
        "COMPONENT_CONSTRAINT_TYPES",
        "COMPONENT_INDICES",
        "SET_DEFINITIONS",
        "COMPONENT_OBJECTIVE_TERMS",
        "HYDRO_CONSTRAINT_OVERRIDES",
        "HYDRO_OBJECTIVE_TERM_OVERRIDES",
    )
    if _BASE_STORE_SNAPSHOT is None:
        with STORE.lock:
            _BASE_STORE_SNAPSHOT = {key: deepcopy(getattr(STORE, key)) for key in store_keys}
    if _BASE_REGISTRY_SNAPSHOT is None:
        _BASE_REGISTRY_SNAPSHOT = {key: deepcopy(getattr(component_registry, key)) for key in registry_keys}
    try:
        faulthandler.dump_traceback_later(180, repeat=False)
    except Exception:
        pass
    try:
        yield
    finally:
        _clear_fastapi_dependency_overrides()
        try:
            faulthandler.cancel_dump_traceback_later()
        except Exception:
            pass
        with STORE.lock:
            for task in list(STORE.tasks.values()):
                if getattr(task, "status", None) in {"PENDING", "VALIDATING", "BUILDING_MODEL", "SOLVING", "FORMATTING_RESULT"}:
                    task.status = "CANCELLED"
                    task.progress = 100
                    task.finished_at = getattr(task, "finished_at", None) or "pytest teardown"
                    task.error = "cancelled by pytest fixture teardown"
            for key, value in _BASE_STORE_SNAPSHOT.items():
                target = getattr(STORE, key)
                if isinstance(target, dict):
                    target.clear()
                    target.update(deepcopy(value))
                else:
                    setattr(STORE, key, deepcopy(value))
            STORE._persistence_path = original_path
            STORE.scheduler = threading.Semaphore(4)
        for key, value in _BASE_REGISTRY_SNAPSHOT.items():
            target = getattr(component_registry, key)
            if isinstance(target, dict):
                target.clear()
                target.update(deepcopy(value))
            elif isinstance(target, list):
                target[:] = deepcopy(value)
            else:
                setattr(component_registry, key, deepcopy(value))


@pytest.fixture
def runtime_store_path(tmp_path: Path) -> Path:
    return tmp_path / "runtime_store.json"


@pytest.fixture
def client():
    from app.main import app

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    _clear_fastapi_dependency_overrides()
    _close_tracked_test_clients()
    active = [
        thread
        for thread in threading.enumerate()
        if thread is not threading.main_thread() and not thread.daemon and thread.is_alive()
    ]
    if active:
        print("PYTEST_ACTIVE_NON_DAEMON_THREADS:")
        for thread in active:
            print(f"- name={thread.name!r} ident={thread.ident} native_id={getattr(thread, 'native_id', None)}")
