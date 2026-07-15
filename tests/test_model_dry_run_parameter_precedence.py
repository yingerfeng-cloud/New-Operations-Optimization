from app.schemas.model import ModelPackage
from app.services.model_service import model_service


def test_generic_dry_run_prefers_explicit_test_parameters_over_empty_editor_defaults() -> None:
    model = ModelPackage(
        name="generic dry-run precedence",
        scene="test",
        build_mode="generic_linear",
        parameters={"load": 8},
        semantic_spec={"sets": [{"code": "resource", "values": ["R1"]}]},
        generic_spec={
            "sets": {},
            "parameters": {"load": ""},
            "variables": [{"name": "power", "indices": [], "domain": "NonNegativeReals", "lb": 0}],
            "constraints": [{"name": "balance", "foreach": [], "terms": [{"var": "power", "key": [], "coef": 1}], "sense": ">=", "rhs_param": "load", "rhs_key": []}],
            "objective": {"sense": "minimize", "terms": [{"var": "power", "key": [], "coef": 1}]},
            "sense": "minimize",
        },
    )

    result = model_service._dry_run_model(model, test_parameters={"load": 10}, run_solver=True)

    assert result["structure_check"]["status"] == "passed"
    assert result["solver_check"]["status"] == "passed"
    assert result["solver_check"]["objective_value"] == 10

    saved_result = model_service._dry_run_model(model, run_solver=True)
    assert saved_result["solver_check"]["status"] == "passed"
    assert saved_result["solver_check"]["objective_value"] == 8
