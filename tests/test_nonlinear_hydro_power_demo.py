from __future__ import annotations

import os

import pytest
import pyomo.environ as pyo

from app.builders.nonlinear_hydro_power_builder import NonlinearHydroPowerDemoBuilder
from app.solvers.nlp_adapter import NLPSolverAdapter
from app.solvers.solver_router import solver_router
from app.solvers.status import solver_status


def _require_ipopt() -> None:
    status = solver_status()
    if status["ipopt"]["available"]:
        return
    if os.getenv("REQUIRE_IPOPT") == "1":
        pytest.fail(status.get("message") or "Ipopt is required but unavailable")
    pytest.skip(status.get("message") or "Ipopt unavailable")


def test_nonlinear_hydro_power_demo_is_continuous_nlp() -> None:
    model, context = NonlinearHydroPowerDemoBuilder().build({}, {"horizon": 2})

    assert context["problem_type"] == "NLP"
    assert solver_router.infer_problem_type_from_model(model) == "NLP"
    assert not any(var.is_integer() or var.is_binary() for component in model.component_objects(pyo.Var, active=True) for var in component.values())


def test_nonlinear_hydro_power_demo_solves_with_real_ipopt() -> None:
    _require_ipopt()
    model, _ = NonlinearHydroPowerDemoBuilder().build({}, {"horizon": 2, "power_max": 5000})
    result = NLPSolverAdapter().solve(model, nlp_tolerance=1e-7, max_cpu_time=30, max_iter=200)

    assert result.solver_name == "Ipopt"
    assert result.solver_available is True
    assert result.status in {"local_optimal", "feasible"}
    assert result.objective is not None
    assert result.variables["flow"]
    assert result.variables["head"]
    assert result.variables["power"]
    assert result.constraint_violation_summary["max_violation"] <= 1e-5
    assert result.local_optimum_warning is True
    assert "local optimum" in result.message
