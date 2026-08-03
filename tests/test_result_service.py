from app.services.result_service import result_service
from app.storage.memory_store import STORE


def test_result_list_uses_solver_objective_instead_of_stale_summary_total() -> None:
    with STORE.lock:
        STORE.results.clear()
        STORE.results["OPT-STRUCTURED"] = {
            "summary": {"model": "测试模型", "total_cost": 0, "gap": "0.00%"},
            "result": {
                "objective_value": 4038948.070589,
                "model_id": "MODEL-STRUCTURED",
                "model_code": "structured_model",
                "status": "SUCCESS",
            },
        }

    row = result_service.list_results()[0]

    assert row["job_id"] == "OPT-STRUCTURED"
    assert row["objective_value"] == 4038948.070589
    assert row["model_id"] == "MODEL-STRUCTURED"
    assert row["model_code"] == "structured_model"
    assert row["total_cost"] == 0


def test_result_list_remains_compatible_with_flat_historical_results() -> None:
    with STORE.lock:
        STORE.results.clear()
        STORE.results["OPT-LEGACY"] = {
            "summary": {"model": "旧模型"},
            "objective_value": -12.5,
            "status": "SUCCESS",
        }

    row = result_service.list_results()[0]

    assert row["objective_value"] == -12.5
    assert row["status"] == "SUCCESS"
