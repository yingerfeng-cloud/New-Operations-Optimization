from __future__ import annotations

import pyomo.environ as pyo
import pytest

from app.jobs.job_runner import JobRunner
from app.schemas.solve import SolveRequest, TaskRecord
from app.schemas.result import SolverRunResult
from app.solvers.solver_router import SolverRouteError, SolverRouter, solver_router


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


def test_nlp_router_forwards_ipopt_specific_options() -> None:
    captured: dict = {}

    class FakeIpoptAdapter:
        name = "Ipopt"
        supported_problem_types = ["NLP"]

        def available(self) -> bool:
            return True

        def solve(self, model, **options):
            captured.update(options)
            return SolverRunResult(status="local_optimal", solver_name="Ipopt", solver_type="NLP")

    router = SolverRouter()
    router.adapters["ipopt"] = FakeIpoptAdapter()
    model = pyo.ConcreteModel()
    model.x = pyo.Var(bounds=(0, 2), initialize=1)
    model.objective = pyo.Objective(expr=(model.x - 1) ** 2)

    result = router.solve(
        model,
        problem_type="NLP",
        nlp_tolerance=1e-7,
        max_iter=125,
        acceptable_tol=1e-5,
        time_limit_seconds=12,
    )

    assert result.status == "local_optimal"
    assert captured["nlp_tolerance"] == 1e-7
    assert captured["max_iter"] == 125
    assert captured["acceptable_tol"] == 1e-5
    assert captured["time_limit_seconds"] == 12


def test_job_runner_resolves_auto_solver_to_ipopt_for_nlp(monkeypatch: pytest.MonkeyPatch) -> None:
    model = pyo.ConcreteModel()
    model.x = pyo.Var(bounds=(0, 2), initialize=1)
    model.y = pyo.Var(bounds=(0, 2), initialize=1)
    model.product = pyo.Constraint(expr=model.x * model.y >= 0.5)
    model.objective = pyo.Objective(expr=model.x + model.y)
    task = TaskRecord(
        id="NLP-AUTO-ROUTE",
        request=SolveRequest(
            solver="auto",
            payload={"semantic_spec": {"model_code": "nlp_auto", "problem_type": "NLP"}},
        ),
    )
    runner = JobRunner()
    captured: dict = {}

    class FakeBuilder:
        def build(self, semantic_spec, runtime):
            return model, {"model_code": "nlp_auto"}

    def fake_route(problem_type, requested_solver=None):
        captured["requested_solver"] = requested_solver
        return {
            "ok": False,
            "status": "solver_unavailable",
            "problem_type": "NLP",
            "recommended_solver": "Ipopt",
            "selected_solver": "Ipopt",
            "error_code": "SOLVER_UNAVAILABLE",
            "message": "Ipopt unavailable",
        }

    monkeypatch.setattr("app.jobs.job_runner.PyomoModelBuilder", FakeBuilder)
    monkeypatch.setattr("app.jobs.job_runner.solver_router.route", fake_route)
    monkeypatch.setattr(runner, "_get_task", lambda task_id: task)
    monkeypatch.setattr(runner, "_update", lambda current, status, progress: setattr(current, "status", status))
    monkeypatch.setattr(runner, "_finish", lambda current, status, error=None: setattr(current, "status", status))
    monkeypatch.setattr(runner, "_log", lambda *args, **kwargs: None)

    runner.run(task.id)

    assert captured["requested_solver"] is None
    assert task.request.solver == "Ipopt"
    assert task.status == "FAILED"
