from __future__ import annotations

import pyomo.environ as pyo
import pytest

from app.solvers.solver_router import SolverRouteError, solver_router


def test_lp_and_milp_route_to_highs() -> None:
    lp = solver_router.route("LP")
    milp = solver_router.route("MILP")

    assert lp["selected_solver"] == "HiGHS"
    assert milp["selected_solver"] == "HiGHS"


def test_nlp_routes_to_ipopt_without_highs_fallback() -> None:
    route = solver_router.route("NLP")

    assert route["selected_solver"] == "Ipopt"
    assert route["recommended_solver"] == "Ipopt"
    if route["available"]:
        assert route["ok"] is True
    else:
        assert route["ok"] is False
        assert route["error_code"] == "SOLVER_UNAVAILABLE"


def test_minlp_reserved_route_blocks_solver_selection() -> None:
    route = solver_router.route("MINLP_RESERVED")

    assert route["ok"] is False
    assert route["status"] == "minlp_reserved"
    assert route["selected_solver"] is None
    assert route["recommended_solver"] is None
    assert route["error_code"] == "MINLP_RESERVED_UNSUPPORTED"


def test_infer_minlp_reserved_from_nonlinear_integer_model() -> None:
    model = pyo.ConcreteModel()
    model.x = pyo.Var(domain=pyo.Binary)
    model.y = pyo.Var(bounds=(0, 10))
    model.c = pyo.Constraint(expr=model.x * model.y <= 4)
    model.obj = pyo.Objective(expr=model.y)

    assert solver_router.infer_problem_type_from_model(model) == "MINLP_RESERVED"
    with pytest.raises(SolverRouteError):
        solver_router.solve(model, problem_type="MINLP_RESERVED")
