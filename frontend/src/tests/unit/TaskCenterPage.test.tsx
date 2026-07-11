import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import { TaskCenterPage, validateTimeSeriesFields } from '../../pages/TaskCenter/TaskCenterPage';
import type { SolveResult } from '../../types/result';
import type { SolveTask } from '../../types/task';
import { renderWithQueryClient } from '../testUtils';

vi.mock('../../components/PageHeader', () => ({ PageHeader: ({ title, extra }: { title: string; extra?: unknown }) => <header><h1>{title}</h1>{extra as React.ReactNode}</header> }));
vi.mock('../../components/StatusTag', () => ({ StatusTag: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock('../../components/WorkspaceUI', () => ({
  MetricGrid: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MetricCard: ({ title, value }: { title: string; value: unknown }) => <div><span>{title}</span><strong>{String(value)}</strong></div>,
}));
vi.mock('../../components/DataTable', () => ({
  DataTable: ({ dataSource = [], columns = [], rowKey = 'id' }: { dataSource?: Array<Record<string, unknown>>; columns?: Array<Record<string, unknown>>; rowKey?: string }) => (
    <table><tbody>{dataSource.map((row, rowIndex) => <tr key={String(row[rowKey] || rowIndex)}>{columns.map((column, columnIndex) => {
      const render = column.render as ((value: unknown, row: Record<string, unknown>, index: number) => React.ReactNode) | undefined;
      const value = column.dataIndex ? row[String(column.dataIndex)] : undefined;
      return <td key={columnIndex}>{render ? render(value, row, rowIndex) : String(value ?? '')}</td>;
    })}</tr>)}</tbody></table>
  ),
}));
vi.mock('../../features/task-center/TaskPanels', () => ({
  isRunningStatus: (status: string) => ['PENDING', 'RUNNING', 'SOLVING'].includes(String(status).toUpperCase()),
  isRetryableStatus: (status: string) => ['FAILED', 'TIMEOUT', 'CANCELLED'].includes(String(status).toUpperCase()),
  TaskOverviewPanel: ({ task }: { task?: SolveTask }) => task ? <span>任务进度</span> : null,
  TaskTimelinePanel: () => <span>任务进度</span>,
  TaskInputPanel: ({ task }: { task?: SolveTask }) => <span>{task?.resolved_model_code}</span>,
  TaskLogsPanel: ({ task }: { task?: SolveTask }) => <>{task?.recent_logs?.map(log => <span key={log}>{log}</span>)}</>,
  TaskResultPanel: () => <span>变量结果</span>,
  TaskExplanationPanel: ({ result }: { result?: SolveResult }) => {
    const explanation = result?.business_explanation;
    return <span>{typeof explanation === 'string' ? explanation : String(explanation?.summary || '')}</span>;
  },
}));

const testState = vi.hoisted(() => {
  const successTask: SolveTask = {
    id: 'OPT-SUCCESS',
    model_id: 'model_001',
    resolved_model_id: 'model_001',
    resolved_model_code: 'day_ahead_dispatch',
    scene: 'power_dispatch',
    model: '日前调度模型',
    solver: 'HiGHS',
    status: 'SUCCESS',
    progress: 100,
    gap: '0.00%',
    cost: 123.45,
    risk: 'low',
    created_at: '2026-06-23 10:00:00',
    started_at: '2026-06-23 10:01:00',
    finished_at: '2026-06-23 10:02:00',
    duration_seconds: 60,
    retry_count: 0,
    recent_logs: ['VALIDATING 参数校验通过', 'SOLVING HiGHS 求解完成'],
    trace: { model_code: 'day_ahead_dispatch', horizon: 24 },
  };
  const failedTask: SolveTask = {
    ...successTask,
    id: 'OPT-FAILED',
    status: 'FAILED',
    progress: 100,
    error: 'generic_spec.variables is required',
  };
  const result: SolveResult = {
    task_id: 'OPT-SUCCESS',
    status: 'SUCCESS',
    objective_value: 123.45,
    metrics: { objective_value: 123.45, total_cost: 123.45, gap: '0.00%' },
    variables: { p_grid: [10, 12, 14] },
    business_explanation: { summary: '日前调度求解完成。' },
  };
  return {
    successTask,
    failedTask,
    result,
    createTask: vi.fn(async () => successTask),
    cancelTask: vi.fn(async (id: string) => ({ ...successTask, id, status: 'CANCELLED' })),
    retryTask: vi.fn(async (id: string) => ({ ...failedTask, id, status: 'PENDING' })),
  };
});

vi.mock('../../api/tasks', () => ({
  getTasks: async () => [testState.successTask, testState.failedTask],
  getTask: async (id: string) => id === 'OPT-FAILED' ? testState.failedTask : testState.successTask,
  createTask: testState.createTask,
  cancelTask: testState.cancelTask,
  retryTask: testState.retryTask,
}));

vi.mock('../../api/models', () => ({
  getModels: async () => [
    { id: 'model_001', name: '日前调度模型', parameters: { horizon: 3, load: [10, 12, 14] }, ui_metadata: { time_dimension: { enabled: true, policy: 'runtime_variable', default_horizon: 3, time_set: 'time', state_time_set: 'time_volume', editable: true } } },
    { id: 'model_fixed', name: '固定时段模型', parameters: { horizon: 4, load: [1, 2, 3, 4] }, ui_metadata: { time_dimension: { enabled: true, policy: 'fixed', default_horizon: 4, time_set: 'time', state_time_set: 'time_volume', interval_minutes: 30, delta_t: 0.5, editable: false } } },
    { id: 'model_enum', name: '枚举时段模型', parameters: { horizon: 96, demand: 100, time_labels: Array.from({ length: 96 }, (_, index) => `T${index + 1}`) }, ui_metadata: { time_dimension: { enabled: true, policy: 'runtime_variable', default_horizon: 96, allowed_horizons: [24, 48, 96], time_set: 'time', state_time_set: 'time_volume', interval_minutes_by_horizon: { '24': 60, '48': 30, '96': 15 }, delta_t_by_horizon: { '24': 1, '48': 0.5, '96': 0.25 }, label_set: 'time_labels', label_generation: 'auto', editable: true } } },
    { id: 'model_static', name: '静态模型', parameters: { demand: 100, interval_minutes: 10, delta_t: 2 }, ui_metadata: { time_dimension: { enabled: false, policy: 'not_applicable', editable: false } } },
  ],
  getModelSchema: async (id: string) => {
    if (id === 'model_static') return { ui_metadata: { time_dimension: { enabled: false, policy: 'not_applicable' } }, parameter_schema: { parameters: [{ code: 'demand', name: '需求', required: true, default: 100 }, { code: 'interval_minutes', name: '业务间隔', required: false, default: 10 }, { code: 'delta_t', name: '业务变化量', required: false, default: 2 }] } };
    if (id === 'model_enum') {
      const timeDimension = { enabled: true, policy: 'runtime_variable', default_horizon: 96, allowed_horizons: [24, 48, 96], time_set: 'time', state_time_set: 'time_volume', interval_minutes_by_horizon: { '24': 60, '48': 30, '96': 15 }, delta_t_by_horizon: { '24': 1, '48': 0.5, '96': 0.25 }, label_set: 'time_labels', label_generation: 'auto', editable: true };
      return { ui_metadata: { time_dimension: timeDimension }, parameter_schema: { parameters: [
        { code: 'horizon', name: '调度时段', required: false, default: 96 },
        { code: 'time', name: '时间集合', required: false, dimension: ['time'], default: Array.from({ length: 96 }, (_, index) => index) },
        { code: 'time_volume', name: '状态时点', required: false, dimension: ['time_volume'], default: Array.from({ length: 97 }, (_, index) => index) },
        { code: 'time_labels', name: '时间标签', required: false, dimension: ['time'], default: Array.from({ length: 96 }, (_, index) => `T${index + 1}`) },
        { code: 'interval_minutes', name: '系统时间粒度', required: true, default: 15 },
        { code: 'delta_t', name: '系统 delta_t', required: true, default: 0.25 },
        { code: 'demand', name: '需求', required: true, default: 100 },
      ] } };
    }
    const timeDimension = id === 'model_fixed'
      ? { enabled: true, policy: 'fixed', default_horizon: 4, time_set: 'time', state_time_set: 'time_volume', interval_minutes: 30, delta_t: 0.5, editable: false }
      : { enabled: true, policy: 'runtime_variable', default_horizon: 3, time_set: 'time', state_time_set: 'time_volume', editable: true };
    return { ui_metadata: { time_dimension: timeDimension }, parameter_schema: { parameters: [
      { code: 'horizon', name: '调度时段', required: false, default: id === 'model_fixed' ? 4 : 3 },
      { code: 'time', name: '时间集合', required: false, dimension: ['time'], default: id === 'model_fixed' ? [0, 1, 2, 3] : [0, 1, 2] },
      { code: 'time_volume', name: '状态时点', required: false, dimension: ['time_volume'], default: id === 'model_fixed' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3] },
      { code: 'load', name: '负荷', required: true, dimensions: ['time'], default: id === 'model_fixed' ? [1, 2, 3, 4] : [10, 12, 14] },
      ...(id === 'model_fixed' ? [{ code: 'interval_minutes', name: '系统时间粒度', required: true, default: 30 }, { code: 'delta_t', name: '系统 delta_t', required: true, default: 0.5 }] : []),
    ] } };
  },
  getModelAssetDetail: async (id: string) => {
    if (id === 'model_static') return { ui_metadata: { time_dimension: { enabled: false, policy: 'not_applicable' } }, parameters: { demand: 100, interval_minutes: 10, delta_t: 2 }, parameter_schema: { parameters: [{ code: 'demand', name: '需求', required: true, default: 100 }, { code: 'interval_minutes', name: '业务间隔', default: 10 }, { code: 'delta_t', name: '业务变化量', default: 2 }] } };
    if (id === 'model_enum') {
      const timeDimension = { enabled: true, policy: 'runtime_variable', default_horizon: 96, allowed_horizons: [24, 48, 96], time_set: 'time', state_time_set: 'time_volume', interval_minutes_by_horizon: { '24': 60, '48': 30, '96': 15 }, delta_t_by_horizon: { '24': 1, '48': 0.5, '96': 0.25 }, label_set: 'time_labels', label_generation: 'auto', editable: true };
      return { ui_metadata: { time_dimension: timeDimension }, parameters: { horizon: 96, demand: 100, time_labels: Array.from({ length: 96 }, (_, index) => `T${index + 1}`) }, parameter_schema: { parameters: [
        { code: 'time_labels', name: '时间标签', required: false, dimension: ['time'], default: Array.from({ length: 96 }, (_, index) => `T${index + 1}`) },
        { code: 'interval_minutes', name: '系统时间粒度', required: true, default: 15 },
        { code: 'delta_t', name: '系统 delta_t', required: true, default: 0.25 },
        { code: 'demand', name: '需求', required: true, default: 100 },
      ] } };
    }
    const timeDimension = id === 'model_fixed'
      ? { enabled: true, policy: 'fixed', default_horizon: 4, time_set: 'time', state_time_set: 'time_volume', interval_minutes: 30, delta_t: 0.5, editable: false }
      : { enabled: true, policy: 'runtime_variable', default_horizon: 3, time_set: 'time', state_time_set: 'time_volume', editable: true };
    return { ui_metadata: { time_dimension: timeDimension }, parameters: { horizon: id === 'model_fixed' ? 4 : 3, load: id === 'model_fixed' ? [1, 2, 3, 4] : [10, 12, 14] }, parameter_schema: { parameters: [{ code: 'load', name: '负荷', required: true, dimension: ['time'], default: id === 'model_fixed' ? [1, 2, 3, 4] : [10, 12, 14] }] } };
  },
}));

vi.mock('../../api/results', () => ({
  getResult: async () => testState.result,
}));

function renderPage() {
  return renderWithQueryClient(<TaskCenterPage />);
}

beforeEach(() => {
  testState.createTask.mockClear();
  testState.cancelTask.mockClear();
  testState.retryTask.mockClear();
});

test('renders task center metrics and structured task detail', async () => {
  renderPage();
  expect(screen.getByText('任务调度中心')).toBeInTheDocument();
  expect(await screen.findByText('OPT-SUCCESS')).toBeInTheDocument();
  expect(screen.getByText('失败/无解')).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: '查看' })[0]);

  await waitFor(() => expect(screen.getByText('任务进度')).toBeInTheDocument());
  fireEvent.click(screen.getByText('输入参数'));
  expect(screen.getByText('day_ahead_dispatch')).toBeInTheDocument();
  fireEvent.click(screen.getByText('求解日志'));
  expect(screen.getByText('SOLVING HiGHS 求解完成')).toBeInTheDocument();
  fireEvent.click(screen.getByText('结果解释'));
  await waitFor(() => expect(screen.getByText('日前调度求解完成。')).toBeInTheDocument());
}, 20000);

