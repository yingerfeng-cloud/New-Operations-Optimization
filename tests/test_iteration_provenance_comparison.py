from copy import deepcopy
import hashlib
import importlib.metadata
import marshal
from pathlib import Path

import pytest

from app.services.job_service import job_service
from app.services.update_comparison import compare_evidence
from tests.test_iteration_component_bindings import component, model, test_publish, candidate, invoke


def test_actual_environment_record_and_original_environment_boundary(client):
    c = component(client); a = model(client, c); test_publish(client, a)
    solved = invoke(client, a)
    task = client.get(f"/api/tasks/{solved['task_id']}").json()
    environment = task['trace']['execution_environment']
    identity = environment['identity']
    assert identity['packages']['highspy'] == importlib.metadata.version('highspy')
    assert identity['compiler_hashes']['app/builders/component_model_builder.py'] == hashlib.sha256(Path('app/builders/component_model_builder.py').read_bytes()).hexdigest()
    assert identity['solver']['name'] == 'HiGHS'
    assert identity['solver']['adapter_hash'] == hashlib.sha256(Path('app/solvers/highs_adapter.py').read_bytes()).hexdigest()
    assert identity['image_digest'] == 'unknown'
    assert identity['effective_settings']['time_limit'] == 300
    assert identity['solver']['binary_hash'] != 'unknown'
    assert identity['effective_settings']['presolve'].startswith('solver_default')
    from app.solvers.highs_adapter import HiGHSAdapter
    assert identity['loaded_adapter_hashes']['app.solvers.highs_adapter.HiGHSAdapter.solve'] == hashlib.sha256(marshal.dumps(HiGHSAdapter.solve.__code__)).hexdigest()
    strict = client.post(f"/api/tasks/{task['id']}/replay", json={'mode': 'original_environment'})
    assert strict.status_code == 409 and strict.json()['detail']['code'] == 'ORIGINAL_ENVIRONMENT_UNAVAILABLE'
    recalc = client.post(f"/api/tasks/{task['id']}/replay", json={'mode': 'current_kernel'})
    assert recalc.status_code == 200, recalc.text
    current = recalc.json()
    assert current['id'] != task['id'] and current['objective_value'] == pytest.approx(60)
    assert current['trace']['replay_boundary']['mode'] == 'current_kernel'
    assert job_service.get_task(task['id']).result['objective_value'] == pytest.approx(60)
    assert client.post(f"/api/tasks/{task['id']}/replay", json={'mode': 'anything'}).status_code == 422


def test_actual_comparison_reports_decisions_units_bounds_and_residuals(client):
    c1 = component(client); a = model(client, c1); test_publish(client, a)
    c2 = component(client, 1.2, c1)
    updated = candidate(client, a, {c1: c2})
    response = client.get(f'/api/models/{updated}/update-comparison')
    assert response.status_code == 200, response.text
    compared = response.json()
    assert compared['comparable'] is True, compared
    assert compared['objective']['before'] == pytest.approx(60)
    assert compared['objective']['after'] == pytest.approx(72)
    assert compared['residuals'] == {'before': 0, 'after': 0}
    output = [row for row in compared['decisions'] if row['key'].startswith('output[')]
    assert len(output) == 2
    assert {row['key'] for row in output} == {'output[0]', 'output[1]'}
    for row in output:
        assert row['unit'] == 'MW' and row['comparable'] is True
        assert row['before']['value'] == pytest.approx(10)
        assert row['after']['value'] == pytest.approx(12)
        assert row['delta'] == pytest.approx(2)
    assert len(compared['constraints']) == 2
    for row in compared['constraints']:
        assert row['before']['lower'] == pytest.approx(10)
        assert row['after']['lower'] == pytest.approx(12)
        assert row['before']['violation'] == row['after']['violation'] == 0


def test_missing_old_evidence_does_not_invent_improvement(client):
    c1 = component(client); a = model(client, c1); test_publish(client, a)
    from app.storage.memory_store import STORE
    source = STORE.models[a]
    dry = deepcopy(source.dry_run_result); dry['solver_check'].pop('evidence')
    STORE.models[a] = source.model_copy(update={'dry_run_result': dry})
    c2 = component(client, 1.2, c1)
    updated = candidate(client, a, {c1: c2})
    compared = client.get(f'/api/models/{updated}/update-comparison').json()
    assert compared['comparable'] is False
    assert '无可比旧结果' in compared['message']
    assert not compared.get('objective')


