from __future__ import annotations

import time
from typing import Any

from app.schemas.result import SolverRunResult


class HiGHSAdapter:
    name = "HiGHS"
    supported_problem_types = ["LP", "MILP", "QP", "MIQP"]

    def available(self) -> bool:
        import pyomo.environ as pyo

        return bool(pyo.SolverFactory("appsi_highs").available(False))

    def solve(self, model: Any, *, mip_gap: float = 0.001, time_limit_seconds: int = 300, threads: int | None = None) -> SolverRunResult:
        import pyomo.environ as pyo

        solver = pyo.SolverFactory("appsi_highs")
        if not self.available():
            raise RuntimeError("Pyomo appsi_highs solver is not available. Ensure pyomo and highspy are installed.")
        solver.options["time_limit"] = float(time_limit_seconds)
        solver.options["mip_rel_gap"] = float(mip_gap)
        if threads:
            solver.options["threads"] = int(threads)

        started = time.monotonic()
        result = solver.solve(model)
        solve_time = time.monotonic() - started
        termination = str(result.solver.termination_condition)
        status = "optimal" if "optimal" in termination.lower() else "feasible" if "feasible" in termination.lower() else "failed"
        objective_value = None
        if hasattr(model, "objective"):
            objective_value = float(pyo.value(model.objective))
        return SolverRunResult(
            status=status,
            objective_value=objective_value,
            solve_time=round(solve_time, 4),
            variable_values=self._extract_variables(model),
            solver_log=f"HiGHS termination_condition={termination}",
            raw_termination_condition=termination,
        )

    def _extract_variables(self, model: Any) -> dict[str, Any]:
        import pyomo.environ as pyo

        values: dict[str, Any] = {}
        business_labels = getattr(model, "_business_variable_labels", {}) or {}
        for component in model.component_objects(pyo.Var, active=True):
            name = component.getname()
            if name in business_labels:
                meta = business_labels[name]
                base = str(meta.get("base") or name)
                key = ",".join(meta.get("keys") or []) or str(meta.get("label") or name)
                for index in component:
                    value = pyo.value(component[index], exception=False)
                    values.setdefault(base, {})[key] = None if value is None else round(float(value), 6)
                continue
            data: dict[str, float] = {}
            for index in component:
                label = self._label(name, index)
                value = pyo.value(component[index], exception=False)
                data[label] = None if value is None else round(float(value), 6)
            values[name] = data
        return values

    def _label(self, name: str, index: Any) -> str:
        if index is None:
            return name
        if isinstance(index, tuple):
            return f"{name}[{','.join(map(str, index))}]"
        return f"{name}[{index}]"
