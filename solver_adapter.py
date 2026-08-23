from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.schemas.result import SolverRunResult
from app.solvers.solver_router import solver_router


@dataclass
class SolverConfig:
    backend: str = "HiGHS"
    problem_type: str | None = None
    mip_gap: float = 0.001
    time_limit_seconds: int = 300
    threads: int | None = None
    nlp_tolerance: float | None = None
    max_iter: int | None = None
    acceptable_tol: float | None = None


class SolverAdapter:
    """Compatibility wrapper for the MVP-era import path.

    New code should use ``app.solvers.solver_router`` directly. This wrapper
    follows the same HiGHS/Ipopt routing so older callers can solve continuous
    NLP models without bypassing capability and availability checks.
    """

    def __init__(self, config: SolverConfig) -> None:
        self.config = config

    def solve(self, pyomo_model: Any) -> SolverRunResult:
        problem_type = self.config.problem_type or solver_router.infer_problem_type_from_model(pyomo_model)
        return solver_router.solve(
            pyomo_model,
            problem_type=problem_type,
            requested_solver=self.config.backend,
            mip_gap=self.config.mip_gap,
            time_limit_seconds=self.config.time_limit_seconds,
            threads=self.config.threads,
            nlp_tolerance=self.config.nlp_tolerance,
            max_iter=self.config.max_iter,
            acceptable_tol=self.config.acceptable_tol,
        )