test('retries failed task from list', async () => {
  renderPage();
  expect(await screen.findByText('OPT-FAILED')).toBeInTheDocument();
  const failedRow = screen.getByText('OPT-FAILED').closest('tr')!;
  fireEvent.click(within(failedRow).getByRole('button', { name: /更多/ }));
  fireEvent.click(await screen.findByText('重试任务'));
  await waitFor(() => expect(testState.retryTask.mock.calls[0]?.[0]).toBe('OPT-FAILED'));
}, 30000);

test('creates task with model asset default parameters and horizon', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  fireEvent.mouseDown(await screen.findByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText('日前调度模型')).at(-1)!);

  await waitFor(() => expect(screen.getByLabelText('调度时段')).toHaveValue('3'));
  await waitFor(() => expect(screen.getByPlaceholderText('[10,12,14]')).toHaveValue('[10,12,14]'));
  fireEvent.click(screen.getByRole('button', { name: '提交求解并打开详情' }));

  await waitFor(() => expect(testState.createTask).toHaveBeenCalled());
  const lastCreateTaskCall = testState.createTask.mock.calls[
    testState.createTask.mock.calls.length - 1
  ] as unknown as [Record<string, unknown>];
  expect(lastCreateTaskCall[0]).toMatchObject({
    model_id: 'model_001',
    horizon: 3,
    runtime_parameters: { horizon: 3, load: [10, 12, 14] },
    parameters: { horizon: 3, load: [10, 12, 14] },
  });
}, 30000);