def test_declared_business_metric_is_observed_and_compared(client):
    c1 = component(client); a = model(client, c1)
    package = client.get(f'/api/models/{a}').json()
    package['component_spec']['metrics_config'] = {'metrics': [{'key': 'delivered_energy', 'name': '合成供给电量', 'unit': 'MWh', 'expression': 'sum(output[t] for t in time) * delta_t'}]}
    package['parameters']['delta_t'] = 1
    package['semantic_spec']['component_spec'] = deepcopy(package['component_spec'])
    package['model_draft'] = {}
    saved = client.put(f'/api/models/{a}', json=package)
    assert saved.status_code == 200, saved.text
    test_publish(client, a)
    c2 = component(client, 1.2, c1)
    updated = candidate(client, a, {c1: c2})
    response = client.get(f'/api/models/{updated}/update-comparison').json()
    metric = next(row for row in response['metrics'] if row['key'] == 'delivered_energy')
    assert metric['unit'] == 'MWh' and metric['comparable'] is True
    assert metric['before']['value'] == pytest.approx(20)
    assert metric['after']['value'] == pytest.approx(24)
    assert metric['delta'] == pytest.approx(4)


def test_sync_test_settings_are_executed_and_inherited_by_candidate(client):
    c1 = component(client); a = model(client, c1)
    tested = client.post(f'/api/models/{a}/test', json={'parameters': {'horizon': 2, 'demand': [10, 10]},
        'solver_config': {'time_limit': 17, 'initial_values': {'output': 10}}})
    assert tested.status_code == 200, tested.text
    assert tested.json()['last_test_solver_config']['time_limit'] == 17
    observed = tested.json()['dry_run_result']['solver_check']['execution_environment']['identity']
    assert observed['effective_settings']['time_limit'] == 17
    assert client.post(f'/api/models/{a}/publish').status_code == 200
    c2 = component(client, 1.2, c1)
    updated = candidate(client, a, {c1: c2})
    compared = client.get(f'/api/models/{updated}/update-comparison').json()
    assert compared['input_checks']['same_settings'] is True, compared


@pytest.mark.parametrize('change', ['input', 'settings', 'unit', 'definition'])
def test_incomparable_inputs_settings_or_units_never_gain_a_delta(change):
    before = {'business_inputs': {'load': [10]}, 'settings': {'time_limit_seconds': 10},
        'objective': {'value': 10, 'definition': 'x', 'sense': 'min', 'unit': 'weighted'},
        'decisions': [{'key': 'x[0]', 'name': '供给', 'unit': 'MW', 'value': 10, 'definition': {'unit': 'MW', 'dimension': ['time']}}]}
    after = deepcopy(before); after['decisions'][0]['value'] = 12
    if change == 'input': after['business_inputs']['load'] = [20]
    if change == 'settings': after['settings']['time_limit_seconds'] = 30
    if change == 'unit': after['decisions'][0]['unit'] = 'kW'
    if change == 'definition': after['decisions'][0]['definition']['dimension'] = ['station']
    row = compare_evidence(before, after)['decisions'][0]
    assert row['comparable'] is False and row['delta'] is None


def test_qp_miqp_public_capability_and_diagnosis_are_honest(client):
    status = client.get('/api/solvers/status').json()
    assert status['highs']['supported_problem_types'] == ['LP', 'MILP']
    assert {'QP', 'MIQP'} <= set(status['unsupported_problem_types'])
    from app.solvers.solver_router import solver_router
    from app.problem_type_diagnosis import infer_problem_type
    for kind, domain in [('QP', 'Reals'), ('MIQP', 'Integers')]:
        result = infer_problem_type(variables=[{'name': 'x', 'domain': domain}], constraints=[], objective_terms=[{'expression': '(x - 1.3)**2'}])
        assert result['inferred_problem_type'] == kind and result['recommended_solver'] is None
        for solver in (None, 'HiGHS', 'Ipopt'):
            route = solver_router.route(kind, solver)
            assert not route['ok'] and route['error_code'] == 'SOLVER_UNSUPPORTED_PROBLEM_TYPE'
            assert route['recommended_solver'] is None
