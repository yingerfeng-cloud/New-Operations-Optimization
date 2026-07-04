import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
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

const surface: FunctionAsset = {
  function_id: 'hydro_power_surface_001',
  name: '水电出力曲面',
  function_type: 'piecewise_2d',
  input_schema: [{ code: 'flow', name: '流量', unit: 'm3/s' }, { code: 'head', name: '水头', unit: 'm' }],
  output_schema: { code: 'power', name: '出力', unit: 'MW' },
  points: [],
  points_2d: [[0, 0, 1], [10, 0, 21], [0, 10, 31], [10, 10, 51]],
  triangles: [[0, 1, 2], [1, 3, 2]],
  domain: { x_min: 0, x_max: 10, y_min: 0, y_max: 10, z_min: 1, z_max: 51, point_count: 4 },
  x_domain: [0, 10],
  y_domain: [0, 10],
  z_range: [1, 51],
  triangulation_status: 'provided',
  surface_diagnostics: { point_count: 4, triangle_count: 2, is_regular_grid: true, triangulation_status: 'provided', degenerate_triangle_count: 0, recommended_solve_strategy: 'triangulated_milp_exact' },
  diagnostics: { triangle_count: 2, is_regular_grid: true },
  solve_strategy: 'triangulated_milp_exact',
  status: 'draft',
  validation_status: 'valid',
  validation_errors: [],
  validation_warnings: [],
  referenced_by: [],
};

const apiMocks = vi.hoisted(() => ({
  rows: [] as FunctionAsset[],
  createFunctionAsset: vi.fn(),
  importFunctionAssetCsv: vi.fn(),
  updateFunctionAsset: vi.fn(),
  checkFunctionAssetApiReady: vi.fn(),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  const React = await import('react');

  const renderNode = (value: unknown) => React.isValidElement(value) ? value : String(value ?? '');
  const Table = ({ dataSource = [], columns = [], rowKey, locale }: {
    dataSource?: Array<Record<string, unknown>>;
    columns?: Array<Record<string, unknown>>;
    rowKey?: string | ((row: Record<string, unknown>) => string);
    locale?: { emptyText?: React.ReactNode };
  }) => React.createElement(
    'table',
    {},
    React.createElement(
      'tbody',
      {},
      dataSource.length === 0
        ? React.createElement('tr', { key: 'empty' }, React.createElement('td', { colSpan: Math.max(columns.length, 1) }, renderNode(locale?.emptyText)))
        : dataSource.map((row, rowIndex) => React.createElement(
        'tr',
        { key: typeof rowKey === 'function' ? rowKey(row) : String(row[rowKey || 'key'] ?? rowIndex) },
        columns.map((column, columnIndex) => {
          const dataIndex = column.dataIndex as string | undefined;
          const raw = dataIndex ? row[dataIndex] : undefined;
          const rendered = typeof column.render === 'function'
            ? column.render(raw, row, rowIndex)
            : raw;
          return React.createElement('td', { key: `${rowIndex}-${columnIndex}` }, renderNode(rendered));
        }),
      )),
    ),
  );
  const Drawer = ({ open, title, children, onClose }: { open?: boolean; title?: React.ReactNode; children?: React.ReactNode; onClose?: () => void }) => (
    open ? React.createElement('section', { className: 'ant-drawer', role: 'dialog' },
      React.createElement('button', { type: 'button', 'aria-label': 'Close', onClick: onClose }, 'Close'),
      React.createElement('h2', {}, title),
      children,
    ) : null
  );
  const Select = ({ options = [], value, defaultValue, onChange, disabled, allowClear: _allowClear, showSearch: _showSearch, ...props }: {
    options?: Array<{ value: string; label: React.ReactNode; disabled?: boolean }>;
    value?: string;
    defaultValue?: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
  } & Record<string, unknown>) => React.createElement(
    'select',
    { ...props, value: value ?? defaultValue ?? '', disabled, onChange: event => onChange?.((event.target as HTMLSelectElement).value) },
    [React.createElement('option', { key: '__empty', value: '' }, '')].concat(
      options.map(option => React.createElement('option', { key: option.value, value: option.value, disabled: option.disabled }, option.label)),
    ),
  );
  const InputNumber = ({ value, onChange, addonBefore, ...props }: { value?: number; onChange?: (value: number | null) => void; addonBefore?: React.ReactNode } & Record<string, unknown>) => React.createElement(
    'label',
    {},
    addonBefore,
    React.createElement('input', { ...props, type: 'number', value: value ?? '', onChange: event => onChange?.(Number((event.target as HTMLInputElement).value)) }),
  );
  const Dropdown = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, {}, children);
  const Collapse = ({ items = [] }: { items?: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }> }) => React.createElement(
    'div',
    {},
    items.map(item => React.createElement('section', { key: item.key }, React.createElement('h3', {}, item.label), item.children)),
  );
  const Descriptions = ({ items = [], children }: { items?: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }>; children?: React.ReactNode }) => React.createElement(
    'div',
    {},
    children,
    items.map(item => React.createElement('div', { key: item.key }, React.createElement('span', {}, item.label), React.createElement('span', {}, item.children))),
  );
  Descriptions.Item = ({ label, children }: { label?: React.ReactNode; children?: React.ReactNode }) => React.createElement('div', {}, React.createElement('span', {}, label), React.createElement('span', {}, children));
  const Upload = ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children);

  return {
    ...actual,
    Collapse,
    Descriptions,
    Drawer,
    Dropdown,
    InputNumber,
    Select,
    Table,
    Upload,
    message: { ...actual.message, success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), open: vi.fn(), destroy: vi.fn() },
    notification: { ...actual.notification, success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), open: vi.fn(), destroy: vi.fn() },
  };
});

vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: unknown }) => <div data-testid="curve-chart">{JSON.stringify(option)}</div>,
}));

vi.mock('../../api/functionAssets', () => ({
  getFunctionAssets: async () => apiMocks.rows,
  createFunctionAsset: apiMocks.createFunctionAsset,
  importFunctionAssetCsv: apiMocks.importFunctionAssetCsv,
  updateFunctionAsset: apiMocks.updateFunctionAsset,
  checkFunctionAssetApiReady: apiMocks.checkFunctionAssetApiReady,
  validateFunctionAsset: vi.fn(async () => ({ valid: true, validation_status: 'valid', errors: [], warnings: [], domain: curve.domain, diagnostics: curve.diagnostics })),
  previewFunctionAsset: vi.fn(async (_id, payload) => payload?.x !== undefined ? ({ function_id: surface.function_id, x: payload.x, y: payload.y, z: 26, status: 'inside_domain', triangle: [0, 1, 2], lambda: [0, 0.5, 0.5], domain: surface.domain, diagnostics: surface.diagnostics }) : ({ function_id: curve.function_id, domain: curve.domain, diagnostics: curve.diagnostics, validation_status: 'valid', values: [{ x: 0, y: 0 }, { x: 100, y: 20 }] })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.rows = [curve, surface];
  apiMocks.createFunctionAsset.mockImplementation(async (payload: Partial<FunctionAsset>) => {
    const requestedId = String(payload.function_id || 'created_surface');
    const functionId = apiMocks.rows.some(row => row.function_id === requestedId) ? `${requestedId}_created` : requestedId;
    const asset = { ...surface, ...payload, function_id: functionId, validation_status: 'valid', status: payload.status || 'draft' } as FunctionAsset;
    apiMocks.rows = [...apiMocks.rows, asset];
    return asset;
  });
  apiMocks.importFunctionAssetCsv.mockImplementation(async payload => ({ ...curve, ...payload, function_id: payload.function_id || 'csv_curve' }));
  apiMocks.updateFunctionAsset.mockImplementation(async (_id: string, payload: Partial<FunctionAsset>) => payload);
  apiMocks.checkFunctionAssetApiReady.mockResolvedValue(true);
});

function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <FunctionAssetsPage />
    </MemoryRouter>,
  );
}

function chooseSelectOption(label: string, optionText: string | RegExp) {
  const control = screen.getByLabelText(label);
  if (control instanceof HTMLSelectElement) {
    const option = Array.from(control.options).find(item => (
      typeof optionText === 'string' ? item.textContent === optionText : optionText.test(item.textContent || '')
    ));
    if (!option) throw new Error(`Option not found: ${String(optionText)}`);
    fireEvent.change(control, { target: { value: option.value } });
    return Promise.resolve();
  }
  fireEvent.mouseDown(control);
  return screen.findByText(optionText).then(option => fireEvent.click(option));
}

function currentDrawer() {
  const drawer = document.querySelector('.ant-drawer') as HTMLElement | null;
  if (!drawer) throw new Error('Function asset drawer is not open');
  return within(drawer);
}

