import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
import { FunctionUpdatesPanel } from '../../features/model-center/FunctionUpdatesPanel';
import { renderWithQueryClient } from '../testUtils';
import type { ModelAsset } from '../../types/model';

const state = vi.hoisted(() => ({ test: vi.fn(), apply: vi.fn(), task: vi.fn(), model: vi.fn() }));
vi.mock('../../api/functionUpdates', () => ({
  getFunctionUpdates: async () => ({ dependencies: ['F', 'G'].map(function_id => ({ function_id, name: function_id, binding: { revision: 1, content_hash: 'old-hash' }, latest_revision: 3,
    versions: [1, 2, 3].map(revision => ({ revision, content_hash: `hash-${revision}`, diff: { requires_model_edit: false, contract_changes: {}, before_points: [[0, 0], [10, 10]], after_points: [[0, 0], [10, revision * 10]], message: '重新测试定义域与物理量' } })) })) }),
  testFunctionUpdates: state.test, applyFunctionUpdates: state.apply,
}));
vi.mock('../../api/tasks', () => ({ getTask: state.task }));
vi.mock('../../api/models', () => ({ getModel: state.model }));
vi.mock('../../api/results', () => ({ getResult: async () => ({ objective_value: 20, variable_values: { level: 20 } }) }));

const model: ModelAsset = { id: 'A', name: 'A', scene: 'synthetic', version: 'v1.0', status: 'published', solver: 'HiGHS', problem_type: 'MILP', build_mode: 'component_based', updated_at: '', dry_run_result: { solver_check: { objective_value: 10 } } };
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  state.test.mockResolvedValue({ model: { id: 'A2' }, task: { id: 'T2', status: 'SOLVING' } });
  state.task.mockResolvedValue({ id: 'T2', status: 'SUCCESS', progress: 100, objective_value: 20 });
  state.model.mockResolvedValue({ id: 'A2', status: 'trial', content_hash: 'tested', tested_content_hash: 'tested', tested_model_id: 'A2' });
  state.apply.mockResolvedValue({ id: 'A2', status: 'published' });
});
const renderPanel = () => renderWithQueryClient(<MemoryRouter><FunctionUpdatesPanel model={model} /></MemoryRouter>);
async function chooseF() {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'F 目标修订' }));
  fireEvent.click(await screen.findByText('r2'));
}

test('only selected F is updated and applied after the exact candidate test', async () => {
  renderPanel(); await chooseF();
  fireEvent.click(screen.getByRole('button', { name: '更新并测试' }));
  await waitFor(() => expect(state.test).toHaveBeenCalledWith('A', { F: 2 }, expect.any(String)));
  const apply = await screen.findByRole('button', { name: '应用更新' });
  await waitFor(() => expect(apply).toBeEnabled());
  fireEvent.click(apply);
  await waitFor(() => expect(state.apply).toHaveBeenCalledWith('A2'));
});

test('refresh and an uncertain submission reuse the same candidate identity', async () => {
  state.test.mockRejectedValueOnce(new Error('503'));
  const first = renderPanel(); await chooseF();
  fireEvent.click(screen.getByRole('button', { name: '更新并测试' }));
  await screen.findByText('提交或连接暂未确认，可使用同一标识恢复');
  const key = state.test.mock.calls[0][2];
  first.unmount(); renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: '恢复更新并测试' }));
  await waitFor(() => expect(state.test).toHaveBeenLastCalledWith('A', { F: 2 }, key));
});

test('a stale model content hash cannot enable apply from restored task success', async () => {
  localStorage.setItem('optiforge-function-update:A', JSON.stringify({ key: 'K', revisions: { F: 2 }, candidateId: 'A2', taskId: 'T2' }));
  state.model.mockResolvedValue({ id: 'A2', status: 'trial', content_hash: 'changed', tested_content_hash: 'tested', tested_model_id: 'A2' });
  renderPanel();
  expect(await screen.findByRole('button', { name: '应用更新' })).toBeDisabled();
  expect(state.test).not.toHaveBeenCalled();
  expect(state.apply).not.toHaveBeenCalled();
});
