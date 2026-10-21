"""The shared schema/Agent/runtime contract must stop at declared coordinates."""
import pytest

from app.agent.schema_parameter_analyzer import schema_parameter_analyzer
from app.services.invocation_service import invocation_service
from app.semantic.semantic_validator import RuntimeParameterValidator
from app.parameter_input_contract import parameter_input_contract, validate_parameter_input
from tests.test_iteration_component_bindings import component, model, test_publish


@pytest.mark.parametrize("dimensions,sets,valid,invalid", [
    (["site"], {"site": ["B", "A"]}, [[10, 20], {"B": 10, "A": 20}], [[[10], [20]], {"B": [10], "A": [20]}, {"B": 10}, {"X": 10, "A": 20}, [10, "nan"], [True, 20]]),
    (["site", "tariff"], {"site": ["B", "A"], "tariff": ["N", "D"]}, [[[1, 2], [3, 4]], {"B": {"N": 1, "D": 2}, "A": {"N": 3, "D": 4}}], [[1, 2], [[[1], [2]], [[3], [4]]], [[1], [3, 4]], {"B": {"N": 1, "X": 2}, "A": {"N": 3, "D": 4}}]),
    (["site", "tariff", "day"], {"site": ["B"], "tariff": ["N"], "day": [1, 2]}, [[[[1, 2]]]], [[[[[1], [2]]]], [[1, 2]]]),
])
def test_rank_schema_agent_runtime_consistency(dimensions, sets, valid, invalid):
    semantic = {"sets": [{"code": key, "values": values} for key, values in sets.items()],
        "parameters": [{"code": "cost", "dimension": dimensions, "value_type": "number"}]}
    schema = invocation_service.input_schema(semantic)
    for value in valid + invalid:
        expected_valid = value in valid
        parameters = {"cost": value}
        agent = schema_parameter_analyzer.analyze(schema, parameters)
        runtime = RuntimeParameterValidator().validate(semantic, parameters)
        assert not bool(agent["invalid_parameters"]) is expected_valid, agent
        assert not bool(runtime) is expected_valid, runtime


def test_explicit_composite_coordinates_and_unindexed_curve_remain_valid():
    for parameter, value in [
        ({"code": "curve", "type": "array", "value_type": "number"}, [[0, 0], [1, 2]]),
        ({"code": "profile", "dimension": ["site"], "value_type": "array", "leaf_type": "number"}, [[1, 2], [3, 4]]),
        ({"code": "config", "dimension": ["site"], "value_type": "dict", "leaf_type": "number"}, {"B": {"x": 1}, "A": {"y": 2}}),
    ]:
        item = {"key": parameter["code"], **parameter_input_contract(parameter, {"site": ["B", "A"]})}
        assert validate_parameter_input(item, value) is None


def test_real_api_rejects_extra_axis_before_solver_and_accepts_business_mapping(client):
    c = component(client); a = model(client, c); test_publish(client, a)
    previous_count = len(client.get('/api/tasks').json())
    for value in ([[10], [20]], {"0": [10], "1": [20]}):
        response = client.post("/api/tasks", json={"model_id": a, "parameters": {"horizon": 2, "demand": value}, "async_run": False})
        assert response.status_code == 422, response.text
        assert "rank mismatch" in response.text
        synchronous = client.post(f'/api/models/{a}/test', json={'parameters': {'horizon': 2, 'demand': value}})
        assert synchronous.status_code == 422 and 'rank mismatch' in synchronous.text
    assert len(client.get('/api/tasks').json()) == previous_count
    response = client.post("/api/tasks", json={"model_id": a, "parameters": {"horizon": 2, "demand": {"0": 10, "1": 20}}, "async_run": False})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SUCCESS" and response.json()["objective_value"] == pytest.approx(90)