test('uses one create entry and opens a blank new function asset drawer', async () => {
  renderPage();
  expect(screen.getByRole('button', { name: '导入 CSV' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新建函数资产' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新建二维曲面' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新建曲线' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '新建函数资产' }));
  await waitFor(() => expect(screen.getAllByText('新建函数资产').length).toBeGreaterThan(1));
  expect(screen.getByLabelText('函数类型')).toBeInTheDocument();
  expect(screen.queryByText('高级设置：函数 ID')).not.toBeInTheDocument();
  expect(screen.getByText('高级配置')).toBeInTheDocument();
  expect(screen.getByText('暂无点数据，请添加点或粘贴数据')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('100')).not.toBeInTheDocument();
});

test('CSV import starts empty and fills examples only on explicit button click', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '导入 CSV' }));
  expect(await screen.findByText('导入 CSV 函数资产')).toBeInTheDocument();
  expect(screen.getByLabelText('CSV 内容')).toHaveValue('');
  expect(screen.getByText('请上传 CSV 文件或粘贴 CSV 内容')).toBeInTheDocument();
  expect(screen.queryByText('storage')).not.toBeInTheDocument();
  expect(screen.queryByText('level')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '填充一维示例' }));
  expect((screen.getByLabelText('CSV 内容') as HTMLTextAreaElement).value).toContain('storage,level');
  await waitFor(() => expect(screen.getAllByText('storage').length).toBeGreaterThan(0));

  fireEvent.click(screen.getByRole('button', { name: '填充二维示例' }));
  expect((screen.getByLabelText('CSV 内容') as HTMLTextAreaElement).value).toContain('flow,head,power');
  expect(await screen.findByLabelText('z 字段')).toBeInTheDocument();
});

test('creating a 2D surface posts to createFunctionAsset, closes drawer and refreshes list', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '新建函数资产' }));
  await chooseSelectOption('函数类型', '二维曲面 z=f(x,y)');
  await screen.findByLabelText('y 名称');
  const drawer = currentDrawer();
  expect(drawer.getByText('输入字段')).toBeInTheDocument();
  expect(drawer.getByText('输出字段')).toBeInTheDocument();
  fireEvent.change(drawer.getByLabelText('资产名称'), { target: { value: '验收二维曲面' } });

  fireEvent.change(drawer.getByPlaceholderText(/0 0 1/), { target: { value: '0 0 1\n10 0 21\n0 10 31\n10 10 51' } });
  fireEvent.click(drawer.getByRole('button', { name: '应用粘贴数据' }));
  expect(drawer.getByDisplayValue('51')).toBeInTheDocument();

  fireEvent.click(drawer.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(apiMocks.createFunctionAsset).toHaveBeenCalledTimes(1));
  const payload = apiMocks.createFunctionAsset.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  expect(payload.function_type).toBe('piecewise_2d');
  expect(payload.points_2d).toEqual([[0, 0, 1], [10, 0, 21], [0, 10, 31], [10, 10, 51]]);
  await waitFor(() => expect(screen.queryByLabelText('资产名称')).not.toBeInTheDocument());
  expect(await screen.findByText('验收二维曲面')).toBeInTheDocument();
});

test('blocks save before POST when current backend does not expose the latest function asset API', async () => {
  apiMocks.checkFunctionAssetApiReady.mockResolvedValue(false);
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '新建函数资产' }));
  fireEvent.change(await screen.findByLabelText('资产名称'), { target: { value: '旧后端保护测试' } });
  fireEvent.click(screen.getByRole('button', { name: '填充示例数据' }));
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

  await waitFor(() => expect(apiMocks.checkFunctionAssetApiReady).toHaveBeenCalled());
  expect(apiMocks.createFunctionAsset).not.toHaveBeenCalled();
});

test('editing existing 2D surface shows original xyz points and preserves points_2d', async () => {
  renderPage();
  expect(await screen.findByText('水电出力曲面')).toBeInTheDocument();
  const row = screen.getByText('水电出力曲面').closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: '编辑' }));

  expect(await screen.findByText('编辑函数资产')).toBeInTheDocument();
  expect(screen.getByDisplayValue('水电出力曲面')).toBeInTheDocument();
  expect(screen.getByDisplayValue('51')).toBeInTheDocument();
  expect(screen.getAllByDisplayValue('10').length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(apiMocks.updateFunctionAsset).toHaveBeenCalled());
  const payload = apiMocks.updateFunctionAsset.mock.calls.at(-1)?.[1] as Record<string, unknown>;
  expect(payload.function_type).toBe('piecewise_2d');
  expect(payload.points_2d).toEqual([[0, 0, 1], [10, 0, 21], [0, 10, 31], [10, 10, 51]]);
  expect(payload.points).toEqual([]);
});
