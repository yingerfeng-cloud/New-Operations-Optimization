import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { expect, test, vi } from 'vitest';
import { ComponentEditor } from '../../features/component-library/ComponentEditor';
import { collectReferences } from '../../features/formula-editor/formulaDsl';
import { parseFormulaDsl } from '../../features/formula-editor/formulaParser';
import { formulaAnalyzePayload } from '../../features/formula-editor/authoritativeCompilation';
import { requestErrorMessage } from '../../api/client';
import { createBlankDraft } from '../../features/model-creation/stores/modelCreationStore';
import { buildComponentSpecFromDraft } from '../../features/model-creation/utils/saveModelDraftAsset';
import type { FormulaDef } from '../../types/formula';
import type { ModelAsset } from '../../types/model';
import { ModelGenericPanel } from '../../features/model-center/ModelAssetPanels';

test('component editor displays JSON defaults and saves numbers, arrays and absent values faithfully', async () => {
  const save = vi.fn();
  const { container } = render(<ComponentEditor component={{ component_id: 'manual_numeric', name: '数值接口', version: '1', status: 'draft',
    parameters: [{ code: 'cap', name: '容量', default: [15, 25] }, { code: 'price', name: '价格', default: 2 }],
  }} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: '参数接口' }));
  const fields = screen.getAllByRole('textbox', { name: '默认值' });
  expect(fields[0]).toHaveValue('[15,25]');
  fireEvent.change(fields[0], { target: { value: '[4,6]' } });
  fireEvent.change(fields[1], { target: { value: '0' } });
  fireEvent.change(screen.getAllByRole('textbox', { name: '示例值' })[0], { target: { value: '' } });
  fireEvent.submit(container.querySelector('#component-editor-form')!);
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0].parameters).toEqual([
    expect.objectContaining({ default: [4, 6], sample_value: undefined }), expect.objectContaining({ default: 0 }),
  ]);
});

test('DSL aliases are free indices and no extra dimension-name scope is invented', () => {
  const symbols = { sets: { time: '时段' }, parameters: { demand: { indices: ['time'] } }, variables: { p: { indices: ['time'] } } };
  const tokens = parseFormulaDsl('p[t] >= demand[t]', symbols);
  const refs = collectReferences(tokens);
  expect(refs.free_indices).toEqual(['t']);
  const formula = { formula_id: 'floor', kind: 'constraint', dsl_formula: 'p[t] >= demand[t]', tokens,
    foreach: ['time'], free_indices: refs.free_indices } as FormulaDef;
  expect(formulaAnalyzePayload(formula, { symbols }).scope).toEqual([{ alias: 't', set: 'time' }]);
});

test('a component input mapped to another code is not an additional required model parameter', () => {
  const draft = createBlankDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.semantic.parameters = [{ code: 'capacity_limit', dimension: ['time'] }];
  draft.components = [{ component_id: 'capacity', definition: { parameters: [{ code: 'max_output', dimension: ['time'] }] },
    parameter_bindings: [{ component_parameter: 'max_output', model_parameter: 'capacity_limit' }] }];
  expect(buildComponentSpecFromDraft(draft).parameters).toEqual([expect.objectContaining({ code: 'capacity_limit' })]);
});

test('literal coordinates have no iterators and shifted coordinates retain their alias', () => {
  const symbols = { sets: { unit: '机组', time: '时段' }, variables: { p: { indices: ['unit', 'time'] } } };
  expect(collectReferences(parseFormulaDsl('p["U1",0] >= 0', symbols)).free_indices).toEqual([]);
  expect(collectReferences(parseFormulaDsl('p[u,t+1] >= p[u,t]', symbols)).free_indices).toEqual(['u', 't']);
});

test('HTTP 422 details expose the failing field and repair suggestion to the test panel', () => {
  const error = new AxiosError('Request failed with status code 422', 'ERR_BAD_REQUEST');
  error.response = { status: 422, statusText: 'Unprocessable Entity', headers: {}, config: {} as never, data: { detail: {
    message: '模型测试失败', errors: [{ field: 'parameter_bindings.max_output', error: '维度不匹配', suggestion: '映射到 time 维度参数' }],
  } } };
  const message = requestErrorMessage(error);
  for (const text of ['模型测试失败', 'parameter_bindings.max_output', '维度不匹配', '映射到 time 维度参数']) expect(message).toContain(text);
});

test('failed solver diagnostics remain visible inside the dry-run response', () => {
  const error = new AxiosError('Request failed with status code 422', 'ERR_BAD_REQUEST');
  error.response = { status: 422, statusText: 'Unprocessable Entity', headers: {}, config: {} as never, data: { detail: {
    message: '模型测试用例执行失败', structure_check: { errors: [] },
    solver_check: { status: 'failed', warnings: ['容量小于需求，模型不可行'] },
  } } };
  expect(requestErrorMessage(error)).toContain('容量小于需求，模型不可行');
});

test('reopened compiled model displays the frozen source of constraints and objective terms', () => {
  const constraint = 'p[t] >= demand[t]';
  const objective = 'sum(cost[t] * p[t] * delta_t for t in time)';
  const { container } = render(<ModelGenericPanel model={{ id: 'saved', generic_spec: {
    formula_artifacts: [{ formula_id: 'floor', normalized_expression: constraint }, { formula_id: 'cost', normalized_expression: objective }],
    constraints: [{ name: '需求', source_formula_id: 'floor', terms: [] }],
    objective: { sense: 'minimize', terms: [{ source_formula_id: 'cost', var: 'p' }] },
  } } as unknown as ModelAsset} />);
  for (const label of screen.getAllByText('原始 DSL')) fireEvent.click(label);
  expect([...container.querySelectorAll('code')].map(node => node.textContent)).toEqual([constraint, objective]);
});