test('shows fixed horizon as readonly and omits top-level horizon from payload', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  fireEvent.mouseDown(await screen.findByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText('固定时段模型')).at(-1)!);

  await waitFor(() => expect(screen.getByText('调度时段：固定 4 点，不支持运行时修改')).toBeInTheDocument());
  expect(screen.getByText(/时间粒度 30 分钟，delta_t=0.5/)).toBeInTheDocument();
  expect(screen.queryByLabelText('调度时段')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '提交求解并打开详情' }));

  await waitFor(() => expect(testState.createTask).toHaveBeenCalled());
  const calls = testState.createTask.mock.calls as unknown as unknown[][];
  const payload = calls.at(-1)?.[0] as Record<string, unknown>;
  expect(payload.horizon).toBeUndefined();
  expect(payload.runtime_parameters).toEqual({ load: [1, 2, 3, 4] });
}, 30000);

test('does not show horizon for not applicable model', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  fireEvent.mouseDown(await screen.findByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText('静态模型')).at(-1)!);

  await waitFor(() => expect(screen.queryByLabelText('调度时段')).not.toBeInTheDocument());
  expect(screen.queryByText(/固定 .* 点/)).not.toBeInTheDocument();
}, 30000);

test('blocks submit when runtime_variable time series length mismatches horizon', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  fireEvent.mouseDown(await screen.findByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText('日前调度模型')).at(-1)!);

  await waitFor(() => expect(screen.getByLabelText('调度时段')).toHaveValue('3'));
  fireEvent.change(screen.getByLabelText('调度时段'), { target: { value: '6' } });
  const loadRow = (await screen.findByText('负荷')).closest('tr')!;
  fireEvent.change(within(loadRow).getByRole('textbox'), { target: { value: '[1,2,3,4]' } });
  fireEvent.click(screen.getByRole('button', { name: '提交求解并打开详情' }));

  await waitFor(() => expect(screen.getByText(/当前调度时段为 .*load.*请提供/)).toBeInTheDocument());
  expect(testState.createTask).not.toHaveBeenCalled();
}, 30000);

