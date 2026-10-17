import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
import { ModelServicesPage } from '../../pages/ModelServices/ModelServicesPage';
import { renderWithQueryClient } from '../testUtils';

const state = vi.hoisted(() => ({ create: vi.fn(), task: vi.fn(), result: vi.fn() }));
vi.mock('../../api/models', () => ({ getModels: async () => [{ id: 'LONG-MODEL', name: '长任务服务', status: 'published', problem_type: 'LP', solver: 'HiGHS' }], getModelAssetDetail: async () => ({ sample_runtime_parameters: { price: [10, 20] } }) }));
vi.mock('../../api/tasks', () => ({ createTask: state.create, getTask: state.task }));
vi.mock('../../api/results', () => ({ getResult: state.result }));
beforeEach(() => {
  sessionStorage.clear();
  state.create.mockReset().mockResolvedValue({ id: 'LONG-TASK', status: 'SOLVING', model_id: 'LONG-MODEL' });
  state.task.mockReset().mockResolvedValue({ id: 'LONG-TASK', status: 'SOLVING', model_id: 'LONG-MODEL' });
  state.result.mockReset().mockResolvedValue({ objective_value: 1234 });
});

async function openDebug() {
  const rendered = renderWithQueryClient(<MemoryRouter><ModelServicesPage /></MemoryRouter>);
  await screen.findAllByText('长任务服务');
  fireEvent.click(screen.getByRole('tab', { name: '在线调试' }));
  const panel = screen.getByRole('tabpanel');
  await waitFor(() => expect((within(panel).getByLabelText('运行参数 JSON') as HTMLTextAreaElement).value).toContain('price'));
  return rendered;
}

test('async call survives page remount, blocks duplicate clicks and recovers after a read failure', async () => {
  const first = await openDebug();
  fireEvent.click(screen.getByRole('button', { name: '发起测试调用' }));
  expect(await screen.findByText(/任务编号：LONG-TASK/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '恢复任务' })).toBeDisabled();
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ async_run: true, idempotency_key: expect.any(String) }));
  first.unmount();
  state.task.mockRejectedValue(new Error('503'));
  await openDebug();
  expect(await screen.findByText('调试任务加载失败')).toBeInTheDocument();
  state.task.mockResolvedValue({ id: 'LONG-TASK', status: 'SUCCESS', model_id: 'LONG-MODEL' });
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(document.body.textContent).toContain('1234'));
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '新建测试调用' })).toBeInTheDocument();
});

test('uncertain submission retries with the same idempotency key', async () => {
  state.create.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({ id: 'LONG-TASK', status: 'SOLVING' });
  await openDebug();
  fireEvent.click(screen.getByRole('button', { name: '发起测试调用' }));
  await waitFor(() => expect(document.body.textContent).toContain('提交或连接暂未确认'));
  fireEvent.click(screen.getByRole('button', { name: '发起测试调用' }));
  await screen.findByText(/任务编号：LONG-TASK/);
  expect(state.create.mock.calls[0][0].idempotency_key).toBe(state.create.mock.calls[1][0].idempotency_key);
});
