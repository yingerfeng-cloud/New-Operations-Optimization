from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.explainers.evidence_builder import evidence_builder
from app.services.invocation_service import invocation_service
from app.services.model_service import model_service
from app.services.result_interpreter import result_interpreter
from app.services.result_post_processor import result_post_processor
from app.services.skill_definition_service import skill_definition_service
from app.services.skill_registry import skill_registry
from app.storage.memory_store import STORE
from app.variable_contract import normalize_variables


@pytest.mark.parametrize('summary', [
    '储能在低价时段充电、高价时段放电，实现峰谷套利。',
    '系统已生成满足功率平衡、爬坡和备用要求的日前机组组合计划。',
    '梯级水电调度优化已完成，总弃水量 1.25 百万立方米。',
])
def test_formatter_summary_is_grounded_and_survives_reprocessing(summary):
    model = {'id': 'summary-test', 'variables': [], 'metrics_config': {'metrics': [{'key': 'spill', 'name': '弃水量', 'unit': '百万立方米'}]}}
    processed = result_post_processor.process(result={'status': 'SUCCESS', 'objective_value': 2, 'metrics': {'spill': 1.25}, 'business_explanation': {'summary': summary}}, model=model)
    assert summary in processed['explanation_structured']['summary']
    assert processed['business_explanation'] == processed['explanation_structured']
    assert result_interpreter.interpret(model, processed)['explanation'] == processed['explanation_structured']['summary']
    formatter = processed['evidence_package']['formatter']
    assert formatter['source'] == 'SolveResultFormatter'
    assert formatter['metrics']['spill']['unit'] == '百万立方米'
    assert processed['explanation_structured']['fact_items'][0]['evidence_refs'] == ['formatter.summary', 'formatter.metrics']
    assert processed['explanation_audit']
    assert processed['requires_human_review'] is True
    again = result_post_processor.process(result=processed, model=model)
    assert again['evidence_package']['formatter'] == formatter
    assert again['explanation_structured']['summary'] == processed['explanation_structured']['summary']
    for status in ['FAILED', 'INFEASIBLE']:
        failed = result_post_processor.process(result={**processed, 'status': status}, model=model)
        assert summary not in failed['explanation_structured']['summary']
        assert failed['evidence_package']['formatter'] == {}


@pytest.mark.parametrize('identifier', ['math_var', 'code', 'key', 'name'])
@pytest.mark.parametrize('dimension_field', ['dimension', 'dimensions', 'indices', 'index_sets'])
def test_variable_identity_and_dimensions_agree_everywhere(identifier, dimension_field):
    variable = {identifier: 'water', dimension_field: ['station', 'time'], 'unit': '百万立方米'}
    model = SimpleNamespace(id='variable-test', version='1', semantic_spec={'variables': [variable]})
    output = invocation_service.output_schema(model.semantic_spec)
    definition = skill_definition_service.compile(model=model, skill_name='run_variable_test', input_schema=[], output_schema=output)
    assert definition['validation']['status'] == 'valid'
    assert output['variables'][0]['key'] == 'water'
    assert output['variables'][0]['dimension'] == ['station', 'time']
    assert definition['explanation_spec']['variables'][0]['key'] == 'water'
    assert definition['explanation_spec']['variables'][0]['dimensions'] == ['station', 'time']
    assert any(metric['source'] == {'kind': 'variable', 'key': 'water'} for metric in definition['explanation_spec']['metrics'])
    evidence = evidence_builder.build(result={'status': 'SUCCESS', 'variable_values': {'water': {'water[S1,0]': 1}}}, model=model, skill_name='run_variable_test', skill_definition=definition)
    assert evidence['variables_summary'][0]['dimension'] == ['station', 'time']


@pytest.mark.parametrize('variables', [
    [{'name': 'water'}, {'code': 'water'}],
    [{'math_var': 'water', 'key': 'power'}],
    [{'name': 'water', 'indices': ['station'], 'dimensions': ['time']}],
])
def test_conflicting_variable_contracts_are_rejected(variables):
    with pytest.raises(ValueError):
        normalize_variables(variables)


