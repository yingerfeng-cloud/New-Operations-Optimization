from __future__ import annotations

import os
import subprocess

import pytest
import pyomo.environ as pyo

from app.solvers.status import solver_status


def _require_ipopt() -> dict:
    status = solver_status()
    if status["ipopt"]["available"]:
        return status
    if os.getenv("REQUIRE_IPOPT") == "1":
        pytest.fail(status.get("message") or "Ipopt is required but unavailable")
    pytest.skip(status.get("message") or "Ipopt unavailable")


def test_nlp_environment_has_ipopt_executable_and_pyomo_solver() -> None:
    status = _require_ipopt()
    ipopt = status["ipopt"]
    assert ipopt["path"]
    completed = subprocess.run([ipopt["path"], "--version"], check=False, capture_output=True, text=True, timeout=10)
    assert completed.returncode == 0
    assert (completed.stdout or completed.stderr).strip()
    assert ipopt["pyomo_available"] is True
    assert pyo.SolverFactory("ipopt").available(False) is True


def test_nlp_environment_has_highs() -> None:
    status = _require_ipopt()
    assert status["highspy_available"] is True
    assert status["highs"]["available"] is True


def test_minimal_nlp_solves_with_ipopt() -> None:
    _require_ipopt()
    model = pyo.ConcreteModel()
    model.x = pyo.Var(bounds=(0, 10), initialize=1.0)
    model.y = pyo.Var(bounds=(0, 10), initialize=2.0)
    model.objective = pyo.Objective(expr=(model.x - 1) ** 2 + (model.y - 2) ** 2)
    model.product_floor = pyo.Constraint(expr=model.x * model.y >= 1)

    result = pyo.SolverFactory("ipopt").solve(model)
    termination = str(result.solver.termination_condition).lower()

    assert any(token in termination for token in ("optimal", "locally", "acceptable"))
    assert pyo.value(model.objective, exception=False) is not None
    assert pyo.value(model.x, exception=False) is not None
    assert pyo.value(model.y, exception=False) is not None
    assert pyo.value(model.x * model.y, exception=False) >= 1 - 1e-5
