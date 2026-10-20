import { expect, test } from 'vitest';
import { parseFormulaDsl } from '../../features/formula-editor/formulaParser';
import { validateFormula } from '../../features/formula-editor/formulaValidator';
import { collectReferences } from '../../features/formula-editor/formulaDsl';

test('two explicit generator axes bind their own aliases without treating i as a parameter', () => {
  const symbols = { sets: { origin: '起点', destination: '终点' },
    parameters: { cost: { indices: ['origin', 'destination'] } },
    variables: { shipment: { indices: ['origin', 'destination'] } } };
  for (const expression of ['sum(cost[i,j] * shipment[i,j] for i in origin for j in destination)',
    'sum(sum(cost[i,j] * shipment[i,j] for j in destination) for i in origin)']) {
    const tokens = parseFormulaDsl(expression, symbols);
    expect(validateFormula(expression, 'objective', tokens, symbols).errors).toEqual([]);
    const refs = collectReferences(tokens);
    expect(refs.referenced_parameters).toEqual(['cost']);
    expect(refs.free_indices).toEqual([]);
    expect(refs.referenced_sets.sort()).toEqual(['destination', 'origin']);
  }
});
