import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Modal } from 'antd';
import { useState } from 'react';
import { beforeEach, vi } from 'vitest';
import { Step3MathExpansion } from '../../features/model-creation/steps/Step3MathExpansion';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';
import { renderWithQueryClient } from '../testUtils';
import type { FormulaDef } from '../../types/formula';

const formula = (kind: 'constraint' | 'objective', dsl: string, foreach: string[] = []): FormulaDef => ({
  formula_id: dsl,
  name: dsl,
  kind,
  display_formula: dsl,
  dsl_formula: dsl,
  tokens: [],
  foreach,
  referenced_sets: [],
  referenced_parameters: [],
  referenced_variables: [],
  free_indices: foreach,
  compile_status: 'ready',
});

vi.mock('../../api/functionAssets', () => ({
  getFunctionAssets: async () => [
    {
      function_id: 'curve_storage_level',
      name: '水位库容曲线',
      function_type: 'piecewise_1d',
      validation_status: 'valid',
      validation_errors: [],
      points: [[0, 0], [10, 10]],
      domain: { x_min: 0, x_max: 10 },
      solve_strategy: 'convex_combination_lp',
    },
    {
      function_id: 'bad_curve',
      name: '异常曲线',
      function_type: 'piecewise_1d',
      validation_status: 'invalid',
      validation_errors: [{ message: 'x must be strictly increasing' }],
      points: [[0, 0], [0, 1]],
      solve_strategy: 'convex_combination_lp',
    },
    {
      function_id: 'hydro_power_surface_001',
      name: '水电出力曲面',
      function_type: 'piecewise_2d',
      validation_status: 'valid',
      validation_errors: [],
      points: [],
      points_2d: [[0, 0, 1], [10, 0, 21], [0, 10, 31], [10, 10, 51]],
      triangles: [[0, 1, 2], [1, 3, 2]],
      diagnostics: { triangle_count: 2 },
      surface_diagnostics: { triangle_count: 2, point_count: 4 },
      solve_strategy: 'triangulated_milp_exact',
    },
  ],
}));

beforeEach(() => {
  vi.spyOn(Modal, 'success').mockImplementation(() => ({ destroy: vi.fn(), update: vi.fn() }) as ReturnType<typeof Modal.success>);
});

function Harness({ initial }: { initial: ModelDraft }) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <Step3MathExpansion draft={draft} onChange={setDraft} />
      <div data-testid="component-count">{draft.components.length}</div>
      <pre data-testid="draft-json">{JSON.stringify(draft.components)}</pre>
    </>
  );
}

function genericDraft() {
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'generic_linear';
  draft.semantic.sets = [{ code: 'unit', name: '机组', values: ['u1'] }, { code: 'time', name: '时段', values: [0] }];
  draft.semantic.parameters = [{ code: 'load', name: '负荷', dimension: ['time'], default: [10] }, { code: 'cost', name: '成本', dimension: ['unit'], default: { u1: 1 } }];
  draft.semantic.variables = [{ code: 'p', name: '出力', dimension: ['unit', 'time'], domain: 'NonNegativeReals' }];
  draft.formulas = [formula('constraint', 'sum(p[u,t] for u in unit) >= load[t]', ['time']), formula('objective', 'sum(cost[u] * p[u,t] for u in unit for t in time)')];
  return draft;
}

function componentDraft() {
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.semantic.sets = [{ code: 'time', name: '时段', values: [0] }];
  draft.semantic.variables = [
    { code: 'volume', name: '库容', dimension: ['time'], domain: 'NonNegativeReals' },
    { code: 'level', name: '水位', dimension: ['time'], domain: 'NonNegativeReals' },
  ];
  return draft;
}

function componentDraft2d() {
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.semantic.sets = [{ code: 'time', name: '时段', values: [0] }];
  draft.semantic.variables = [
    { code: 'flow', name: '流量', dimension: ['time'], domain: 'NonNegativeReals' },
    { code: 'head', name: '水头', dimension: ['time'], domain: 'NonNegativeReals' },
    { code: 'power', name: '出力', dimension: ['time'], domain: 'NonNegativeReals' },
  ];
  return draft;
}

test('Step3 generic builder compiles formulas into generic_spec preview', () => {
  renderWithQueryClient(<Harness initial={genericDraft()} />);
  expect(screen.getByText('目标函数')).toBeInTheDocument();
  expect(screen.getByText('约束条件')).toBeInTheDocument();
  fireEvent.click(screen.getByText('高级调试'));
  expect(screen.getByText('待编译')).toBeInTheDocument();
  fireEvent.click(screen.getByText('编译 generic_spec'));
  expect(screen.getByText('已生成')).toBeInTheDocument();
  expect(screen.getByText('generic_spec 预览')).toBeInTheDocument();
  expect(screen.getByText(/"rhs_param": "load"/)).toBeInTheDocument();
});

