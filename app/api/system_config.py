from __future__ import annotations

from copy import deepcopy
from typing import Any

from fastapi import APIRouter, HTTPException

from app.business_scenarios import SCENARIO_STATUSES, public_business_scenarios
from app.storage.memory_store import STORE
from app.utils import now_text

router = APIRouter(prefix="/api/system-config", tags=["system-config"])


DEFAULT_SYSTEM_CONFIG: dict[str, Any] = {
    "dictionaries": {
        "business_scenarios": public_business_scenarios(),
        "component_domains": [
            {"code": "general_or", "label": "通用运筹优化", "enabled": True, "sort_order": 10},
            {"code": "general_modeling", "label": "通用建模", "enabled": True, "sort_order": 20},
            {"code": "hydro_dispatch", "label": "水电调度", "enabled": True, "sort_order": 30},
            {"code": "cascade_hydro_dispatch", "label": "梯级水电调度", "enabled": True, "sort_order": 40},
            {"code": "pv_storage", "label": "光储一体化", "enabled": True, "sort_order": 50},
        ],
        "component_categories": [
            {"code": "generic_modeling", "label": "通用建模组件", "parent_code": "general_or", "enabled": True, "sort_order": 10},
            {"code": "basic_component", "label": "基础组件", "parent_code": "general_modeling", "enabled": True, "sort_order": 20},
            {"code": "hydro_dispatch", "label": "水电调度组件", "parent_code": "hydro_dispatch", "enabled": True, "sort_order": 30},
            {"code": "cascade_hydro", "label": "梯级水电组件", "parent_code": "cascade_hydro_dispatch", "enabled": True, "sort_order": 40},
            {"code": "storage", "label": "储能组件", "parent_code": "pv_storage", "enabled": True, "sort_order": 50},
            {"code": "storage_operation", "label": "储能运行组件", "parent_code": "pv_storage", "enabled": True, "sort_order": 60},
            {"code": "pv", "label": "光伏组件", "parent_code": "pv_storage", "enabled": True, "sort_order": 70},
            {"code": "grid_plan", "label": "并网/计划组件", "parent_code": "pv_storage", "enabled": True, "sort_order": 80},
            {"code": "capacity_planning", "label": "容量配置组件", "parent_code": "pv_storage", "enabled": True, "sort_order": 90},
            {"code": "deviation_market", "label": "计划偏差/市场考核", "parent_code": "pv_storage", "enabled": True, "sort_order": 100},
            {"code": "reserved_extension", "label": "预留扩展", "parent_code": "general_modeling", "enabled": True, "sort_order": 110},
        ],
    },
}


@router.get("")
def get_system_config() -> dict[str, Any]:
    config = _merged_config()
    with STORE.lock:
        if (
            STORE.system_config.get("dictionaries") != config.get("dictionaries")
            or STORE.system_config.get("version") != config.get("version")
        ):
            STORE.system_config.clear()
            STORE.system_config.update(config)
            STORE.save_runtime()
    return config


@router.put("")
def update_system_config(payload: dict[str, Any]) -> dict[str, Any]:
    current = _merged_config()
    if "dictionaries" in payload:
        current["dictionaries"] = _merge_dictionaries(payload.get("dictionaries") or {}, migrate_scenarios=False)
    current["updated_at"] = now_text()
    with STORE.lock:
        STORE.system_config.clear()
        STORE.system_config.update(current)
        STORE.save_runtime()
    return _merged_config()


@router.put("/dictionaries")
def update_dictionaries(payload: dict[str, Any]) -> dict[str, Any]:
    current = _merged_config()
    dictionaries = payload.get("dictionaries") if "dictionaries" in payload else payload
    current["dictionaries"] = _merge_dictionaries(dictionaries or {}, migrate_scenarios=False)
    current["updated_at"] = now_text()
    with STORE.lock:
        STORE.system_config.clear()
        STORE.system_config.update(current)
        STORE.save_runtime()
    return current["dictionaries"]


@router.post("/reset")
def reset_system_config() -> dict[str, Any]:
    config = _with_metadata(deepcopy(DEFAULT_SYSTEM_CONFIG))
    with STORE.lock:
        STORE.system_config.clear()
        STORE.system_config.update(config)
        STORE.save_runtime()
    return _merged_config()


