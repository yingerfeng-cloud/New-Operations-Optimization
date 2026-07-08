from __future__ import annotations

from typing import Any

import pyomo.environ as pyo

from app.problem_type_diagnosis import normalize_problem_type
from app.schemas.result import SolverRunResult
from app.solvers.base import UnavailableSolverAdapter
from app.solvers.highs_adapter import HiGHSAdapter
from app.solvers.nlp_adapter import NLPSolverAdapter


PROBLEM_SOLVER_ROUTE = {
    "LP": "HiGHS",
    "MILP": "HiGHS",
    "QP": "HiGHS",
    "MIQP": "HiGHS",
    "NLP": "Ipopt",
    "MINLP_RESERVED": None,
}


class SolverRouteError(RuntimeError):
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        super().__init__(str(payload))


class ScipAdapter(UnavailableSolverAdapter):
    def __init__(self) -> None:
        super().__init__("SCIP", [], "Production MINLP solving is not supported. Choose a linearization strategy or simplify the model.")


class SolverRouter:
    def __init__(self) -> None:
        self.adapters = {
            "highs": HiGHSAdapter(),
            "ipopt": NLPSolverAdapter(),
            "scip": ScipAdapter(),
        }

    def route(self, problem_type: str | None, requested_solver: str | None = None) -> dict[str, Any]:
        normalized_type = normalize_problem_type(problem_type)
        if normalized_type == "MINLP_RESERVED" and not requested_solver:
            return {
                "ok": False,
                "status": "minlp_reserved",
                "problem_type": normalized_type,
                "recommended_solver": None,
                "selected_solver": None,
                "supported_problem_types": [],
                "available": False,
                "error_code": "MINLP_RESERVED_UNSUPPORTED",
                "message": "当前模型被识别为 MINLP，平台当前未开放生产级 MINLP 求解。请改用线性化策略，或移除整数变量后使用 NLP。",
            }
        recommended = PROBLEM_SOLVER_ROUTE.get(normalized_type)
        if not recommended and not requested_solver:
            return {
                "ok": False,
                "status": "unsupported_problem_type",
                "problem_type": normalized_type,
                "recommended_solver": None,
                "selected_solver": None,
                "error_code": "PROBLEM_TYPE_UNKNOWN",
                "message": f"Unsupported or unknown problem type: {normalized_type}",
            }
        solver_name = requested_solver or recommended
        key = self._key(solver_name)
        adapter = self.adapters.get(key)
        if adapter is None:
            return {
                "ok": False,
                "status": "solver_unavailable",
                "problem_type": normalized_type,
                "recommended_solver": recommended,
                "selected_solver": solver_name,
                "error_code": "SOLVER_UNKNOWN",
                "message": f"Unknown solver: {solver_name}",
            }
        supported = normalized_type in getattr(adapter, "supported_problem_types", [])
        available = bool(adapter.available())
        return {
            "ok": supported and available,
            "status": "ok" if supported and available else "solver_unavailable" if supported else "solver_unsupported_problem_type",
            "problem_type": normalized_type,
            "recommended_solver": recommended,
            "selected_solver": getattr(adapter, "name", solver_name),
            "supported_problem_types": getattr(adapter, "supported_problem_types", []),
            "available": available,
            "error_code": None if supported and available else "SOLVER_UNSUPPORTED_PROBLEM_TYPE" if not supported else "SOLVER_UNAVAILABLE",
            "message": None if supported and available else self._message(adapter, normalized_type, solver_name, supported, available),
        }

    def solve(
        self,
        model: Any,
        *,
        problem_type: str | None,
        requested_solver: str | None = None,
        mip_gap: float = 0.001,
        time_limit_seconds: int = 300,
        threads: int | None = None,
    ) -> SolverRunResult:
        route = self.route(problem_type, requested_solver)
        if not route["ok"]:
            raise SolverRouteError(route)
        self._assert_highs_can_accept_model(model, route)
        adapter = self.adapters[self._key(str(route["selected_solver"]))]
        return adapter.solve(model, mip_gap=mip_gap, time_limit_seconds=time_limit_seconds, threads=threads)

    def infer_problem_type_from_model(self, model: Any, default: str = "LP") -> str:
        has_integer = any(var.is_integer() or var.is_binary() for component in model.component_objects(pyo.Var, active=True) for var in component.values())
        nonlinear = self._model_has_nonlinearity(model)
        if nonlinear:
            return "MINLP_RESERVED" if has_integer else "NLP"
        return "MILP" if has_integer else default

    def _key(self, solver_name: str | None) -> str:
        value = str(solver_name or "").lower()
        if value in {"highs", "appsi_highs"}:
            return "highs"
        if value in {"ipopt"}:
            return "ipopt"
        if value in {"scip", "bonmin", "scip/bonmin"}:
            return "scip"
        return value

    def _message(self, adapter: Any, problem_type: str, solver_name: str, supported: bool, available: bool) -> str:
        if not supported:
            return f"{solver_name} does not support {problem_type}; supported types: {getattr(adapter, 'supported_problem_types', [])}"
        return f"{solver_name} is not available; no fallback solver was used"

    def _assert_highs_can_accept_model(self, model: Any, route: dict[str, Any]) -> None:
        if self._key(str(route.get("selected_solver"))) != "highs":
            return
        problem_type = normalize_problem_type(route.get("problem_type"))
        nonlinear_constraints = []
        for component in model.component_objects(pyo.Constraint, active=True):
            for index, constraint in component.items():
                if not constraint.active:
                    continue
                degree = constraint.body.polynomial_degree()
                if degree is None or degree > 1:
                    nonlinear_constraints.append({"constraint": f"{component.name}[{index}]", "degree": degree})
                    if len(nonlinear_constraints) >= 5:
                        break
            if len(nonlinear_constraints) >= 5:
                break
        if nonlinear_constraints:
            raise SolverRouteError(
                {
                    "ok": False,
                    "status": "nonlinear_not_linearized",
                    "problem_type": problem_type,
                    "selected_solver": route.get("selected_solver"),
                    "recommended_solver": "NLP/MINLP reserved",
                    "error_code": "NONLINEAR_NOT_LINEARIZED",
                    "message": "HiGHS cannot solve nonlinear constraints directly. Convert bilinear/function terms with McCormick or PWL before solving.",
                    "nonlinear_constraints": nonlinear_constraints,
                }
            )
        objectives = []
        for objective in model.component_objects(pyo.Objective, active=True):
            for index, item in objective.items():
                degree = item.expr.polynomial_degree()
                objectives.append({"objective": f"{objective.name}[{index}]", "degree": degree})
                if degree is None or (problem_type in {"LP", "MILP"} and degree > 1) or degree > 2:
                    raise SolverRouteError(
                        {
                            "ok": False,
                            "status": "nonlinear_not_linearized",
                            "problem_type": problem_type,
                            "selected_solver": route.get("selected_solver"),
                            "recommended_solver": "QP or PWL" if degree == 2 else "NLP/MINLP reserved",
                            "error_code": "NONLINEAR_NOT_LINEARIZED",
                            "message": "HiGHS route rejected an objective that is not compatible with the requested problem type.",
                            "objectives": objectives,
                        }
                    )

    def _model_has_nonlinearity(self, model: Any) -> bool:
        for component in model.component_objects(pyo.Constraint, active=True):
            for constraint in component.values():
                if not constraint.active:
                    continue
                degree = constraint.body.polynomial_degree()
                if degree is None or degree > 1:
                    return True
        for objective in model.component_objects(pyo.Objective, active=True):
            for item in objective.values():
                degree = item.expr.polynomial_degree()
                if degree is None or degree > 1:
                    return True
        return False


solver_router = SolverRouter()
