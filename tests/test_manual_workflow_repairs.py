"""Manual-reported regressions through public APIs and the real HiGHS engine."""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.formulas.service import analyze_formula
from app.schemas.formula import FormulaAnalyzeRequest


def formula(identifier, kind, expression, **extra):
    return {"formula_id": identifier, "name": identifier, "kind": kind, "dsl_formula": expression,
            "solve_participation": "solve_active", "compile_status": "compile_valid",
            **({"objective_direction": "minimize", "weight": 1} if kind == "objective" else {}), **extra}


def package(components, parameters, variables, values, formulas=None):
    code = "manual_repair_" + uuid4().hex[:8]
    sets = [{"code": "time", "name": "时段", "values": [0, 1]}]
    semantic = {"sets": sets, "parameters": parameters, "variables": variables}
    draft = {"basic_info": {"name": code, "scenario": "经济负荷分配", "model_code": code, "builder_mode": "component_based", "solver": "HiGHS"},
             "semantic": deepcopy(semantic), "components": components, "runtime_parameters": values,
             "formulas": formulas or [], "objective": {"sense": "minimize", "terms": []},
             "advanced": {"component_spec": {}}}
    return {"name": code, "template_id": code, "scene": "经济负荷分配", "build_mode": "component_based", "solver": "HiGHS",
            "semantic_spec": semantic, "component_spec": {"components": components, "objective": {"sense": "minimize", "terms": []}},
            "model_draft": draft, "parameters": values}


def solve_publish(client, payload, expected):
    created = client.post('/api/models', json=payload)
    assert created.status_code == 200, created.text
    identifier = created.json()['id']
    tested = client.post(f'/api/models/{identifier}/test-jobs', json={"idempotency_key": uuid4().hex})
    assert tested.status_code == 200, tested.text
    task = tested.json()
    assert task['status'] == 'SUCCESS', task
    result = client.get(f"/api/tasks/{task['id']}/result").json()
    assert result['objective_value'] == pytest.approx(expected), result
    published = client.post(f'/api/models/{identifier}/publish')
    assert published.status_code == 200, published.text
    reopened = client.get(f'/api/models/{identifier}').json()
    assert reopened['status'] == 'published'
    assert reopened['tested_content_hash'] == reopened['content_hash']
    return identifier, task, result


