from __future__ import annotations

from app.schemas.solve import SolveRequest, TaskRecord


def test_historical_task_view_recovers_objective_from_result_contract() -> None:
    task = TaskRecord(
        id="TASK-HISTORICAL-OBJECTIVE",
        request=SolveRequest(),
        status="SUCCESS",
        cost=0,
        result={"objective_value": 14645.728721994736, "metrics": {"total_operating_cost": 14645.728721994736}},
    )

    view = task.view()

    assert view.cost == 0
    assert view.objective_value == 14645.73


def test_explicit_task_objective_has_priority_over_historical_result() -> None:
    task = TaskRecord(
        id="TASK-EXPLICIT-OBJECTIVE",
        request=SolveRequest(),
        status="SUCCESS",
        objective_value=-268736.071,
        result={"objective_value": 999},
    )

    assert task.view().objective_value == -268736.07
