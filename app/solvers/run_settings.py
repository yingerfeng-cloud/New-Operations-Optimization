"""Validated run-time options, frozen in the submitted task request."""
import math

from fastapi import HTTPException
import pyomo.environ as pyo


def validate_run_settings(value: dict) -> dict:
    settings = dict(value)
    errors = []
    for key in ("time_limit", "nlp_tolerance", "tol", "acceptable_tol", "max_iter", "thread_num"):
        if key not in settings or settings[key] is None:
            continue
        item = settings[key]
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) or item <= 0 or key in {"max_iter", "thread_num"} and int(item) != item:
            errors.append({"field": f"solver_config.{key}", "error": "must be a positive finite number"})
    if "initial_values" in settings and not isinstance(settings["initial_values"], dict):
        errors.append({"field": "solver_config.initial_values", "error": "must be an object keyed by variable name"})
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    return settings


def apply_initial_values(model, settings: dict) -> None:
    for name, initial in (settings.get("initial_values") or {}).items():
        variable = model.find_component(name)
        if variable is None or variable.ctype is not pyo.Var:
            raise ValueError(f"初值变量 {name} 不存在")
        for index, item in variable.items():
            if isinstance(initial, dict):
                key = ",".join(map(str, index)) if isinstance(index, tuple) else str(index)
                if key not in initial:
                    raise ValueError(f"初值 {name}[{key}] 缺失")
                value = initial[key]
            else:
                value = initial
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"初值 {item.name} 必须为有限数值")
            if item.lb is not None and value < item.lb or item.ub is not None and value > item.ub:
                raise ValueError(f"初值 {item.name}={value} 超出变量边界 [{item.lb}, {item.ub}]")
            item.set_value(value)
