"""Live HTTP acceptance for the cloud review; synthetic, independently known answers.

Run against an isolated service only. This creates test assets and tasks.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class Acceptance:
    def __init__(self, url, destination):
        self.url, self.destination = url.rstrip('/'), Path(destination)
        self.evidence = {"synthetic": True, "linear_tolerance": 1e-6, "nlp_tolerance": 1e-3, "cases": []}

    def call(self, method, path, data=None, expected=200):
        request = Request(self.url + path, data=None if data is None else json.dumps(data).encode(), method=method,
                          headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=3) as response:
                code, body = response.status, json.load(response)
        except HTTPError as error:
            code, body = error.code, json.load(error)
        assert code == expected, (method, path, code, body)
        return body

    def wait(self, task, seconds=30):
        deadline = time.monotonic() + seconds
        while task['status'] in {'PENDING', 'QUEUED', 'RUNNING', 'VALIDATING', 'BUILDING_MODEL', 'SOLVING', 'FORMATTING_RESULT'}:
            assert time.monotonic() < deadline, task
            time.sleep(.05)
            task = self.call('GET', '/api/tasks/' + task['id'])
        return task

    def record(self, label, task, expected=None):
        row = {"case": label, "task": task}
        self.evidence['cases'].append(row)
        self.destination.parent.mkdir(parents=True, exist_ok=True)
        self.destination.write_text(json.dumps(self.evidence, ensure_ascii=False, indent=2))
        if expected is not None:
            assert task['status'] == 'SUCCESS', task
            result = self.call('GET', '/api/tasks/' + task['id'] + '/result')
            assert abs(result['objective_value'] - expected) < (1e-3 if result.get('solver_type') == 'NLP' else 1e-6), result
            row.update(expected=expected, result=result)
        self.destination.parent.mkdir(parents=True, exist_ok=True)
        self.destination.write_text(json.dumps(self.evidence, ensure_ascii=False, indent=2))
        print(label, task['id'], task['status'], task.get('objective_value'), flush=True)
        return row

    def copy_template(self, code, parameters, *, delta=1, horizon=None):
        original = self.call('GET', '/api/models/MODEL-POWER-' + code.upper().replace('_', '-'))
        asset = self.call('POST', '/api/models/' + original['id'] + '/copy', {})
        asset['name'] = 'synthetic cloud ' + code
        asset['parameters'].update(parameters)
        asset['semantic_spec']['sample_runtime_parameters'] = deepcopy(asset['parameters'])
        config = deepcopy(asset['ui_metadata']['time_dimension'])
        config.update(interval_minutes=60 * delta, delta_t=delta)
        if horizon is not None:
            config.update(policy='runtime_variable', editable=True, default_horizon=horizon, max_horizon=max(8192, horizon))
        asset['ui_metadata']['time_dimension'] = config
        asset['model_draft']['time_dimension'] = deepcopy(config)
        if horizon is not None:
            for rows in (asset['semantic_spec'].get('sets') or [], asset['model_draft'].get('semantic', {}).get('sets') or [], asset.get('component_spec', {}).get('sets') or []):
                for row in rows:
                    if row.get('code') == config.get('time_set', 'time'):
                        row.update(values=list(range(horizon)), members=list(range(horizon)), horizon=horizon, defaultSize=horizon,
                                   time_granularity=60 * delta, delta_t=delta)
                    elif row.get('type') == 'state_time' or row.get('dimensionType') == 'state_time' or config.get('state_time_set') and row.get('code') == config['state_time_set']:
                        row.update(values=list(range(horizon + 1)), members=list(range(horizon + 1)), horizon=horizon + 1, defaultSize=horizon + 1)
        asset['model_draft']['runtime_parameters'] = deepcopy(asset['parameters'])
        asset['semantic_spec'].setdefault('ui_metadata', {})['time_dimension'] = deepcopy(config)
        if asset.get('component_spec'):
            asset['component_spec'].setdefault('ui_metadata', {})['time_dimension'] = deepcopy(config)
        for source in (asset['parameters'], asset['model_draft']['runtime_parameters'], asset['semantic_spec']['sample_runtime_parameters']):
            source.update(delta_t=delta, interval_minutes=60 * delta)
        return self.call('PUT', '/api/models/' + asset['id'], asset)

    def test_publish(self, asset, parameters, expected, settings=None):
        task = self.wait(self.call('POST', '/api/models/' + asset['id'] + '/test-jobs', {'parameters': parameters, 'solver_config': settings or {}}), 120)
        self.record('editor-test-' + asset['id'], task, expected)
        published = self.call('POST', '/api/models/' + asset['id'] + '/publish', {})
        task = self.wait(self.call('POST', '/api/tasks', {'model_code': published['template_id'], 'parameters': parameters, 'solver': 'auto', 'solver_config': settings or {}}), 120)
        self.record('formal-service-' + asset['id'], task, expected)
        return published, task

    def linear(self):
        params = {'unit': ['U1', 'U2', 'U3'], 'horizon': 4, 'load_forecast': [50, 80, 100, 40],
                  'unit_min_output': {'U1': 0, 'U2': 0, 'U3': 0}, 'unit_max_output': {'U1': 60, 'U2': 60, 'U3': 60},
                  'fuel_cost': {'U1': 10, 'U2': 20, 'U3': 30}}
        durations = []
        with ThreadPoolExecutor(2) as pool:
            def submit():
                return self.call('POST', '/api/tasks', {'model_id': 'MODEL-POWER-ECONOMIC-DISPATCH', 'parameters': params})
            tasks = [future.result() for future in [pool.submit(submit), pool.submit(submit)]]
        deadline = time.monotonic() + 30
        pending = {task['id'] for task in tasks}
        while pending:
            assert time.monotonic() < deadline, pending
            for task_id in list(pending):
                start = time.monotonic()
                task = self.call('GET', '/api/tasks/' + task_id)
                durations.append(time.monotonic() - start)
                if task['status'] in {'SUCCESS', 'FAILED', 'TIMEOUT', 'INFEASIBLE'}:
                    self.record('concurrent-ED', task, 3300)
                    pending.remove(task_id)
            time.sleep(.03)
        assert max(durations) < 2, durations
        self.evidence['query_max_seconds'] = max(durations)
        half = self.copy_template('economic_dispatch', params, delta=.5)
        self.test_publish(half, params, 1650)
        uc = {'unit': ['U1', 'U2', 'U3'], 'horizon': 1, 'load_forecast': [20], 'renewable_forecast': [0],
              'unit_min_output': {'U1': 0, 'U2': 0, 'U3': 0}, 'unit_max_output': {'U1': 20, 'U2': 20, 'U3': 0},
              'fuel_cost': {'U1': 10, 'U2': 40, 'U3': 100}, 'startup_cost': {'U1': 500, 'U2': 100, 'U3': 0},
              'initial_unit_status': {'U1': 0, 'U2': 0, 'U3': 0}, 'initial_unit_output': {'U1': 0, 'U2': 0, 'U3': 0}, 'reserve_ratio': 0}
        for delta, expected, chosen in ((.25, 300, 'U2'), (.5, 500, 'U2'), (1, 700, 'U1')):
            model = self.copy_template('unit_commitment_day_ahead', uc, delta=delta, horizon=1)
            _, task = self.test_publish(model, uc, expected)
            result = self.call('GET', '/api/tasks/' + task['id'] + '/result')
            assert abs(result['variable_values']['unit_output'][f'unit_output[{chosen},0]'] - 20) < 1e-6
            costs = result['business_output']['cost_breakdown']
            assert abs(costs['fuel_cost'] + costs['startup_cost'] - expected) < 1e-6
        bad = self.call('POST', '/api/tasks', {'model_id': 'MODEL-POWER-ECONOMIC-DISPATCH', 'parameters': {**params, 'load_forecast': [50, 'not-a-number', 100, 40]}}, expected=422)
        assert 'load_forecast[1]' in json.dumps(bad)
        self.evidence['invalid_csv'] = bad
        self.destination.write_text(json.dumps(self.evidence, ensure_ascii=False, indent=2))

    def nonlinear(self):
        params = {'horizon': 3, 'k': 2, 'flow_min': 1, 'flow_max': 5, 'head_min': 1, 'head_max': 10, 'power_max': 25}
        model = self.copy_template('nonlinear_hydro_power_demo', params)
        self.evidence['nlp_model_id'] = model['id']
        settings = {'time_limit': 20, 'max_iter': 500, 'nlp_tolerance': 1e-7, 'initial_values': {'flow': 2.5, 'head': 5}}
        published, task = self.test_publish(model, params, 75, settings)
        assert task['solver'] == 'Ipopt'
        result = self.call('GET', '/api/tasks/' + task['id'] + '/result')
        values = result['variable_values']
        for t in range(3):
            q, h, p = (values[name][f'{name}[{t}]'] for name in ('flow', 'head', 'power'))
            assert 1 - 1e-3 <= q <= 5 + 1e-3 and 1 - 1e-3 <= h <= 10 + 1e-3 and -1e-3 <= p <= 25 + 1e-3
            assert abs(p - 2 * q * h) < 1e-3
        assert abs(sum(values['power'].values()) - 75) < 1e-3  # Achievable per-period upper bound.
        zero = self.wait(self.call('POST', '/api/tasks', {'model_id': model['id'], 'parameters': {**params, 'k': 0}, 'solver': 'auto'}))
        self.record('NLP-k-zero-is-LP', zero, 0)
        assert zero['solver'] == 'HiGHS'
        invalid = self.wait(self.call('POST', '/api/tasks', {'model_id': model['id'], 'parameters': params, 'solver_config': {**settings, 'initial_values': {'flow': 0}}}))
        self.record('NLP-out-of-bound-initial', invalid)
        assert invalid['status'] == 'FAILED' and '超出变量边界' in invalid['error']
        timeout = self.wait(self.call('POST', '/api/tasks', {'model_id': model['id'], 'parameters': params, 'solver_config': {**settings, 'time_limit': .001}}))
        self.record('NLP-CPU-timeout', timeout)
        assert timeout['status'] == 'TIMEOUT', timeout
        recovery = self.wait(self.call('POST', '/api/tasks', {'model_id': model['id'], 'parameters': params, 'solver_config': settings}))
        self.record('NLP-new-call-recovery', recovery, 75)

    def physical(self):
        model = self.copy_template('renewable_storage_dispatch', {
            'site': ['PV1'], 'storage': ['B1'], 'horizon': 1, 'renewable_forecast': {'PV1': [10]},
            'load_forecast': [0], 'electricity_price': [0], 'grid_export_limit': [0],
            'storage_capacity': {'B1': 10}, 'initial_soc': {'B1': 10},
            'charge_power_max': {'B1': 10}, 'discharge_power_max': {'B1': 10}}, horizon=1)
        _, task = self.test_publish(model, model['parameters'], 10000)
        result = self.call('GET', '/api/tasks/' + task['id'] + '/result')
        for name in ('storage_charge', 'storage_discharge'):
            assert all(abs(value) < 1e-6 for value in result['variable_values'][name].values())
        model = self.copy_template('pv_storage_day_ahead_dispatch', {
            'horizon': 2, 'time': [0, 1], 'time_volume': [0, 1, 2],
            'pv_forecast': [10, 0], 'price': [0, 10], 'schedule': [0, 10], 'grid_limit': [0, 10],
            'eta_ch': 1, 'eta_dis': 1, 'initial_soc': 0, 'terminal_time': 2, 'terminal_soc_target': 0,
            'storage_power_capacity': 10, 'storage_energy_capacity': 10, 'soc_min': 0, 'soc_max': 1,
            'storage_cycle_cost': 0, 'degradation_cost_yuan_per_mwh': 0, 'curtailment_penalty': 1000,
            'weights': {'energy_revenue': 1, 'curtailment_cost': 1, 'schedule_tracking': 1, 'storage_terminal_soc': 1}}, delta=.25, horizon=2)
        _, task = self.test_publish(model, model['parameters'], -25)
        result = self.call('GET', '/api/tasks/' + task['id'] + '/result')
        for key in ('storage_charge_energy', 'storage_discharge_energy'):
            assert abs(result['metrics'][key] - 2.5) < 1e-6
        assert abs(result['variable_values']['soc']['soc[1]'] - 2.5) < 1e-6


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--nlp', action='store_true')
    parser.add_argument('--physical', action='store_true')
    args = parser.parse_args()
    acceptance = Acceptance(args.url, args.output)
    acceptance.nonlinear() if args.nlp else acceptance.physical() if args.physical else acceptance.linear()
