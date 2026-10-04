from copy import deepcopy

from app.agent.parameter_contract import infer_parameter_dimensions, validate_business_semantics
from app.agent.schema_parameter_analyzer import schema_parameter_analyzer
from app.services.invocation_service import invocation_service


def schema(policy):
    return invocation_service.input_schema({
        'sets': [{'code': 'time', 'values': [0, 1, 2]}],
        'parameters': [{'code': 'electricity_price', 'dimension': ['time'], 'validation': {'type': 'array'}}],
        'ui_metadata': {'time_dimension': {'enabled': True, 'policy': policy, 'default_horizon': 3, 'time_set': 'time', 'derive_from': ['electricity_price']}},
    })


def test_fixed_time_contract_cannot_be_shortened_by_data():
    analysis = schema_parameter_analyzer.analyze(schema('fixed'), {'electricity_price': [1, 2]})
    assert analysis['invalid_parameters'][0]['expected'] == 3
    assert analysis['invalid_parameters'][0]['actual'] == 2
    assert analysis['ready'] is False


def test_runtime_variable_and_data_derived_time_lengths_can_adjust():
    for policy in ('runtime_variable', 'data_derived'):
        analysis = schema_parameter_analyzer.analyze(schema(policy), {'electricity_price': [1, 2]})
        assert analysis['ready'] is True
        assert analysis['normalized_parameters']['horizon'] == 2


def test_explicit_horizon_and_time_are_never_silently_overwritten():
    for policy in ('fixed', 'runtime_variable', 'data_derived'):
        supplied = {'electricity_price': [1, 2], 'horizon': 3, 'time': [0, 1, 2]}
        inferred = infer_parameter_dimensions(supplied, schema(policy))
        assert inferred['horizon'] == 3
        assert inferred['time'] == [0, 1, 2]
        assert schema_parameter_analyzer.analyze(schema(policy), supplied)['invalid_parameters']


def test_unit_commitment_respects_offline_initial_output_and_capacity():
    params = {'load_forecast': [10], 'unit_min_output': {'U1': 50, 'U2': 30}, 'unit_max_output': {'U1': 100, 'U2': 80}, 'initial_unit_status': {'U1': 1, 'U2': 0}, 'initial_unit_output': {'U1': 50, 'U2': 0}}
    assert validate_business_semantics(params) == []
    invalid = deepcopy(params)
    invalid['initial_unit_output']['U1'] = 20
    assert any(error['code'] == 'INITIAL_OUTPUT_OUT_OF_BOUNDS' for error in validate_business_semantics(invalid))
    economic = {key: value for key, value in params.items() if key != 'initial_unit_status'}
    assert any(error['code'] == 'LOAD_OUTSIDE_CAPACITY' for error in validate_business_semantics(economic))
