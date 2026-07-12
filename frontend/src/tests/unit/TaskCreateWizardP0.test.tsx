import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { TaskCreateWizard } from '../../features/task-create/TaskCreateWizard';
import type { ModelAsset } from '../../types/model';
import { renderWithQueryClient } from '../testUtils';

const mocks = vi.hoisted(() => ({
  schema: vi.fn(),
  detail: vi.fn(),
}));
vi.mock('../../api/models', () => ({ getModelSchema: mocks.schema, getModelAssetDetail: mocks.detail }));

const models = [
  { id: 'M1', name: '模型一', version: 'v1', status: 'published', scene: '调度', solver: 'HiGHS', problem_type: 'LP', build_mode: 'generic_linear', updated_at: '' },
  { id: 'M2', name: '模型二', version: 'v1', status: 'published', scene: '调度', solver: 'HiGHS', problem_type: 'LP', build_mode: 'generic_linear', updated_at: '' },
] as ModelAsset[];
const contract = { ui_metadata: { time_dimension: { enabled: false, policy: 'not_applicable', time_set: 'time', state_time_set: null } }, input_schema: { parameters: [{ code: 'demand', name: '需求', required: true, type: 'number', default: 1 }] } };

function Harness({ onSubmit = vi.fn(async () => undefined) }: { onSubmit?: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>重新打开</button><TaskCreateWizard open={open} models={models} onClose={() => setOpen(false)} onSubmit={onSubmit} /></>;
}
async function selectModel(name = '模型一 · v1') {
  fireEvent.mouseDown(screen.getByLabelText('选择模型'));
  fireEvent.click((await screen.findAllByText(name)).at(-1)!);
}

beforeEach(() => {
  mocks.schema.mockReset().mockResolvedValue(contract);
  mocks.detail.mockReset().mockResolvedValue({});
});

test('blocks when both contract interfaces fail and exposes retry', async () => {
  mocks.schema.mockRejectedValue(new Error('schema down'));
  mocks.detail.mockRejectedValue(new Error('detail down'));
  renderWithQueryClient(<Harness />);
  await selectModel();
  expect(await screen.findByText('模型运行参数契约加载失败')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重新加载契约' })).toBeInTheDocument();
});

test('one successful contract source is an explicit compatible fallback', async () => {
  mocks.schema.mockRejectedValue(new Error('schema down'));
  mocks.detail.mockResolvedValue(contract);
  renderWithQueryClient(<Harness />);
  await selectModel();
  expect(await screen.findByText('部分契约接口不可用')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
});

test('closing resets model, step, and edited parameters', async () => {
  renderWithQueryClient(<Harness />);
  await selectModel();
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  const demand = await screen.findByLabelText('需求');
  fireEvent.change(demand, { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '创建求解任务' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
  expect(await screen.findByText('选择可调用模型')).toBeInTheDocument();
  expect(screen.getByLabelText('选择模型')).toHaveTextContent('');
  expect(screen.queryByLabelText('需求')).not.toBeInTheDocument();
});

test('edited model switch asks for confirmation and cancel preserves current model', async () => {
  renderWithQueryClient(<Harness />);
  await selectModel();
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  fireEvent.change(await screen.findByLabelText('需求'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: '上一步' }));
  await selectModel('模型二 · v1');
  expect((await screen.findAllByText('切换模型将清空当前已填写参数，是否继续？')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: /取.*消/ }).at(-1)!);
  await waitFor(() => expect(screen.queryByText('切换模型将清空当前已填写参数，是否继续？')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(await screen.findByLabelText('需求')).toHaveValue('9');
});

test('submit lock permits only one request while pending', async () => {
  let resolve!: () => void;
  const onSubmit = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  renderWithQueryClient(<Harness onSubmit={onSubmit} />);
  await selectModel();
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  await screen.findByLabelText('需求');
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  const submit = await screen.findByRole('button', { name: '提交求解并打开详情' });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  resolve();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '创建求解任务' })).not.toBeInTheDocument());
});