def test_custom_hydro_skill_does_not_overwrite_default_skill():
    model_service.seed_default_templates()
    model_id = 'MODEL-POWER-CASCADE-HYDRO-DISPATCH'
    default = deepcopy(STORE.skills['run_cascade_hydro_dispatch'])
    model = model_service.get_model(model_id)
    custom = model.model_copy(deep=True, update={'id': 'MODEL-CUSTOM-HYDRO-REVIEW', 'model_code': 'custom_hydro_review', 'template_id': 'custom_hydro_review', 'name': '自定义水电复核', 'semantic_spec': {**deepcopy(model.semantic_spec), 'model_code': 'custom_hydro_review', 'skill_code': 'custom_hydro_review'}})
    with STORE.lock:
        STORE.models[custom.id] = custom
    generated = skill_registry.generate_skill(custom.id)
    assert generated['definition_validation']['status'] == 'valid'
    assert generated['skill_name'] == 'run_custom_hydro_review'
    assert STORE.skills['run_cascade_hydro_dispatch'] == default


def test_sync_and_async_invocation_use_the_same_grounded_summary():
    model_service.seed_default_templates()
    model = model_service.get_model('MODEL-POWER-STORAGE-DISPATCH')
    body = {'parameters': deepcopy(model.parameters)}
    sync = invocation_service.invoke_model(model.id, body)
    submitted = invocation_service.invoke_model(model.id, {**body, 'options': {'mode': 'async'}})
    refreshed = invocation_service.get_invocation(submitted['invocation_id'])['response']
    assert sync['status'] == refreshed['status'] == 'SUCCESS'
    assert sync['explanation'] == refreshed['explanation']
    assert '储能' in sync['explanation']
    for key in ('business_explanation', 'explanation_structured', 'execution_policy', 'requires_human_review', 'profile_name', 'disclaimer'):
        assert sync[key] == refreshed[key]
    for response in (sync, refreshed):
        assert response['explanation'] == response['explanation_structured']['summary']
        assert response['evidence_package']['formatter']['summary']
        assert response['explanation_audit']
        assert response['requires_human_review'] is True


def test_business_outcomes_are_measured_and_shared_with_summary():
    model = {'id': 'commitment-evidence', 'variables': [
        {'code': 'unit_output', 'dimension': ['unit', 'time'], 'unit': 'MW'},
        {'code': 'unit_on', 'dimension': ['unit', 'time']},
        {'code': 'unit_startup', 'dimension': ['unit', 'time']},
    ]}
    result = {'status': 'SUCCESS', 'objective_value': 15, 'business_explanation': {'summary': '机组组合调度已完成。'}, 'variable_values': {
        'unit_output': {'U1,0': 80, 'U2,0': 20},
        'unit_on': {'U1,0': 1, 'U2,0': 1},
        'unit_startup': {'U1,0': 1, 'U2,0': 0},
    }}
    processed = result_post_processor.process(result=result, model=model)
    outcomes = processed['evidence_package']['business_outcomes']
    assert outcomes['unit_output']['leading_unit'] == 'U1'
    assert outcomes['unit_output']['total_output'] == 100
    assert outcomes['unit_commitment']['startup_count'] == 1
    assert outcomes['unit_commitment']['online_units'] == ['U1', 'U2']
    assert 'U1' in processed['explanation_structured']['summary']
    assert '启停计划' in processed['explanation_structured']['summary']
    assert result_interpreter.interpret(model, processed)['explanation'] == processed['explanation_structured']['summary']
    failed = result_post_processor.process(result={**processed, 'status': 'INFEASIBLE'}, model=model)
    assert failed['evidence_package']['business_outcomes'] == {}
    assert '启停计划' not in failed['explanation_structured']['summary']
