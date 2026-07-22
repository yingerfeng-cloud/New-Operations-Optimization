import { expect, test, type APIRequestContext } from '@playwright/test';

const symbols = {
  sets: { unit: ['U1', 'U2'], time: [0, 1], state_time: [0, 1, 2] },
  parameters: [
    { code: 'load', dimension: ['time'], unit: 'MW', default: [10, 12] },
    { code: 'eta', dimension: [], unit: '1', default: 0.9, positive: true },
    { code: 'delta_t', dimension: [], unit: 'h', default: 1, positive: true },
  ],
  variables: [
    { code: 'power', dimension: ['unit', 'time'], unit: 'MW' },
    { code: 'charge', dimension: ['time'], unit: 'MW' },
    { code: 'soc', dimension: ['state_time'], unit: 'MWh' },
  ],
};

async function analyze(request: APIRequestContext, payload: Record<string, unknown>) {
  const response = await request.post('/api/formulas/expand', { data: { ast_version: '1.0', participation: 'solve_active', symbols, scope: [], ...payload } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('@real real authoritative backend closes linear maximize state preview dimension and bilinear formula gates', async ({ request }) => {
  const linear = await analyze(request, { formula: 'sum(power[u,t] for u in unit) >= load[t]', formula_type: 'constraint', scope: [{ alias: 't', set: 'time' }], formula_id: 'balance' });
  expect(linear.status).toBe('compile_valid');
  expect(linear.estimated_expansion.constraint_count).toBe(2);
  expect(linear.compiled_fragment.constraints[0].source_formula_id).toBe('balance');

  const maximize = await analyze(request, { formula: 'sum(charge[t] for t in time)', formula_type: 'objective', objective_direction: 'maximize' });
  expect(maximize.compiled_fragment.direction).toBe('maximize');

  const state = await analyze(request, { formula: 'soc[t+1] == soc[t] + eta * charge[t] * delta_t', formula_type: 'constraint', scope: [{ alias: 't', set: 'time' }], model_context: { time_dimension: { time_set: 'time', state_time_set: 'state_time' } } });
  expect(state.status).toBe('compile_valid');
  expect(state.compiled_fragment.constraints[0].terms[0].key[0]).toMatchObject({ type: 'index_offset', offset: 1, target_set: 'state_time' });

  const preview = await analyze(request, { formula: 'max(charge[t], load[t])', formula_type: 'objective', objective_direction: 'maximize', participation: 'preview_only', scope: [{ alias: 't', set: 'time' }] });
  expect(preview.status).toBe('preview_only');
  expect(preview.compiled_fragment).toBeNull();

  const invalidDimension = await analyze(request, { formula: 'power[t] <= load[t]', formula_type: 'constraint', scope: [{ alias: 't', set: 'time' }] });
  expect(invalidDimension.status).toBe('compile_failed');
  expect(invalidDimension.diagnostics.some((item: { code: string }) => item.code === 'FORMULA_INDEX_ARITY_MISMATCH')).toBeTruthy();

  const bilinear = await analyze(request, { formula: 'charge[t] * power[u,t] <= load[t]', formula_type: 'constraint', scope: [{ alias: 'u', set: 'unit' }, { alias: 't', set: 'time' }] });
  expect(bilinear.expression_class).toBe('bilinear');
  expect(bilinear.capability.recommended_transformation.type).toBe('mccormick');
  expect(bilinear.compiled_fragment).toBeNull();
  expect(bilinear.compiler_version).toBe('2.0.0');
});
