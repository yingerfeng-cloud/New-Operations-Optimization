import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ModelServicesPage } from '../../pages/ModelServices/ModelServicesPage';
import type { ModelAsset } from '../../types/model';
import { renderWithQueryClient } from '../testUtils';

const testState = vi.hoisted(() => {
  const modelSample: ModelAsset = {
    id: 'model_service_001',
    name: '日前调度服务',
    scene: 'power_dispatch',
    version: 'v1.0',
    status: 'published',
    solver: 'HiGHS',
    problem_type: 'LP',
    model_problem_type: 'LP',
    build_mode: 'generic_linear',
    updated_at: '2026-06-23 12:00:00',
    parameter_schema: {
      parameters: [
        { code: 'load', name: '负荷预测', required: true, example: [100, 120] },
        { code: 'price', name: '电价', required: false, example: [0.4, 0.5] },
      ],
    },
  };
  return {
    modelSample,
    assetDetail: {
      parameter_schema: {
        parameters: [
          { code: 'load', name: '负荷预测', required: true, example: [200, 220] },
          { code: 'price', name: '电价', required: false, example: [0.6, 0.7] },
        ],
      },
      recent_invocations: [],
      recent_tasks: [],
    },
    createTask: vi.fn(async () => ({ task_id: 'TASK-ONLINE-001', status: 'SUCCESS', objective_value: 1280 })),
  };
});

vi.mock('../../api/models', () => ({
  getModels: async () => [testState.modelSample],
  getModelAssetDetail: async () => testState.assetDetail,
}));

vi.mock('../../api/tasks', () => ({
  createTask: testState.createTask,
}));

function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ModelServicesPage />
    </MemoryRouter>,
  );
}

function expectJsonViewerIncludes(text: string) {
  const viewers = [...document.querySelectorAll('.json-viewer')];
  expect(viewers.some(viewer => viewer.textContent?.includes(text))).toBe(true);
}

test('renders model services page and service list', async () => {
  renderPage();

  expect(screen.getByText('模型服务治理与在线调用')).toBeInTheDocument();
  expect((await screen.findAllByText('日前调度服务')).length).toBeGreaterThan(0);
  expect(screen.getByRole('tab', { name: '在线调试' })).toBeInTheDocument();
});

test('runs online debug call with JSON payload', async () => {
  renderPage();

  expect((await screen.findAllByText('日前调度服务')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('tab', { name: '在线调试' }));

  const debugPanel = screen.getByRole('tabpanel');
  const textarea = within(debugPanel).getByLabelText('运行参数 JSON');
  await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toContain('200'));
  fireEvent.change(textarea, { target: { value: JSON.stringify({ load: [80, 90], price: [0.3, 0.35] }) } });
  fireEvent.click(within(debugPanel).getByRole('button', { name: '发起测试调用' }));

  await waitFor(() => expect(testState.createTask).toHaveBeenCalledWith(expect.objectContaining({
    model_id: 'model_service_001',
    runtime_parameters: { load: [80, 90], price: [0.3, 0.35] },
    async_run: false,
  })));
  await waitFor(() => expectJsonViewerIncludes('TASK-ONLINE-001'));
  expectJsonViewerIncludes('SUCCESS');
});

test('shows clear error for invalid debug JSON', async () => {
  testState.createTask.mockClear();
  renderPage();

  expect((await screen.findAllByText('日前调度服务')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('tab', { name: '在线调试' }));

  const debugPanel = screen.getByRole('tabpanel');
  const textarea = within(debugPanel).getByLabelText('运行参数 JSON');
  await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toContain('200'));
  fireEvent.change(textarea, { target: { value: '{bad json' } });
  await waitFor(() => expect(textarea).toHaveValue('{bad json'));
  fireEvent.click(within(debugPanel).getByRole('button', { name: '发起测试调用' }));

  expect(await screen.findByText('调试返回')).toBeInTheDocument();
  await waitFor(() => expectJsonViewerIncludes('运行参数 JSON 格式错误'));
  expect(testState.createTask).not.toHaveBeenCalled();
});
