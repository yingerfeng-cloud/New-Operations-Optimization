from __future__ import annotations

from typing import Any, Protocol

from app.schemas.result import SolverRunResult


class SolverAdapter(Protocol):
    name: str
    supported_problem_types: list[str]

    def available(self) -> bool:
        ...

    def solve(self, model: Any, *, mip_gap: float = 0.001, time_limit_seconds: int = 300, threads: int | None = None) -> SolverRunResult:
        ...


class UnavailableSolverAdapter:
    def __init__(self, name: str, supported_problem_types: list[str], install_hint: str) -> None:
        self.name = name
        self.supported_problem_types = supported_problem_types
        self.install_hint = install_hint

    def available(self) -> bool:
        return False

    def solve(self, model: Any, *, mip_gap: float = 0.001, time_limit_seconds: int = 300, threads: int | None = None) -> SolverRunResult:
        raise RuntimeError(f"{self.name} solver is not available. {self.install_hint}")
