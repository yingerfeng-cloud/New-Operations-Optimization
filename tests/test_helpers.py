from __future__ import annotations

import time
import unittest

from app.main import app  # noqa: F401 - seeds default model assets
from app.builders.pyomo_builder import PyomoModelBuilder
from app.diagnosis.infeasible_diagnosis import diagnose_infeasible
from app.explain.result_formatter import SolveResultFormatter
from app.schemas.solve import SolveRequest
from app.semantic.semantic_validator import RuntimeParameterValidator
from app.services.agent_service import AgentOptimizeRequest, agent_service
from app.services.job_service import job_service
from app.services.result_service import result_service
from app.services.template_service import template_library
from app.solvers.highs_adapter import HiGHSAdapter


def test_and_publish_model(client, model_id: str, runtime_parameters: dict | None = None):
    """Exercise the production test and publish APIs without forging store state."""
    if runtime_parameters is None:
        fetched = client.get(f"/api/models/{model_id}")
        assert fetched.status_code == 200, fetched.text
        model = fetched.json()
        semantic = model.get("semantic_spec") or {}
        draft = model.get("model_draft") or {}
        runtime_parameters = {
            **(semantic.get("sample_runtime_parameters") or {}),
            **(draft.get("runtime_parameters") or {}),
            **(model.get("parameters") or {}),
        }
        for parameter in semantic.get("parameters") or []:
            key = parameter.get("key") or parameter.get("code")
            if not key or key in runtime_parameters:
                continue
            validation = parameter.get("validation") or {}
            value = parameter.get("sample_value", parameter.get("default_value", validation.get("default")))
            if value is not None:
                runtime_parameters[key] = value
    test_payload = {"parameters": runtime_parameters} if runtime_parameters is not None else {}
    tested = client.post(f"/api/models/{model_id}/test", json=test_payload)
    assert tested.status_code == 200, tested.text
    assert tested.json()["status"] == "tested", tested.text
    published = client.post(f"/api/models/{model_id}/publish")
    assert published.status_code == 200, published.text
    return published


test_and_publish_model.__test__ = False


def solve_template(code: str) -> dict:
    template = template_library.get_template(code)
    params = template_library.sample_runtime_parameters(code)
    errors = RuntimeParameterValidator().validate(template, params)
    if errors:
        raise AssertionError(errors)
    model, context = PyomoModelBuilder().build(template, {**params, "semantic_spec": template})
    solver_result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    formatted = SolveResultFormatter().format(code, solver_result, context)
    return {"template": template, "params": params, "solver_result": solver_result, "formatted": formatted}


def submit_and_wait(code: str) -> tuple[str, dict]:
    params = template_library.sample_runtime_parameters(code)
    task = job_service.create_task(SolveRequest(model_code=code, horizon=params.get("horizon"), parameters=params, time_limit_seconds=30))
    for _ in range(120):
        current = job_service.get_task(task.id)
        if current.status in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
            break
        time.sleep(0.1)
    return current.status, result_service.get_result(task.id)


class TemplateSolveMixin:
    template_code = ""

    def test_template_loads_builds_solves_and_formats(self) -> None:
        result = solve_template(self.template_code)
        self.assertEqual(result["solver_result"].status, "optimal")
        self.assertIn("business_output", result["formatted"])
        self.assertIn("business_explanation", result["formatted"])

    def test_job_api_path_succeeds(self) -> None:
        status, result = submit_and_wait(self.template_code)
        self.assertEqual(status, "SUCCESS")
        self.assertIn("metrics", result)
        self.assertIn("run_metrics", result)


def assert_diagnosis(testcase: unittest.TestCase, code: str, params: dict) -> None:
    diagnosis = diagnose_infeasible(code, params)
    testcase.assertGreaterEqual(len(diagnosis), 1)
    testcase.assertIn("suggestion", diagnosis[0])