def test_component_editor_numeric_defaults_bound_aliases_and_variable_bounds(client):
    cid = 'manual_cost_' + uuid4().hex[:8]
    definition = {"component_id": cid, "name": "容量与费用", "version": "1.0.0",
        "required_sets": [{"code": "time", "name": "时段"}],
        "parameters": [{"code": "max_output", "dimension": ["time"], "default": [15, 25]},
                       {"code": "unit_cost", "default": 2}, {"code": "period_hours", "default": .5}],
        "variables": [{"code": "p", "dimension": ["time"]}],
        "constraints": [{"constraint_id": "cap", "indices": ["time"], "expression": "p[t] <= max_output[t]", "solve_participation": "solve_active"}],
        "objective_terms": [{"term_id": "cost", "expression": "sum(unit_cost * p[t] * period_hours for t in time)", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": False}]}
    r = client.post('/api/components/catalog', json=definition)
    assert r.status_code == 200, r.text
    r = client.post(f'/api/components/{cid}/publish')
    assert r.status_code == 200, r.text
    definition = r.json()
    assert definition['generated_objective_terms'][0]['supported_by_backend'] is True
    bindings = [{"component_parameter": source, "model_parameter": target, "status": "bound"}
                for source, target in [('max_output', 'capacity_limit'), ('unit_cost', 'tariff'), ('period_hours', 'duration')]]
    components = [{"type": cid, "component_id": cid, "version": "1.0.0", "definition": definition,
                   "generated_constraints": definition['generated_constraints'], "generated_objective_terms": definition['generated_objective_terms'],
                   "parameter_bindings": bindings}]
    payload = package(components, [{"code": "capacity_limit", "name": "容量", "dimension": ["time"]}, {"code": "tariff", "name": "费用"}, {"code": "duration", "name": "时长"}],
                      [{"code": "p", "name": "功率", "dimension": ["time"], "lowerBound": "10", "upperBound": "100"}],
                      {"horizon": 2, "capacity_limit": [15, 25], "tariff": 2, "duration": .5})
    mid, _, result = solve_publish(client, payload, 20)
    assert list(result['variable_values']['p'].values()) == [10, 10]
    view = client.get(f'/api/models/{mid}').json()
    assert 'max_output' not in {item['code'] for item in view['semantic_spec']['parameters']}


def curve_payload(client):
    fid = 'manual_curve_' + uuid4().hex[:8]
    r = client.post('/api/function-assets', json={"function_id": fid, "name": "费用曲线", "points": [[0, 0], [10, 20], [20, 60]], "solve_strategy": "segment_binary"})
    assert r.status_code == 200, r.text
    components = [{"type": "function_mapping_component", "component_id": "function_mapping_component", "function_asset_id": fid,
                   "x": "p[t]", "y": "fee[t]", "indices": [{"set": "time", "alias": "t"}], "solve_strategy": "segment_binary", "constraint_id": "cost_curve"}]
    formulas = [formula('demand_floor', 'constraint', 'p[t] >= demand[t]', scope=[{"alias": "time", "set": "time"}, {"alias": "t", "set": "time"}]),
                formula('curve_cost', 'objective', 'sum(fee[t] * delta_t for t in time)')]
    payload = package(components, [{"code": "demand", "name": "需求", "dimension": ["time"]}, {"code": "delta_t", "name": "时长", "default": .5}],
                      [{"code": "p", "name": "出力", "dimension": ["time"], "lowerBound": "0", "upperBound": "20"},
                       {"code": "fee", "name": "费用率", "dimension": ["time"], "lowerBound": "0", "upperBound": "100"}],
                      {"horizon": 2, "demand": [10, 20], "delta_t": .5}, formulas)
    return fid, payload


def test_builder_transition_formulas_curve_goal_and_publish_are_consistent(client):
    _, payload = curve_payload(client)
    mid, task, result = solve_publish(client, payload, 40)
    assert list(result['variable_values']['p'].values()) == [10, 20]
    assert list(result['variable_values']['fee'].values()) == [20, 60]
    view = client.get(f'/api/models/{mid}').json()
    assert len(view['component_spec']['model_formula_constraints']) == 1
    assert view['component_spec']['model_formula_constraints'][0]['indices'] == [{"alias": "t", "set": "time"}]
    invoked = client.post(f'/api/models/{mid}/invoke', json={"parameters": {"demand": [10, 20], "delta_t": .5}, "options": {"mode": "sync"}})
    assert invoked.status_code == 200, invoked.text
    assert invoked.json()['objective_value'] == 40


def test_model_formula_failure_is_not_silently_dropped(client):
    _, payload = curve_payload(client)
    payload['model_draft']['formulas'][0]['dsl_formula'] = 'p[t] >= undefined_demand[t]'
    created = client.post('/api/models', json=payload)
    assert created.status_code == 200, created.text  # Invalid drafts remain editable.
    mid = created.json()['id']
    tested = client.post(f'/api/models/{mid}/test-jobs', json={"idempotency_key": uuid4().hex})
    assert tested.status_code == 422 or tested.json().get('status') == 'FAILED', tested.text
    assert 'undefined_demand' in tested.text
    assert client.post(f'/api/models/{mid}/publish').status_code in {409, 422}


def test_expansion_removes_only_redundant_dimension_alias():
    symbols = {"sets": {"time": {"values": [0, 1]}}, "parameters": [{"code": "demand", "dimension": ["time"]}],
               "variables": [{"code": "p", "dimension": ["time"]}]}
    result = analyze_formula(FormulaAnalyzeRequest(formula='p[t] >= demand[t]', symbols=symbols,
        scope=[{"alias": "time", "set": "time"}, {"alias": "t", "set": "time"}]), compile_requested=True, expand_requested=True)
    assert result['status'] == 'compile_valid'
    assert result['scope'] == [{"alias": "t", "set": "time"}]
    assert result['estimated_expansion']['constraint_count'] == 2
    symbols['variables'] = [{"code": "p", "dimension": ["time", "time"]}]
    result = analyze_formula(FormulaAnalyzeRequest(formula='p[i,j] >= 0', symbols=symbols,
        scope=[{"alias": "i", "set": "time"}, {"alias": "j", "set": "time"}]), compile_requested=True, expand_requested=True)
    assert result['status'] == 'compile_valid'
    assert result['estimated_expansion']['constraint_count'] == 4


def test_saved_foreach_alias_is_resolved_through_compiled_scope(client):
    _, payload = curve_payload(client)
    source = payload['model_draft']['formulas'][0]
    source.update(scope=[{"alias": "t", "set": "time"}], foreach=["t"], free_indices=["t"])
    _, _, result = solve_publish(client, payload, 40)
    assert list(result['variable_values']['p'].values()) == [10, 20]
