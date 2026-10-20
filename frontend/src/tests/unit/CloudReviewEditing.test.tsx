import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ComponentEditor } from '../../features/component-library/ComponentEditor';
import type { ComponentDef } from '../../types/component';
import { normalizeTimeDimensionConfig } from '../../features/model-creation/utils/timeDimensionDraft';
import { isTaskRetryable, isTaskFailed, isTaskTerminal } from '../../features/task-center/taskStatus';
import { requiredRuntimeValueError } from '../../features/task-create/utils/runtimeParameterGroups';

test('renaming a component preserves unvisited formula, variable and parameter sections', async () => {
  const constraints = [1, 2, 3].map(index => ({ constraint_id: `c${index}`, expression: `production[t] >= ${index}`, indices: [{ set: 'time', alias: 't' }] }));
  const component: ComponentDef = { component_id: 'cloud_preserve', name: 'original', display_name: 'original', status: 'draft', version: '1',
    parameters: [{ code: 'capacity', unit: 'MW' }], variables: [{ code: 'production', indices: ['time'] }],
    required_sets: [{ code: 'time' }], generated_constraints: constraints, dependencies: [], depends_on: [] };
  const saved = vi.fn();
  render(<ComponentEditor component={component} availableComponents={[]} onSave={saved} />);
  fireEvent.change(screen.getByLabelText('展示名称'), { target: { value: 'renamed' } });
  fireEvent.submit(document.getElementById('component-editor-form')!);
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const output = saved.mock.calls[0][0];
  expect(output.display_name).toBe('renamed');
  expect(output.parameters).toEqual(component.parameters);
  expect(output.variables).toEqual(component.variables);
  expect(output.generated_constraints.map((row: Record<string, unknown>) => row.expression)).toEqual(constraints.map(row => row.expression));
  expect(output.constraints).toEqual(output.generated_constraints);
});

test('null duration derives from minutes and candidate mode stays stable after JSON reload', () => {
  expect(normalizeTimeDimensionConfig({ enabled: true, policy: 'fixed', interval_minutes: 60, delta_t: null }).delta_t).toBe(1);
  const first = normalizeTimeDimensionConfig({ enabled: true, policy: 'runtime_variable', allowed_horizons: [4, 8], default_horizon: 4,
    interval_minutes: 60, delta_t: 1, interval_minutes_by_horizon: { 4: 60, 8: 30 }, delta_t_by_horizon: { 4: 1, 8: .5 } });
  const reopened = normalizeTimeDimensionConfig(JSON.parse(JSON.stringify(first)));
  expect(reopened).toEqual(first);
  expect(reopened.interval_minutes).toBeUndefined();
  expect(reopened.delta_t).toBeUndefined();
});

test('retry controls follow the backend terminal-state contract', () => {
  expect(isTaskRetryable('INFEASIBLE')).toBe(false);
  for (const status of ['FAILED', 'TIMEOUT', 'CANCELLED', 'INTERRUPTED']) expect(isTaskRetryable(status)).toBe(true);
  expect(isTaskFailed('INTERRUPTED')).toBe(true);
  expect(isTaskTerminal('INTERRUPTED')).toBe(true);
});

test('CSV numeric leaf is rejected without changing zero or business member inputs', () => {
  const field = { code: 'load_forecast', name: 'load', required: true, dimension: ['time'], valueType: 'number' };
  expect(requiredRuntimeValueError(field, [50, 'not-a-number', 100, 40])).toContain('load_forecast[1]');
  expect(requiredRuntimeValueError(field, [50, 0, 100, 40])).toBe('');
  expect(requiredRuntimeValueError({ ...field, role: 'set_members', valueType: 'string' }, ['A', 'B'])).toBe('');
});
