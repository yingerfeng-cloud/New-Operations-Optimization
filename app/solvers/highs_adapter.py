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
        result = solver.solve(model, load_solutions=False)
        solve_time = time.monotonic() - started
        termination = str(result.solver.termination_condition)
        termination_lower = termination.lower()
        lower_bound = getattr(result.problem, "lower_bound", None)
        upper_bound = getattr(result.problem, "upper_bound", None)
        actual_mip_gap = None
        if isinstance(lower_bound, (int, float)) and isinstance(upper_bound, (int, float)):
            actual_mip_gap = abs(float(upper_bound) - float(lower_bound)) / max(1.0, abs(float(upper_bound)))
        status = "optimal" if "optimal" in termination_lower else "infeasible" if "infeasible" in termination_lower else "failed"
        if status != "infeasible":
            try:
                model.solutions.load_from(result)
                if status == "failed" and "time" in termination_lower:
                    status = "feasible"
            except Exception:
                pass
        objective_value = None
        if status in {"optimal", "feasible"} and hasattr(model, "objective"):
            objective_value = float(pyo.value(model.objective))
        return SolverRunResult(
            status=status,
            objective_value=objective_value,
            solve_time=round(solve_time, 4),
            mip_gap=None if actual_mip_gap is None else round(actual_mip_gap, 8),
            variable_values=self._extract_variables(model),
            solver_log=f"HiGHS termination_condition={termination}",
            raw_termination_condition=termination,
            termination_condition=termination,
            solver_name=self.name,
            solver_type="MILP" if any(var.is_binary() or var.is_integer() for component in model.component_objects(pyo.Var, active=True) for var in component.values()) else "LP",
            solver_available=True,
            message="模型不可行，请检查硬负荷目标、库容边界、生态流量和函数资产定义域。" if status == "infeasible" else "",
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
