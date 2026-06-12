from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.schemas.result import SolverRunResult
from app.solvers.highs_adapter import HiGHSAdapter


@dataclass
class SolverConfig:
    backend: str = "HiGHS"
    mip_gap: float = 0.001
    time_limit_seconds: int = 300
    threads: int | None = None


class SolverAdapter:
    """Compatibility wrapper for the MVP-era import path.

    The current platform stage intentionally supports HiGHS only. Business
    code should use app.solvers.highs_adapter.HiGHSAdapter directly.
    """

    def __init__(self, config: SolverConfig) -> None:
        self.config = config

    def solve(self, pyomo_model: Any) -> SolverRunResult:
        if self.config.backend != "HiGHS":
            raise ValueError("Only HiGHS is supported in the current platform stage.")
        return HiGHSAdapter().solve(
            pyomo_model,
            mip_gap=self.config.mip_gap,
            time_limit_seconds=self.config.time_limit_seconds,
            threads=self.config.threads,
        )
