from __future__ import annotations

import math
import time
from typing import Any

import pyomo.environ as pyo

from app.schemas.result import SolverRunResult
from app.solvers.status import IPOPT_UNAVAILABLE_MESSAGE


LOCAL_OPTIMUM_WARNING = "NLP solve is a local optimum search; results depend on initial values, bounds, and model scaling."
IPOPT_INSTALL_HINT = f"{IPOPT_UNAVAILABLE_MESSAGE} Install Ipopt and ensure the ipopt executable is on PATH before enabling NLP solves."


class NLPSolverAdapter:
    name = "Ipopt"
    supported_problem_types = ["NLP"]

    def available(self) -> bool:
        try:
            return bool(pyo.SolverFactory("ipopt").available(False))
        except Exception:
            return False

    def availability_message(self) -> str:
        return "Ipopt is available." if self.available() else IPOPT_INSTALL_HINT

    def solve(
        self,
        model: Any,
        *,
        mip_gap: float = 0.001,
        time_limit_seconds: int = 300,
        threads: int | None = None,
        nlp_tolerance: float | None = None,
        max_cpu_time: float | None = None,
        max_iter: int | None = None,
        acceptable_tol: float | None = None,
    ) -> SolverRunResult:
        if self._has_integer_variables(model):
            return self._failed_result(
                "MINLP_RESERVED",
                "当前模型被识别为 MINLP，平台当前未开放生产级 MINLP 求解。请改用线性化策略，或移除整数变量后使用 NLP。",
                solver_available=self.available(),
            )
        if not self.available():
            return self._failed_result("solver_unavailable", IPOPT_INSTALL_HINT)

        self._initialize_unset_variables(model)
        solver = pyo.SolverFactory("ipopt")
        solver.options["max_cpu_time"] = float(max_cpu_time if max_cpu_time is not None else time_limit_seconds)
        solver.options["tol"] = float(max(nlp_tolerance if nlp_tolerance is not None else mip_gap, 1e-8))
        if max_iter is not None:
            solver.options["max_iter"] = int(max_iter)
        if acceptable_tol is not None:
            solver.options["acceptable_tol"] = float(acceptable_tol)

        started = time.monotonic()
        try:
            result = solver.solve(model, tee=False)
        except Exception as exc:
            return self._failed_result("solver_exception", f"Ipopt solve failed: {exc}")
        solve_time = time.monotonic() - started

        termination = str(result.solver.termination_condition)
        status = self._status_from_termination(termination)
        objective_value = self._objective_value(model)
        variables = self.extract_variables(model)
        violations = self.constraint_violations(model)
        message = f"Ipopt termination_condition={termination}. {LOCAL_OPTIMUM_WARNING}"
        return SolverRunResult(
            status=status,
            objective_value=objective_value,
            objective=objective_value,
            solve_time=round(solve_time, 4),
            variable_values=variables,
            variables=variables,
            solver_log=message,
            raw_termination_condition=termination,
            solver_type="NLP",
            solver_name=self.name,
            local_optimum_warning=True,
            termination_condition=termination,
            constraint_violation_summary=violations,
            solver_available=True,
            solver_message=message,
            message=message,
        )

    def _failed_result(self, status: str, message: str, *, solver_available: bool = False) -> SolverRunResult:
        return SolverRunResult(
            status=status,
            objective_value=None,
            objective=None,
            solve_time=0.0,
            variable_values={},
            variables={},
            solver_log=message,
            raw_termination_condition=status,
            solver_type="NLP",
            solver_name=self.name,
            local_optimum_warning=True,
            termination_condition=status,
            constraint_violation_summary={"max_violation": None, "violated_count": None, "violations": []},
            solver_available=solver_available,
            solver_message=message,
            message=message,
        )

    def _has_integer_variables(self, model: Any) -> bool:
        return any(
            var.is_integer() or var.is_binary()
            for component in model.component_objects(pyo.Var, active=True)
            for var in component.values()
        )

    def _initialize_unset_variables(self, model: Any) -> None:
        for component in model.component_objects(pyo.Var, active=True):
            for var in component.values():
                if pyo.value(var, exception=False) is not None:
                    continue
                lb = var.lb
                ub = var.ub
                if lb is not None and ub is not None and math.isfinite(float(lb)) and math.isfinite(float(ub)):
                    var.set_value((float(lb) + float(ub)) / 2)
                elif lb is not None and math.isfinite(float(lb)):
                    var.set_value(max(float(lb), 0.0))
                elif ub is not None and math.isfinite(float(ub)):
                    var.set_value(min(float(ub), 0.0))
                else:
                    var.set_value(0.0)

    def _objective_value(self, model: Any) -> float | None:
        objectives = list(model.component_data_objects(pyo.Objective, active=True))
        if not objectives:
            return None
        value = pyo.value(objectives[0].expr, exception=False)
        return None if value is None else round(float(value), 8)

    def extract_variables(self, model: Any) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for component in model.component_objects(pyo.Var, active=True):
            data: dict[str, float | None] = {}
            for index in component:
                value = pyo.value(component[index], exception=False)
                data[self._label(component.getname(), index)] = None if value is None else round(float(value), 8)
            values[component.getname()] = data
        return values

    def constraint_violations(self, model: Any, tolerance: float = 1e-6) -> dict[str, Any]:
        rows: list[dict[str, Any]] = []
        max_violation = 0.0
        for component in model.component_objects(pyo.Constraint, active=True):
            for index, constraint in component.items():
                if not constraint.active:
                    continue
                body = pyo.value(constraint.body, exception=False)
                if body is None:
                    continue
                violation = 0.0
                lower = pyo.value(constraint.lower, exception=False) if constraint.has_lb() else None
                upper = pyo.value(constraint.upper, exception=False) if constraint.has_ub() else None
                if lower is not None:
                    violation = max(violation, float(lower) - float(body))
                if upper is not None:
                    violation = max(violation, float(body) - float(upper))
                if violation > tolerance:
                    rows.append(
                        {
                            "constraint": self._label(component.getname(), index),
                            "violation": round(float(violation), 8),
                            "body": round(float(body), 8),
                            "lower": None if lower is None else round(float(lower), 8),
                            "upper": None if upper is None else round(float(upper), 8),
                        }
                    )
                max_violation = max(max_violation, float(violation))
        return {
            "max_violation": round(max_violation, 8),
            "violated_count": len(rows),
            "violations": rows[:20],
        }

    def _status_from_termination(self, termination: str) -> str:
        lowered = termination.lower()
        if "optimal" in lowered or "locallyoptimal" in lowered:
            return "local_optimal"
        if "acceptable" in lowered:
            return "feasible"
        if "infeasible" in lowered:
            return "infeasible"
        if "unbounded" in lowered:
            return "unbounded"
        if "max" in lowered or "feasible" in lowered:
            return "feasible"
        return "failed"

    def _label(self, name: str, index: Any) -> str:
        if index is None:
            return name
        if isinstance(index, tuple):
            return f"{name}[{','.join(map(str, index))}]"
        return f"{name}[{index}]"
