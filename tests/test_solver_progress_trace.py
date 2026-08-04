from __future__ import annotations

import pyomo.environ as pyo

from app.jobs.job_runner import JobRunner
from app.schemas.solve import SolveRequest, TaskRecord
from app.solvers.highs_adapter import HiGHSAdapter


def _knapsack_model() -> pyo.ConcreteModel:
    model = pyo.ConcreteModel()
    model.I = pyo.RangeSet(1, 80)
    model.selected = pyo.Var(model.I, domain=pyo.Binary)
    model.objective = pyo.Objective(
        expr=sum((((item * 37) % 101) + 10) * model.selected[item] for item in model.I),
        sense=pyo.maximize,
    )
    model.capacity = pyo.Constraint(
        expr=sum((((item * 17) % 47) + 5) * model.selected[item] for item in model.I) <= 700
    )
    return model


def _linear_model() -> pyo.ConcreteModel:
    model = pyo.ConcreteModel()
    model.I = pyo.RangeSet(1, 20)
    model.x = pyo.Var(model.I, bounds=(0, 10))
    model.objective = pyo.Objective(expr=sum(item * model.x[item] for item in model.I))
    model.requirement = pyo.Constraint(expr=sum(model.x[item] for item in model.I) >= 50)
    return model


def test_highs_adapter_emits_real_mip_progress() -> None:
    samples: list[dict] = []

    result = HiGHSAdapter().solve(
        _knapsack_model(),
        mip_gap=0.0,
        time_limit_seconds=10,
        progress_callback=samples.append,
    )

    assert result.status == "optimal"
    assert samples[0]["kind"] == "monitoring_started"
    data_samples = [sample for sample in samples if sample["kind"] in {"incumbent", "progress"}]
    assert data_samples
    assert any(sample.get("incumbent_objective") is not None for sample in data_samples)
    assert any(sample.get("best_bound") is not None for sample in data_samples)
    assert any(sample.get("gap") == 0 for sample in data_samples)


def test_highs_adapter_emits_real_lp_iteration_summary() -> None:
    samples: list[dict] = []

    result = HiGHSAdapter().solve(
        _linear_model(),
        time_limit_seconds=10,
        progress_callback=samples.append,
    )

    assert result.status == "optimal"
    assert samples[0]["kind"] == "monitoring_started"
    assert samples[0]["search_mode"] == "LP_ITERATION"
    final = next(sample for sample in reversed(samples) if sample["kind"] == "iteration_final")
    assert isinstance(final["iteration_count"], int)
    assert final["iteration_count"] >= 0
    assert final["algorithm"]


def test_job_runner_builds_bounded_progress_trace_and_events() -> None:
    runner = JobRunner()
    task = TaskRecord(id="TASK-PROGRESS", request=SolveRequest(model_code="progress_case"))
    runner._initialize_solver_progress(task, solver="HiGHS", problem_type="MILP")
    runner._record_solver_progress(task, {"kind": "monitoring_started"})
    runner._record_solver_progress(task, {
        "kind": "incumbent",
        "elapsed_seconds": 0.1,
        "incumbent_objective": 120.0,
        "best_bound": 80.0,
        "gap": 0.5,
        "node_count": 0,
    })
    runner._record_solver_progress(task, {
        "kind": "progress",
        "elapsed_seconds": 0.8,
        "incumbent_objective": 90.0,
        "best_bound": 89.0,
        "gap": 0.011,
        "node_count": 4,
    })
    task.trace["solve_seconds"] = 1.0
    runner._complete_solver_progress(task, status="optimal", objective=89.0, gap=0.0)

    progress = task.trace["solver_progress"]
    assert progress["status"] == "COMPLETED"
    assert progress["supported"] is True
    assert progress["latest"]["gap"] == 0.0
    assert progress["latest"]["node_count"] == 4
    event_kinds = [event["kind"] for event in progress["events"]]
    assert "first_feasible" in event_kinds
    assert "gap_milestone" in event_kinds
    assert "optimality_proven" in event_kinds


def test_job_runner_preserves_lp_iteration_metadata() -> None:
    runner = JobRunner()
    task = TaskRecord(id="TASK-LP-PROGRESS", request=SolveRequest(model_code="lp_progress_case"))
    runner._initialize_solver_progress(task, solver="HiGHS", problem_type="LP")
    runner._record_solver_progress(task, {
        "kind": "monitoring_started",
        "search_mode": "LP_ITERATION",
        "message": "recording LP iterations",
    })
    runner._record_solver_progress(task, {
        "kind": "iteration",
        "elapsed_seconds": 0.01,
        "iteration_count": 1,
        "algorithm": "单纯形",
    })
    runner._record_solver_progress(task, {
        "kind": "iteration_final",
        "elapsed_seconds": 0.02,
        "iteration_count": 4,
        "algorithm": "单纯形",
    })
    task.trace["solve_seconds"] = 0.02
    runner._complete_solver_progress(task, status="optimal", objective=12.0, gap=0.0)

    progress = task.trace["solver_progress"]
    assert progress["search_mode"] == "LP_ITERATION"
    assert progress["latest"]["iteration_count"] == 4
    assert progress["latest"]["algorithm"] == "单纯形"
    assert "LP 算法迭代轨迹" in progress["message"]