test('hides system time fields from parameter contract', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  fireEvent.mouseDown(await screen.findByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText('日前调度模型')).at(-1)!);

  await waitFor(() => expect(screen.getByText('负荷')).toBeInTheDocument());
  expect(screen.queryByText('时间集合')).not.toBeInTheDocument();
  expect(screen.queryByText('状态时点')).not.toBeInTheDocument();
}, 30000);

test('uses horizon select for allowed_horizons and submits selected value', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  fireEvent.mouseDown(await screen.findByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText('枚举时段模型')).at(-1)!);

  const horizonSelect = await screen.findByLabelText('调度时段');
  await waitFor(() => expect(horizonSelect).toHaveAttribute('role', 'combobox'));
  expect(screen.queryByRole('spinbutton', { name: '调度时段' })).not.toBeInTheDocument();
  fireEvent.mouseDown(horizonSelect);
  fireEvent.click(await screen.findByText('48点 / 半小时级'));
  fireEvent.click(screen.getByRole('button', { name: '提交求解并打开详情' }));

  await waitFor(() => expect(testState.createTask).toHaveBeenCalled());
  const calls = testState.createTask.mock.calls as unknown as unknown[][];
  const payload = calls.at(-1)?.[0] as Record<string, unknown>;
  expect(payload.horizon).toBe(48);
  expect(payload.runtime_parameters).toEqual({ demand: 100, horizon: 48 });
}, 30000);

