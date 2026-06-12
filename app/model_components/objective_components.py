from __future__ import annotations

from typing import Any

from app.model_components.formula_components import _eval_formula_node


DEFAULT_OBJECTIVE_WEIGHTS = {
    "load_deviation": 1000.0,
    "spill": 1.0,
    "ramp": 0.1,
    "terminal_volume": 500.0,
    "investment": 1.0,
    "curtailment": 100.0,
    "deviation": 1000.0,
    "deviation_penalty_cost": 1.0,
    "storage_cycle": 1.0,
    "battery_degradation": 1.0,
    "energy_revenue": 1.0,
    "terminal_soc": 100.0,
    "piecewise_cost": 1.0,
}

SUPPORTED_OBJECTIVE_WEIGHT_KEYS = set(DEFAULT_OBJECTIVE_WEIGHTS)


def build_weighted_objective(model: Any, objective_spec: dict[str, Any], context: dict[str, Any]) -> None:
    import pyomo.environ as pyo

    params = context["runtime_parameters"]
    weights = {
        **DEFAULT_OBJECTIVE_WEIGHTS,
        **(objective_spec.get("weights") or {}),
    }
    configured_terms = objective_spec.get("terms") or []
    if configured_terms:
        unsupported_terms = [
            str(term.get("term_id") or term.get("name") or term.get("weight_key") or "")
            for term in configured_terms
            if term.get("enabled", True)
            and term.get("solve_participation", "solve") not in {"display_only", "remark_only", "none"}
            and str(term.get("weight_key") or "") not in SUPPORTED_OBJECTIVE_WEIGHT_KEYS
            and term.get("supported_by_backend") is not True
        ]
        if unsupported_terms:
            raise RuntimeError(f"目标函数项暂不支持参与后端求解：{', '.join(unsupported_terms)}。当前仅支持已实现组件目标项：{', '.join(sorted(SUPPORTED_OBJECTIVE_WEIGHT_KEYS))}；用户新增目标项请标注为 display_only 或先禁用。")
        enabled_weight_keys = {
            str(term.get("weight_key"))
            for term in configured_terms
            if term.get("enabled", True)
            and term.get("solve_participation", "solve") not in {"display_only", "remark_only", "none"}
        }
        for term in configured_terms:
            key = str(term.get("weight_key") or "")
            if key and term.get("weight") is not None:
                weights[key] = float(term["weight"])
        weights.update(params.get("weights") or {})
    else:
        enabled_weight_keys = set(DEFAULT_OBJECTIVE_WEIGHTS.keys())
        weights.update(params.get("weights") or {})
    stations = context["sets"].get("station", [])
    times = context["sets"].get("time", [])
    delta_t = float(params.get("delta_t", 1.0))

    expr = 0
    if "load_deviation" in enabled_weight_keys and hasattr(model, "load_dev_pos") and hasattr(model, "load_dev_neg"):
        expr += float(weights["load_deviation"]) * sum(model.load_dev_pos[t] + model.load_dev_neg[t] for t in times)
    if "spill" in enabled_weight_keys and hasattr(model, "q_spill"):
        expr += float(weights["spill"]) * sum(model.q_spill[station, t] for station in stations for t in times)
    if "ramp" in enabled_weight_keys and hasattr(model, "ramp_abs"):
        expr += float(weights["ramp"]) * sum(model.ramp_abs[station, t] for station in stations for t in times)
    if "terminal_volume" in enabled_weight_keys and hasattr(model, "terminal_dev_pos") and hasattr(model, "terminal_dev_neg"):
        expr += float(weights["terminal_volume"]) * sum(
            model.terminal_dev_pos[station] + model.terminal_dev_neg[station] for station in stations
        )
    if "investment" in enabled_weight_keys:
        capex_power = float(params.get("capex_power", 0.0))
        capex_energy = float(params.get("capex_energy", 0.0))
        if hasattr(model, "storage_power_capacity"):
            expr += float(weights["investment"]) * capex_power * model.storage_power_capacity
        if hasattr(model, "storage_energy_capacity"):
            expr += float(weights["investment"]) * capex_energy * model.storage_energy_capacity
    if "curtailment" in enabled_weight_keys and hasattr(model, "p_pv_curtail"):
        penalty = float(params.get("curtailment_penalty", weights["curtailment"]))
        expr += float(weights["curtailment"]) * penalty * delta_t * sum(model.p_pv_curtail[t] for t in times)
    if "deviation" in enabled_weight_keys and hasattr(model, "deviation_pos") and hasattr(model, "deviation_neg"):
        expr += float(weights["deviation"]) * delta_t * sum(model.deviation_pos[t] + model.deviation_neg[t] for t in times)
    if "deviation_penalty_cost" in enabled_weight_keys and hasattr(model, "deviation_penalty"):
        penalty_price = float(params.get("deviation_penalty_price", 1.0))
        expr += float(weights["deviation_penalty_cost"]) * penalty_price * delta_t * sum(model.deviation_penalty[t] for t in times)
    if "storage_cycle" in enabled_weight_keys:
        cycle_cost = float(params.get("storage_cycle_cost", 1.0))
        term = 0
        if hasattr(model, "p_ch"):
            term += sum(model.p_ch[t] for t in times)
        if hasattr(model, "p_dis"):
            term += sum(model.p_dis[t] for t in times)
        expr += float(weights["storage_cycle"]) * cycle_cost * delta_t * term
    if "battery_degradation" in enabled_weight_keys:
        degradation_cost = _first_number(params, ["degradation_cost_yuan_per_mwh", "degradation_cost", "storage_cycle_cost"], 0.0)
        term = 0
        if hasattr(model, "p_ch"):
            term += sum(model.p_ch[t] for t in times)
        if hasattr(model, "p_dis"):
            term += sum(model.p_dis[t] for t in times)
        expr += float(weights["battery_degradation"]) * degradation_cost * delta_t * term
    if "energy_revenue" in enabled_weight_keys and hasattr(model, "p_grid"):
        price = _series(params.get("price", params.get("electricity_price")), times, 0.0)
        expr -= float(weights["energy_revenue"]) * delta_t * sum(float(price[t]) * model.p_grid[t] for t in times)
    if "terminal_soc" in enabled_weight_keys and hasattr(model, "terminal_soc_dev_pos") and hasattr(model, "terminal_soc_dev_neg"):
        expr += float(weights["terminal_soc"]) * (model.terminal_soc_dev_pos + model.terminal_soc_dev_neg)
    expr += _build_dynamic_objective_terms(model, configured_terms, weights, context)

    sense = pyo.maximize if str(objective_spec.get("sense", "minimize")).lower() == "maximize" else pyo.minimize
    model.objective = pyo.Objective(expr=expr, sense=sense)
    context["metadata"]["objective_weights"] = weights