def _merged_config() -> dict[str, Any]:
    config = _with_metadata(deepcopy(DEFAULT_SYSTEM_CONFIG))
    with STORE.lock:
        saved = deepcopy(STORE.system_config)
    saved_dictionaries = saved.get("dictionaries") if isinstance(saved.get("dictionaries"), dict) else {}
    if saved_dictionaries:
        config["dictionaries"] = _merge_dictionaries(
            saved_dictionaries,
            migrate_scenarios=str(saved.get("version") or "1.0") != "2.0",
        )
    for key, value in saved.items():
        if key not in {"dictionaries", "version"}:
            config[key] = value
    config["version"] = "2.0"
    return config


def _with_metadata(config: dict[str, Any]) -> dict[str, Any]:
    config.setdefault("version", "2.0")
    config.setdefault("updated_at", None)
    return config


def _normalize_dictionaries(value: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail="dictionaries must be an object")
    return {
        "business_scenarios": _normalize_scenario_items(value.get("business_scenarios") or []),
        "component_domains": _normalize_items(value.get("component_domains") or []),
        "component_categories": _normalize_items(value.get("component_categories") or [], with_parent=True),
    }


def _merge_dictionaries(saved: dict[str, Any], *, migrate_scenarios: bool = False) -> dict[str, list[dict[str, Any]]]:
    defaults = deepcopy(DEFAULT_SYSTEM_CONFIG["dictionaries"])
    merged: dict[str, Any] = {}
    for key, default_items in defaults.items():
        saved_items = saved.get(key)
        if key == "business_scenarios" and migrate_scenarios and isinstance(saved_items, list):
            saved_items = _migrate_scenario_items(saved_items, default_items)
        merged[key] = saved_items if isinstance(saved_items, list) and saved_items else default_items
    return _normalize_dictionaries(merged)


def _normalize_scenario_items(items: list[Any]) -> list[dict[str, Any]]:
    normalized = _normalize_items(items)
    source_by_code = {str(item.get("code") or "").strip(): item for item in items if isinstance(item, dict)}
    for row in normalized:
        source = source_by_code[row["code"]]
        status = str(source.get("status") or "draft").strip().lower()
        if status not in SCENARIO_STATUSES:
            raise HTTPException(status_code=422, detail=f"invalid business scenario status: {status}")
        row["description"] = str(source.get("description") or "").strip()
        row["status"] = status
    return normalized


def _migrate_scenario_items(saved_items: list[Any], default_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Upgrade pre-v2 rows by identity, falling back to a unique normalized label.

    Label matching is intentionally generic: it repairs renamed/invalid legacy codes
    without introducing a scenario-specific branch.
    """
    defaults_by_code = {str(item["code"]): item for item in default_items}
    defaults_by_label: dict[str, list[dict[str, Any]]] = {}
    for item in default_items:
        defaults_by_label.setdefault(_normalized_label(item.get("label")), []).append(item)
    migrated: list[dict[str, Any]] = []
    represented_defaults: set[str] = set()
    for item in saved_items:
        if not isinstance(item, dict):
            migrated.append(item)
            continue
        source = deepcopy(item)
        matched = defaults_by_code.get(str(source.get("code") or "").strip())
        if matched is None:
            label_matches = defaults_by_label.get(_normalized_label(source.get("label")), [])
            matched = label_matches[0] if len(label_matches) == 1 else None
        if matched:
            represented_defaults.add(str(matched["code"]))
            source["code"] = matched["code"]
            source.setdefault("label", matched["label"])
            source.setdefault("description", matched.get("description", ""))
            source.setdefault("status", matched.get("status", "draft"))
        else:
            source.setdefault("description", "")
            source.setdefault("status", "draft")
        migrated.append(source)
    for item in default_items:
        if str(item["code"]) not in represented_defaults:
            migrated.append(deepcopy(item))
    return migrated


def _normalized_label(value: Any) -> str:
    return "".join(str(value or "").split()).casefold()


def _normalize_items(items: list[Any], *, with_parent: bool = False) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        raise HTTPException(status_code=422, detail="dictionary items must be arrays")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="dictionary item must be an object")
        code = str(item.get("code") or "").strip()
        label = str(item.get("label") or "").strip()
        if not code or not label:
            raise HTTPException(status_code=422, detail="dictionary item code and label are required")
        if code in seen:
            raise HTTPException(status_code=422, detail=f"duplicate dictionary code: {code}")
        seen.add(code)
        row = {
            "code": code,
            "label": label,
            "enabled": item.get("enabled", True) is not False,
            "sort_order": int(item.get("sort_order", (index + 1) * 10) or 0),
        }
        if with_parent:
            row["parent_code"] = str(item.get("parent_code") or "").strip()
        normalized.append(row)
    return sorted(normalized, key=lambda row: (row["sort_order"], row["label"]))
