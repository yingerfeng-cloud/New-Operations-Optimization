from __future__ import annotations

from typing import Any

import pyomo.environ as pyo

from app.problem_type_diagnosis import normalize_problem_type
from app.schemas.result import SolverRunResult
from app.solvers.base import UnavailableSolverAdapter
from app.solvers.highs_adapter import HiGHSAdapter


PROBLEM_SOLVER_ROUTE = {
    "LP": "HiGHS",
    "MILP": "HiGHS",
    "QP": "HiGHS",
    "MIQP": "HiGHS",
    "NLP": "Ipopt",
    "MINLP": "SCIP",
}


class SolverRouteError(RuntimeError):
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        super().__init__(str(payload))


class IpoptAdapter(UnavailableSolverAdapter):
    def __init__(self) -> None:
        super().__init__("Ipopt", ["NLP"], "Install Ipopt and expose it through Pyomo SolverFactory('ipopt').")


class ScipAdapter(UnavailableSolverAdapter):
    def __init__(self) -> None:
        super().__init__("SCIP", ["MINLP"], "Install SCIP or Bonmin and expose it through Pyomo before solving MINLP models.")


class SolverRouter:
    def __init__(self) -> None:
        self.adapters = {
            "highs": HiGHSAdapter(),
            "ipopt": IpoptAdapter(),
            "scip": ScipAdapter(),
        }

    def route(self, problem_type: str | None, requested_solver: str | None = None) -> dict[str, Any]:
        normalized_type = normalize_problem_type(problem_type)
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
        adapter = self.adapters[self._key(str(route["selected_solver"]))]
        return adapter.solve(model, mip_gap=mip_gap, time_limit_seconds=time_limit_seconds, threads=threads)

    def infer_problem_type_from_model(self, model: Any, default: str = "LP") -> str:
        has_integer = any(var.is_integer() or var.is_binary() for component in model.component_objects(pyo.Var, active=True) for var in component.values())
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


solver_router = SolverRouter()
