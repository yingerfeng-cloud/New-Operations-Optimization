import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { FunctionAssetsPage } from '../../pages/FunctionAssets/FunctionAssetsPage';
import { renderWithQueryClient } from '../testUtils';
import type { FunctionAsset } from '../../types/functionAsset';

const curve: FunctionAsset = {
  function_id: 'level_volume_curve',
  name: '水位库容曲线',
  function_type: 'piecewise_1d',
  input_schema: [{ code: 'storage', name: '库容', unit: '万m3', type: 'number' }],
  output_schema: { code: 'level', name: '水位', unit: 'm', type: 'number' },
  interpolation: 'linear',
  points: [[0, 0], [100, 20], [200, 45]],
  domain: { x_min: 0, x_max: 200, breakpoint_count: 3 },
  monotonicity: 'increasing',
  convexity: 'convex',
  solve_strategy: 'convex_combination_lp',
  status: 'published',
  diagnostics: { convexity: 'convex' },
  validation_status: 'valid',
  validation_errors: [],
  validation_warnings: [],
  referenced_by: [{ model_id: 'MODEL-1', model_name: '测试模型', component_id: 'function_mapping_component', referenced_at: '2026-06-24' }],
};

vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: unknown }) => <div data-testid="curve-chart">{JSON.stringify(option)}</div>,
}));

vi.mock('../../api/functionAssets', () => ({
  getFunctionAssets: async () => [curve],
  createFunctionAsset: vi.fn(async payload => ({ ...curve, ...payload })),
  importFunctionAssetCsv: vi.fn(async payload => ({ ...curve, ...payload, function_id: payload.function_id || 'csv_curve' })),
  updateFunctionAsset: vi.fn(async (_id, payload) => ({ ...curve, ...payload })),
  validateFunctionAsset: vi.fn(async () => ({ valid: true, validation_status: 'valid', errors: [], warnings: [], domain: curve.domain, diagnostics: curve.diagnostics })),
  previewFunctionAsset: vi.fn(async () => ({ function_id: curve.function_id, domain: curve.domain, diagnostics: curve.diagnostics, validation_status: 'valid', values: [{ x: 0, y: 0 }, { x: 100, y: 20 }] })),
}));

function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <FunctionAssetsPage />
    </MemoryRouter>,
  );
}

test('renders localized function asset center, validates and previews a curve', async () => {
  renderPage();
  expect(screen.getByText('函数/曲线资产中心')).toBeInTheDocument();
  expect(await screen.findByText('水位库容曲线')).toBeInTheDocument();
  expect(screen.getByText('level_volume_curve')).toBeInTheDocument();
  expect(screen.getByText('异常资产')).toBeInTheDocument();
  expect(screen.getAllByText('校验状态').length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: '查看' }));
  expect(await screen.findByText('函数 ID')).toBeInTheDocument();
  expect(screen.getAllByText('convex_combination_lp').length).toBeGreaterThan(0);
  expect(screen.getByText('测试模型')).toBeInTheDocument();
  expect(screen.getByTestId('curve-chart')).toHaveTextContent('原始断点');
  expect(screen.getByTestId('curve-chart')).toHaveTextContent('库容');

  fireEvent.click(screen.getAllByRole('button', { name: '校验' }).at(-1)!);
  await waitFor(() => expect(screen.getByText('校验通过')).toBeInTheDocument());

  fireEvent.click(screen.getAllByRole('button', { name: '预览' }).at(-1)!);
  await waitFor(() => expect(screen.getByText('100')).toBeInTheDocument());
}, 30000);

test('opens CSV import form', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '导入 CSV' }));
  expect(await screen.findByText('导入 CSV 曲线')).toBeInTheDocument();
  expect(screen.getByText('Excel 多 Sheet 与多 group 曲线求解为预留能力')).toBeInTheDocument();
  expect(screen.getByText('当前轻量版仅使用第一组曲线参与求解，其余分组仅保存为元数据。')).toBeInTheDocument();
});

