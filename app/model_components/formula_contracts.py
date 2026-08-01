from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal


Participation = Literal["solve_active", "preview_only", "disabled"]

SOLVE_ACTIVE = "solve_active"
PREVIEW_ONLY = "preview_only"
DISABLED = "disabled"

NON_SOLVE_PARTICIPATION_MODES = {
    PREVIEW_ONLY,
    DISABLED,
    "display_only",
    "remark_only",
    "none",
}

_PARTICIPATION_ALIASES: dict[str, Participation] = {
    SOLVE_ACTIVE: SOLVE_ACTIVE,
    "solve": SOLVE_ACTIVE,
    "active": SOLVE_ACTIVE,
    "generated": SOLVE_ACTIVE,
    "template_builder": SOLVE_ACTIVE,
    PREVIEW_ONLY: PREVIEW_ONLY,
    "display_only": PREVIEW_ONLY,
    "remark_only": PREVIEW_ONLY,
    DISABLED: DISABLED,
    "none": DISABLED,
    "inactive": DISABLED,
    "off": DISABLED,
}


def normalize_participation(
    item_or_value: dict[str, Any] | str | None,
    *,
    default: Participation = SOLVE_ACTIVE,
) -> Participation:
    """Return the canonical participation state and fail closed on unknown values."""

    if isinstance(item_or_value, dict):
        item = item_or_value
        raw = item.get("solve_participation") or item.get("participation")
        if raw is None or str(raw).strip() == "":
            if item.get("enabled") is False:
                return DISABLED
            if item.get("participates_in_solve") is False:
                return PREVIEW_ONLY
            raw = default
        normalized = _PARTICIPATION_ALIASES.get(str(raw).strip().lower(), PREVIEW_ONLY)
        if normalized == SOLVE_ACTIVE and item.get("enabled") is False:
            return DISABLED
        if normalized == SOLVE_ACTIVE and item.get("participates_in_solve") is False:
            return PREVIEW_ONLY
        return normalized

    raw = default if item_or_value is None or str(item_or_value).strip() == "" else str(item_or_value)
    return _PARTICIPATION_ALIASES.get(raw.strip().lower(), PREVIEW_ONLY)


def participates_in_solve(item: dict[str, Any] | str | None, *, default: Participation = SOLVE_ACTIVE) -> bool:
    return normalize_participation(item, default=default) == SOLVE_ACTIVE


def participation_fields(
    item_or_value: dict[str, Any] | str | None,
    *,
    default: Participation = SOLVE_ACTIVE,
) -> dict[str, Any]:
    participation = normalize_participation(item_or_value, default=default)
    return {
        "solve_participation": participation,
        "participates_in_solve": participation == SOLVE_ACTIVE,
        "enabled": participation != DISABLED,
    }


def formula_expression(item: dict[str, Any] | None) -> str:
    if not item:
        return ""
    return str(item.get("dsl_formula") or item.get("formula") or item.get("expression") or "").strip()


def synchronize_formula_fields(item: dict[str, Any], expression: str | None = None) -> dict[str, Any]:
    normalized = deepcopy(item)
    value = formula_expression(item) if expression is None else str(expression).strip()
    normalized.update({"dsl_formula": value, "formula": value, "expression": value})
    return normalized
