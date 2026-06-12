from __future__ import annotations

from typing import Any


class PowerTemplateBuilder:
    def build(self, model_code: str, data: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        if model_code == "economic_dispatch":
            return self._economic_dispatch(data)
        if model_code == "storage_dispatch":
            return self._storage_dispatch(data)
        if model_code == "renewable_storage_dispatch":
            return self._renewable_storage_dispatch(data)
        if model_code == "chp_dispatch":
            return self._chp_dispatch(data)
        raise RuntimeError(f"Unsupported power template: {model_code}")

    def _economic_dispatch(self, data: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        import pyomo.environ as pyo

        units, times = _sets(data, "unit")
        load = _series(data.get("load_forecast"), times, 100.0)
        p_min = _dict(data.get("unit_min_output"), units, 0.0)
        p_max = _dict(data.get("unit_max_output"), units, 100.0)
        cost = _dict(data.get("fuel_cost"), units, 300.0)
        ramp_up = _dict(data.get("ramp_up_limit"), units, 9999.0)
        ramp_down = _dict(data.get("ramp_down_limit"), units, 9999.0)
        initial = _dict(data.get("initial_unit_output"), units, 0.0)

        m = pyo.ConcreteModel(name="economic_dispatch")
        m.U = pyo.Set(initialize=units)
        m.T = pyo.RangeSet(0, len(times) - 1)
        m.unit_output = pyo.Var(m.U, m.T, within=pyo.NonNegativeReals)
        m.output_bounds = pyo.Constraint(m.U, m.T, rule=lambda model, u, t: pyo.inequality(p_min[u], model.unit_output[u, t], p_max[u]))
        m.power_balance = pyo.Constraint(m.T, rule=lambda model, t: sum(model.unit_output[u, t] for u in model.U) == load[times[t]])

        def ramp_up_rule(model: Any, u: str, t: int) -> Any:
            prev = initial[u] if t == 0 else model.unit_output[u, t - 1]
            return model.unit_output[u, t] - prev <= ramp_up[u]

        def ramp_down_rule(model: Any, u: str, t: int) -> Any:
            prev = initial[u] if t == 0 else model.unit_output[u, t - 1]
            return prev - model.unit_output[u, t] <= ramp_down[u]

        m.ramp_up_limit = pyo.Constraint(m.U, m.T, rule=ramp_up_rule)
        m.ramp_down_limit = pyo.Constraint(m.U, m.T, rule=ramp_down_rule)
        m.objective = pyo.Objective(expr=sum(m.unit_output[u, t] * cost[u] for u in m.U for t in m.T), sense=pyo.minimize)
        return m, {"model_code": "economic_dispatch", "units": units, "times": times, "load": load, "p_min": p_min, "p_max": p_max, "fuel_cost": cost}

    def _storage_dispatch(self, data: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        import pyomo.environ as pyo

        storage, times = _sets(data, "storage")
        price = _series(data.get("electricity_price"), times, 300.0)
        capacity = _dict(data.get("storage_capacity"), storage, 100.0)
        soc_min = _dict(data.get("soc_min"), storage, 0.0)
        charge_max = _dict(data.get("charge_power_max"), storage, 30.0)
        discharge_max = _dict(data.get("discharge_power_max"), storage, 30.0)
        charge_eff = _dict(data.get("charge_efficiency"), storage, 0.95)
        discharge_eff = _dict(data.get("discharge_efficiency"), storage, 0.95)
        initial_soc = _dict(data.get("initial_soc"), storage, 50.0)

        m = pyo.ConcreteModel(name="storage_dispatch")
        m.S = pyo.Set(initialize=storage)
        m.T = pyo.RangeSet(0, len(times) - 1)
        m.storage_charge = pyo.Var(m.S, m.T, within=pyo.NonNegativeReals)
        m.storage_discharge = pyo.Var(m.S, m.T, within=pyo.NonNegativeReals)
        m.storage_soc = pyo.Var(m.S, m.T, within=pyo.NonNegativeReals)
        m.charge_status = pyo.Var(m.S, m.T, within=pyo.Binary)
        m.discharge_status = pyo.Var(m.S, m.T, within=pyo.Binary)
        m.soc_bounds = pyo.Constraint(m.S, m.T, rule=lambda model, s, t: pyo.inequality(soc_min[s], model.storage_soc[s, t], capacity[s]))

        def soc_rule(model: Any, s: str, t: int) -> Any:
            prev = initial_soc[s] if t == 0 else model.storage_soc[s, t - 1]
            return model.storage_soc[s, t] == prev + model.storage_charge[s, t] * charge_eff[s] - model.storage_discharge[s, t] / discharge_eff[s]

        m.soc_balance = pyo.Constraint(m.S, m.T, rule=soc_rule)
        m.charge_discharge_exclusive = pyo.Constraint(m.S, m.T, rule=lambda model, s, t: model.charge_status[s, t] + model.discharge_status[s, t] <= 1)
        m.charge_power_bounds = pyo.Constraint(m.S, m.T, rule=lambda model, s, t: model.storage_charge[s, t] <= charge_max[s] * model.charge_status[s, t])
        m.discharge_power_bounds = pyo.Constraint(m.S, m.T, rule=lambda model, s, t: model.storage_discharge[s, t] <= discharge_max[s] * model.discharge_status[s, t])
        m.objective = pyo.Objective(expr=sum(price[times[t]] * (m.storage_discharge[s, t] - m.storage_charge[s, t]) for s in m.S for t in m.T), sense=pyo.maximize)
        return m, {"model_code": "storage_dispatch", "storage": storage, "times": times, "price": price, "capacity": capacity, "initial_soc": initial_soc}

    def _renewable_storage_dispatch(self, data: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        import pyomo.environ as pyo

        sites = list(data.get("site", ["PV1", "W1"]))
        storage, times = _sets(data, "storage")
        forecast = _site_series(data.get("renewable_forecast"), sites, times, 20.0)
        load = _series(data.get("load_forecast"), times, 80.0)
        price = _series(data.get("electricity_price"), times, 300.0)
        grid_limit = _series(data.get("grid_export_limit"), times, 9999.0)
        capacity = _dict(data.get("storage_capacity"), storage, 80.0)
        charge_max = _dict(data.get("charge_power_max"), storage, 30.0)
        discharge_max = _dict(data.get("discharge_power_max"), storage, 30.0)
        initial_soc = _dict(data.get("initial_soc"), storage, 30.0)
        curtail_penalty = float(data.get("curtailment_penalty", 1000.0))

        m = pyo.ConcreteModel(name="renewable_storage_dispatch")
        m.R = pyo.Set(initialize=sites)
        m.S = pyo.Set(initialize=storage)
        m.T = pyo.RangeSet(0, len(times) - 1)
        m.renewable_used = pyo.Var(m.R, m.T, within=pyo.NonNegativeReals)
        m.renewable_curtailment = pyo.Var(m.R, m.T, within=pyo.NonNegativeReals)
        m.storage_charge = pyo.Var(m.S, m.T, within=pyo.NonNegativeReals)
        m.storage_discharge = pyo.Var(m.S, m.T, within=pyo.NonNegativeReals)
        m.storage_soc = pyo.Var(m.S, m.T, bounds=lambda model, s, t: (0.0, capacity[s]))
        m.renewable_balance = pyo.Constraint(m.R, m.T, rule=lambda model, r, t: model.renewable_used[r, t] + model.renewable_curtailment[r, t] == forecast[r][times[t]])
        m.power_balance = pyo.Constraint(m.T, rule=lambda model, t: sum(model.renewable_used[r, t] for r in model.R) + sum(model.storage_discharge[s, t] for s in model.S) >= load[times[t]] + sum(model.storage_charge[s, t] for s in model.S))
        m.grid_export_limit = pyo.Constraint(m.T, rule=lambda model, t: sum(model.renewable_used[r, t] for r in model.R) + sum(model.storage_discharge[s, t] - model.storage_charge[s, t] for s in model.S) <= grid_limit[times[t]])

        def soc_rule(model: Any, s: str, t: int) -> Any:
            prev = initial_soc[s] if t == 0 else model.storage_soc[s, t - 1]
            return model.storage_soc[s, t] == prev + model.storage_charge[s, t] * 0.95 - model.storage_discharge[s, t] / 0.95

        m.storage_soc_balance = pyo.Constraint(m.S, m.T, rule=soc_rule)
        m.charge_limit = pyo.Constraint(m.S, m.T, rule=lambda model, s, t: model.storage_charge[s, t] <= charge_max[s])
        m.discharge_limit = pyo.Constraint(m.S, m.T, rule=lambda model, s, t: model.storage_discharge[s, t] <= discharge_max[s])
        revenue = sum(price[times[t]] * (sum(m.renewable_used[r, t] for r in m.R) + sum(m.storage_discharge[s, t] - m.storage_charge[s, t] for s in m.S)) for t in m.T)
        curtailment = sum(m.renewable_curtailment[r, t] for r in m.R for t in m.T)
        m.objective = pyo.Objective(expr=curtail_penalty * curtailment - revenue, sense=pyo.minimize)
        return m, {"model_code": "renewable_storage_dispatch", "sites": sites, "storage": storage, "times": times, "forecast": forecast, "load": load, "price": price}

    def _chp_dispatch(self, data: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        import pyomo.environ as pyo

        units, times = _sets(data, "unit")
        electric_load = _series(data.get("electric_load"), times, 80.0)
        heat_load = _series(data.get("heat_load"), times, 100.0)
        fuel_cost = _dict(data.get("fuel_cost"), units, 260.0)
        e_min = _dict(data.get("electric_min"), units, 0.0)
        e_max = _dict(data.get("electric_max"), units, 100.0)
        h_min = _dict(data.get("heat_min"), units, 0.0)
        h_max = _dict(data.get("heat_max"), units, 100.0)
        r_min = _dict(data.get("heat_to_power_ratio_min"), units, 0.5)
        r_max = _dict(data.get("heat_to_power_ratio_max"), units, 3.0)

        m = pyo.ConcreteModel(name="chp_dispatch")
        m.U = pyo.Set(initialize=units)
        m.T = pyo.RangeSet(0, len(times) - 1)
        m.electric_output = pyo.Var(m.U, m.T, within=pyo.NonNegativeReals)
        m.heat_output = pyo.Var(m.U, m.T, within=pyo.NonNegativeReals)
        m.electric_bounds = pyo.Constraint(m.U, m.T, rule=lambda model, u, t: pyo.inequality(e_min[u], model.electric_output[u, t], e_max[u]))
        m.heat_bounds = pyo.Constraint(m.U, m.T, rule=lambda model, u, t: pyo.inequality(h_min[u], model.heat_output[u, t], h_max[u]))
        m.electric_balance = pyo.Constraint(m.T, rule=lambda model, t: sum(model.electric_output[u, t] for u in model.U) == electric_load[times[t]])
        m.heat_balance = pyo.Constraint(m.T, rule=lambda model, t: sum(model.heat_output[u, t] for u in model.U) == heat_load[times[t]])
        m.coupling_min = pyo.Constraint(m.U, m.T, rule=lambda model, u, t: model.heat_output[u, t] >= r_min[u] * model.electric_output[u, t])
        m.coupling_max = pyo.Constraint(m.U, m.T, rule=lambda model, u, t: model.heat_output[u, t] <= r_max[u] * model.electric_output[u, t])
        m.objective = pyo.Objective(expr=sum(fuel_cost[u] * (m.electric_output[u, t] + 0.5 * m.heat_output[u, t]) for u in m.U for t in m.T), sense=pyo.minimize)
        return m, {"model_code": "chp_dispatch", "units": units, "times": times, "electric_load": electric_load, "heat_load": heat_load, "fuel_cost": fuel_cost}


def _sets(data: dict[str, Any], key: str) -> tuple[list[str], list[Any]]:
    items = list(data.get(key, data.get(f"{key}s", ["U1", "U2"])))
    horizon = int(data.get("horizon") or len(data.get("time", [])) or 4)
    times = list(data.get("time", list(range(horizon))))[:horizon] or list(range(horizon))
    return items, times


def _series(value: Any, times: list[Any], default: float) -> dict[Any, float]:
    if isinstance(value, list):
        return {t: float(value[i]) if i < len(value) else default for i, t in enumerate(times)}
    if isinstance(value, dict):
        return {t: float(value.get(str(t), value.get(t, default))) for t in times}
    return {t: default for t in times}


def _site_series(value: Any, sites: list[str], times: list[Any], default: float) -> dict[str, dict[Any, float]]:
    result: dict[str, dict[Any, float]] = {}
    for site in sites:
        site_value = value.get(site, value.get(str(site), [])) if isinstance(value, dict) else []
        result[site] = _series(site_value, times, default)
    return result


def _dict(value: Any, keys: list[str], default: float) -> dict[str, float]:
    if isinstance(value, dict):
        return {key: float(value.get(key, value.get(str(key), default))) for key in keys}
    return {key: default for key in keys}