test('rejects a horizon outside allowed_horizons before submit', () => {
  const error = validateTimeSeriesFields(
    [],
    {},
    { enabled: true, policy: 'runtime_variable', default_horizon: 96, allowed_horizons: [24, 48, 96] },
    36,
  );
  expect(error).toBe('当前模型仅支持 24、48、96 点切换，请选择有效的调度时段。');
});

test('hides auto-generated time_labels from parameter contract', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  fireEvent.mouseDown(await screen.findByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText('枚举时段模型')).at(-1)!);

  await waitFor(() => expect(screen.getByText('需求')).toBeInTheDocument());
  expect(screen.queryByText('时间标签')).not.toBeInTheDocument();
  expect(screen.queryByText('系统时间粒度')).not.toBeInTheDocument();
  expect(screen.queryByText('系统 delta_t')).not.toBeInTheDocument();
}, 30000);

test('keeps same-named business granularity fields when the contract does not manage them', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  fireEvent.mouseDown(await screen.findByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText('静态模型')).at(-1)!);

  expect(await screen.findByText('业务间隔')).toBeInTheDocument();
  expect(screen.getByText('业务变化量')).toBeInTheDocument();
}, 30000);

test('ignores contract-managed granularity values from JSON import', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  fireEvent.mouseDown(await screen.findByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText('枚举时段模型')).at(-1)!);
  await screen.findByText('需求');

  fireEvent.change(screen.getByPlaceholderText('{"load":[100,120],"horizon":24}'), { target: { value: '{"demand":100,"interval_minutes":60,"delta_t":1}' } });
  fireEvent.click(screen.getByRole('button', { name: '导入 JSON 参数' }));
  expect(await screen.findByText(/interval_minutes、delta_t 由模型时间契约管理，本次导入值已忽略/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '提交求解并打开详情' }));
  await waitFor(() => expect(testState.createTask).toHaveBeenCalled());
  const calls = testState.createTask.mock.calls as unknown as unknown[][];
  const payload = calls.at(-1)?.[0] as Record<string, unknown>;
  expect(payload.runtime_parameters).toEqual({ demand: 100, horizon: 96 });
}, 30000);