test('Step3 component builder renders generated constraints and dependencies', () => {
  const draft = componentDraft();
  draft.components = [{
    component_id: 'power_balance',
    name: '功率平衡组件',
    generated_constraints: [{ constraint_id: 'balance', name: '功率平衡', formula: 'p_grid[t] == load[t]' }],
    generated_objective_terms: [{ term_id: 'cost', name: '购电成本', formula: 'sum(price[t] * p_grid[t] for t in time)' }],
    dependencies: ['network_limit'],
    parameter_bindings: [{ component_parameter: 'load', model_parameter: 'load_forecast', status: 'bound' }],
  }];

  renderWithQueryClient(<Harness initial={draft} />);
  expect(screen.getByText('组件化数学展开')).toBeInTheDocument();
  fireEvent.click(screen.getByText('高级调试'));
  expect(screen.getAllByText('功率平衡组件').length).toBeGreaterThan(0);
  expect(screen.getByText('p_grid[t] == load[t]')).toBeInTheDocument();
  expect(screen.getByText('network_limit')).toBeInTheDocument();
  expect(screen.getByText('load_forecast')).toBeInTheDocument();
});

test('Step3 opens Add Function Mapping modal and saves complete component config', async () => {
  renderWithQueryClient(<Harness initial={componentDraft()} />);
  fireEvent.click(screen.getByRole('button', { name: '添加函数映射' }));
  expect((await screen.findAllByRole('dialog')).at(-1)).toBeInTheDocument();
  expect(screen.getByText(/binary_segment_milp/)).toBeInTheDocument();
  expect(await screen.findByText(/水位库容曲线/)).toBeInTheDocument();
  const submitButton = screen.getAllByRole('button', { name: /添\s*加/ }).find(button => button.getAttribute('type') === 'submit');
  expect(submitButton).toBeTruthy();
  fireEvent.click(submitButton!);
  await waitFor(() => expect(screen.getByTestId('component-count')).toHaveTextContent('1'));
  const json = screen.getByTestId('draft-json').textContent || '';
  expect(json).toContain('"function_asset_id":"curve_storage_level"');
  expect(json).toContain('"x":"volume[t]"');
  expect(json).toContain('"y":"level[t]"');
  expect(json).toContain('"solve_strategy":"convex_combination_lp"');
});

test('Step3 saves 2D function mapping component with triangulated MILP strategy', async () => {
  renderWithQueryClient(<Harness initial={componentDraft2d()} />);
  fireEvent.click(screen.getByRole('button', { name: '添加函数映射' }));
  expect((await screen.findAllByRole('dialog')).at(-1)).toBeInTheDocument();

  fireEvent.mouseDown(screen.getByLabelText('函数/曲线资产'));
  fireEvent.click(await screen.findByText(/水电出力曲面/));

  await waitFor(() => expect(screen.getByLabelText('输出表达式 z')).toBeInTheDocument());
  fireEvent.click(screen.getAllByRole('button', { name: /添\s*加/ }).at(-1)!);

  await waitFor(() => expect(screen.getByTestId('component-count')).toHaveTextContent('1'));
  const json = screen.getByTestId('draft-json').textContent || '';
  expect(json).toContain('"type":"function_mapping_2d_component"');
  expect(json).toContain('"function_asset_id":"hydro_power_surface_001"');
  expect(json).toContain('"x":"flow[t]"');
  expect(json).toContain('"y":"head[t]"');
  expect(json).toContain('"z":"power[t]"');
  expect(json).toContain('"solve_strategy":"triangulated_milp_exact"');
});

test('Step3 rejects 2D mapping when z variable is missing', async () => {
  const draft = componentDraft2d();
  draft.semantic.variables = draft.semantic.variables.filter(variable => variable.code !== 'power');
  renderWithQueryClient(<Harness initial={draft} />);
  fireEvent.click(screen.getByRole('button', { name: '添加函数映射' }));
  fireEvent.mouseDown(await screen.findByLabelText('函数/曲线资产'));
  fireEvent.click(await screen.findByText(/水电出力曲面/));

  await waitFor(() => expect(screen.getByLabelText('输出表达式 z')).toBeInTheDocument());
  fireEvent.click(screen.getAllByRole('button', { name: /添\s*加/ }).at(-1)!);

  await waitFor(() => expect(screen.getByTestId('component-count')).toHaveTextContent('0'));
});

test('Step3 rejects display_only and warns for convex hull approximation', async () => {
  renderWithQueryClient(<Harness initial={componentDraft2d()} />);
  fireEvent.click(screen.getByRole('button', { name: '添加函数映射' }));
  fireEvent.mouseDown(await screen.findByLabelText('函数/曲线资产'));
  fireEvent.click(await screen.findByText(/水电出力曲面/));

  fireEvent.mouseDown(await screen.findByLabelText('求解策略'));
  fireEvent.click((await screen.findAllByText(/convex_hull_lp_approx/)).at(-1)!);
  expect(await screen.findByText('convex_hull_lp_approx 非精确近似')).toBeInTheDocument();

  fireEvent.mouseDown(screen.getByLabelText('求解策略'));
  fireEvent.click((await screen.findAllByText(/display_only/)).at(-1)!);
  fireEvent.click(screen.getAllByRole('button', { name: /添\s*加/ }).at(-1)!);
  await waitFor(() => expect(screen.getByTestId('component-count')).toHaveTextContent('0'));
});
