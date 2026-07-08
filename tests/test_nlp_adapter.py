from __future__ import annotations

import os

import pytest
import pyomo.environ as pyo

from app.solvers.nlp_adapter import NLPSolverAdapter
from app.solvers.status import solver_status


def _require_ipopt() -> None:
    status = solver_status()
    if status["ipopt"]["available"]:
        return
    if os.getenv("REQUIRE_IPOPT") == "1":
        pytest.fail(status.get("message") or "Ipopt is required but unavailable")
    pytest.skip(status.get("message") or "Ipopt unavailable")


def _minimal_nlp() -> pyo.ConcreteModel:
    model = pyo.ConcreteModel()
    model.x = pyo.Var(bounds=(0, 10))
    model.y = pyo.Var(bounds=(0, 10))
    model.objective = pyo.Objective(expr=(model.x - 1) ** 2 + (model.y - 2) ** 2)
    model.product_floor = pyo.Constraint(expr=model.x * model.y >= 1)
    return model


def test_nlp_adapter_reports_clear_error_when_ipopt_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = NLPSolverAdapter()
    monkeypatch.setattr(adapter, "available", lambda: False)
    result = adapter.solve(_minimal_nlp())

    assert result.status == "solver_unavailable"
    assert result.solver_type == "NLP"
    assert result.solver_name == "Ipopt"
    assert result.solver_available is False
    assert "Ipopt executable not found" in result.message
    assert result.local_optimum_warning is True


def test_nlp_adapter_reserves_minlp_without_calling_ipopt(monkeypatch: pytest.MonkeyPatch) -> None:
    model = pyo.ConcreteModel()
    model.x = pyo.Var(domain=pyo.Binary, initialize=1)
    model.y = pyo.Var(bounds=(0, 10), initialize=1)
    model.objective = pyo.Objective(expr=model.x * model.y)
    adapter = NLPSolverAdapter()
    monkeypatch.setattr(adapter, "available", lambda: True)

    result = adapter.solve(model)

    assert result.status == "MINLP_RESERVED"
    assert result.solver_type == "NLP"
    assert result.solver_name == "Ipopt"
    assert "MINLP" in result.message
    assert result.objective is None


def test_nlp_adapter_solves_real_nlp_with_ipopt() -> None:
    _require_ipopt()
    result = NLPSolverAdapter().solve(
        _minimal_nlp(),
        nlp_tolerance=1e-7,
        max_cpu_time=30,
        max_iter=200,
        acceptable_tol=1e-6,
    )

    assert result.solver_type == "NLP"
    assert result.solver_name == "Ipopt"
    assert result.solver_available is True
    assert result.objective is not None
    assert result.objective_value == result.objective
    assert result.variables
    assert result.variable_values == result.variables
    assert result.termination_condition
    assert result.local_optimum_warning is True
    assert result.constraint_violation_summary["max_violation"] <= 1e-5
    assert result.status in {"local_optimal", "feasible"}
    assert "local optimum" in result.message
