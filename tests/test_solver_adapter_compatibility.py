from __future__ import annotations

import pyomo.environ as pyo

import solver_adapter as compatibility
from app.schemas.result import SolverRunResult


def test_compatibility_adapter_routes_continuous_nlp_to_ipopt(monkeypatch) -> None:
    model = pyo.ConcreteModel()
    model.x = pyo.Var(bounds=(0, 2), initialize=1)
    model.y = pyo.Var(bounds=(0, 2), initialize=1)
    model.product = pyo.Constraint(expr=model.x * model.y >= 0.5)
    model.objective = pyo.Objective(expr=model.x + model.y)
    captured: dict = {}

    def fake_solve(pyomo_model, **options):
        captured.update(options)
        return SolverRunResult(status="local_optimal", solver_name="Ipopt", solver_type="NLP")

    monkeypatch.setattr(compatibility.solver_router, "solve", fake_solve)
    result = compatibility.SolverAdapter(
        compatibility.SolverConfig(
            backend="Ipopt",
            nlp_tolerance=1e-8,
            max_iter=250,
        )
    ).solve(model)

    assert result.status == "local_optimal"
    assert captured["problem_type"] == "NLP"
    assert captured["requested_solver"] == "Ipopt"
    assert captured["nlp_tolerance"] == 1e-8
    assert captured["max_iter"] == 250
