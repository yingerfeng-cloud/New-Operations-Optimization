from __future__ import annotations

from copy import deepcopy
from typing import Any, Mapping


COMPONENT_DRAFT_STATUS = "draft"
COMPONENT_PUBLISHED_STATUS = "published"
COMPONENT_OFFLINE_STATUS = "offline"
COMPONENT_LIFECYCLE_STATUSES = {
    COMPONENT_DRAFT_STATUS,
    COMPONENT_PUBLISHED_STATUS,
    COMPONENT_OFFLINE_STATUS,
}


def component_lifecycle_status(component: Mapping[str, Any]) -> str:
    """Return the canonical asset lifecycle status, including legacy migration rules."""
    raw = str(component.get("status") or COMPONENT_DRAFT_STATUS).strip().lower()
    legacy_enabled = component.get("enabled") if "enabled" in component else None
    if legacy_enabled is False and raw in {"published", "trial", "tested"}:
        return COMPONENT_OFFLINE_STATUS
    if raw in {"published", "trial", "tested"}:
        return COMPONENT_PUBLISHED_STATUS
    if raw in {"offline", "disabled", "inactive"}:
        return COMPONENT_OFFLINE_STATUS
    return COMPONENT_DRAFT_STATUS


def normalize_component_asset_lifecycle(component: Mapping[str, Any]) -> dict[str, Any]:
    """Remove retired asset flags and normalize old lifecycle values."""
    normalized = deepcopy(dict(component))
    normalized["status"] = component_lifecycle_status(component)
    normalized.pop("enabled", None)
    normalized.pop("implemented", None)
    return normalized