def _build_dynamic_objective_terms(model: Any, terms: list[dict[str, Any]], weights: dict[str, float], context: dict[str, Any]) -> Any:
    import ast

    expr = 0
    for term in terms:
        if term.get("enabled", True) is False:
            continue
        if term.get("solve_participation", "solve") in {"display_only", "remark_only", "none"}:
            continue
        key = str(term.get("weight_key") or "")
        if key in SUPPORTED_OBJECTIVE_WEIGHT_KEYS and key != "piecewise_cost":
            continue
        if term.get("supported_by_backend") is not True:
            continue
        expression = str(term.get("expression") or "").strip()
        if not expression:
            continue
        try:
            body = ast.parse(expression, mode="eval").body
            expr += float(weights.get(key, term.get("weight", 1.0) or 1.0)) * _eval_formula_node(body, model, context, {})
        except Exception as exc:
            raise RuntimeError(f"目标项 {term.get('term_id') or key or term.get('name')} 无法编译为 Pyomo Objective：{exc}") from exc
    return expr


def _series(raw: Any, times: list[Any], default: float) -> dict[Any, float]:
    if isinstance(raw, dict):
        return {t: float(raw.get(t, raw.get(str(t), default))) for t in times}
    if isinstance(raw, list):
        return {t: float(raw[i]) if i < len(raw) else float(default) for i, t in enumerate(times)}
    return {t: float(default if raw is None else raw) for t in times}


def _first_number(params: dict[str, Any], keys: list[str], default: float) -> float:
    for key in keys:
        value = params.get(key)
        if value is not None:
            return float(value)
    return float(default)
