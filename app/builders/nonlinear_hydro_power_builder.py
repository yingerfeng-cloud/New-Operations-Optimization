from __future__ import annotations

from typing import Any

import pyomo.environ as pyo


class NonlinearHydroPowerDemoBuilder:
    """Small continuous NLP demo: power[t] = k * flow[t] * head[t]."""

    def build(self, model_template: dict[str, Any], runtime_parameters: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        time = list(runtime_parameters.get("time") or range(int(runtime_parameters.get("horizon", 3))))
        if not time:
            time = [0]
        k = float(runtime_parameters.get("k", 0.9))
        flow_min = float(runtime_parameters.get("flow_min", 10.0))
        flow_max = float(runtime_parameters.get("flow_max", 100.0))
        head_min = float(runtime_parameters.get("head_min", 20.0))
        head_max = float(runtime_parameters.get("head_max", 80.0))
        power_max = float(runtime_parameters.get("power_max", 5000.0))

        model = pyo.ConcreteModel(name="nonlinear_hydro_power_demo")
        model.time = pyo.Set(initialize=time, ordered=True)
        model.flow = pyo.Var(model.time, bounds=(flow_min, flow_max), initialize=(flow_min + flow_max) / 2)
        model.head = pyo.Var(model.time, bounds=(head_min, head_max), initialize=(head_min + head_max) / 2)
        model.power = pyo.Var(model.time, bounds=(0, power_max), initialize=min(power_max, k * (flow_min + flow_max) * (head_min + head_max) / 4))

        def power_balance_rule(m: Any, t: Any) -> Any:
            return m.power[t] == k * m.flow[t] * m.head[t]

        def power_upper_rule(m: Any, t: Any) -> Any:
            return m.power[t] <= power_max

        model.power_balance = pyo.Constraint(model.time, rule=power_balance_rule)
        model.power_upper = pyo.Constraint(model.time, rule=power_upper_rule)
        model.objective = pyo.Objective(expr=sum(model.power[t] for t in model.time), sense=pyo.maximize)

        return model, {
            "model_code": "nonlinear_hydro_power_demo",
            "build_mode": "nlp_demo",
            "problem_type": "NLP",
            "local_optimum_warning": True,
        }
