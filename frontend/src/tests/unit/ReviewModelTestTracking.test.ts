import { beforeEach, vi } from 'vitest';
import { testModel } from '../../api/models';
import { readModelTest } from '../../api/modelTestTracking';

const state = vi.hoisted(() => ({ model: {} as Record<string, any>, contexts: {} as Record<string, any>, post: vi.fn(), task: vi.fn(), count: 0 }));
vi.mock('../../api/client', () => ({ apiClient: {
  get: async (path: string) => ({ data: structuredClone(path.startsWith('/api/models/') ? state.model : { id: path.split('/').at(-1), status: 'SUCCESS', trace: { model_test: state.contexts[path.split('/').at(-1)!] } }) }),
  post: state.post,
}, unwrap: async (value: Promise<{ data: unknown }>) => (await value).data }));
vi.mock('../../api/tasks', () => ({ getTask: state.task }));
beforeEach(() => {
  vi.clearAllMocks(); state.count = 0; state.contexts = {};
  state.model = { id: 'A', status: 'developing', content_hash: 'source-v1' };
  state.post.mockImplementation(async (_path: string, body: { idempotency_key: string }) => {
    const source = state.model.content_hash;
    const id = `T${++state.count}`;
    const target = state.count === 1 ? 'bound-v1' : source;
    state.contexts[id] = { model_id: 'A', source_content_hash: source, tested_content_hash: target, submission_key: body.idempotency_key };
    Object.assign(state.model, { test_task_id: id, status: 'trial', content_hash: target, tested_content_hash: target, tested_model_id: 'A' });
    return { data: { id, status: 'SOLVING' } };
  });
  state.task.mockImplementation(async (id: string) => ({ id, status: 'SUCCESS', trace: { model_test: state.contexts[id] } }));
});

test('a failed poll resumes the original task after the server records the bound hash', async () => {
  state.task.mockRejectedValueOnce(new Error('503'));
  await expect(testModel('A', { volume: 10 })).rejects.toThrow('503');
  expect(readModelTest('A')?.taskId).toBe('T1');
  const tested = await testModel('A', { volume: 10 });
  expect(tested.tested_content_hash).toBe('bound-v1');
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(readModelTest('A')?.finished).toBe(true);
});

test('an uncertain POST recovers the server task pointer and submission key', async () => {
  const submit = state.post.getMockImplementation()!;
  state.post.mockImplementationOnce(async (...args) => { await submit(...args); throw new Error('response lost'); });
  await expect(testModel('A', { volume: 10 })).rejects.toThrow('response lost');
  expect(readModelTest('A')?.taskId).toBeUndefined();
  await testModel('A', { volume: 10 });
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.task).toHaveBeenCalledWith('T1');
});

test('a deliberately changed content hash cannot reuse the old task or key', async () => {
  state.task.mockRejectedValueOnce(new Error('503'));
  await expect(testModel('A', { volume: 10 })).rejects.toThrow('503');
  const oldKey = readModelTest('A')?.key;
  Object.assign(state.model, { status: 'developing', content_hash: 'edited-v2' });
  await testModel('A', { volume: 10 });
  expect(state.post).toHaveBeenCalledTimes(2);
  expect(state.post.mock.calls[1][1].idempotency_key).not.toBe(oldKey);
  expect(state.task).toHaveBeenLastCalledWith('T2');
});
