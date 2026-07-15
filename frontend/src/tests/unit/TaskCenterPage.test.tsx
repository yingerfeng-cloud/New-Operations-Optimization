import { expect, test } from 'vitest';
import { defaultTaskTab, isPollingTaskStatus, validateTimeSeriesFields } from '../../pages/TaskCenter/TaskCenterPage';
import { hasTaskBusinessExplanation, isTaskCancellable, isTaskFailed, isTaskRunning, isTaskTerminal, resolveTaskDetailDefaultTab, shouldPollTask } from '../../features/task-center/taskStatus';

test('keeps the public horizon validation helper backward compatible', () => {
  expect(validateTimeSeriesFields([], {}, { enabled: true, policy: 'runtime_variable', allowed_horizons: [24, 48, 96] }, 36)).toBe('当前模型仅支持 24、48、96 点切换，请选择有效的调度时段。');
});

test.each([['RUNNING', 'timeline'], ['PENDING', 'timeline'], ['SUCCESS', 'result'], ['FAILED', 'explain'], ['INFEASIBLE', 'explain'], ['TIMEOUT', 'explain'], ['CANCELLED', 'overview']])('task %s opens %s', (status, tab) => expect(defaultTaskTab(status)).toBe(tab));
test('failed task falls back to logs without business explanation', () => expect(defaultTaskTab('FAILED', false)).toBe('logs'));
test.each(['PENDING', 'QUEUED', 'RUNNING'])('polls %s task', status => expect(isPollingTaskStatus(status)).toBe(true));
test.each(['SUCCESS', 'FAILED', 'CANCELLED'])('stops polling %s task', status => expect(isPollingTaskStatus(status)).toBe(false));

test('failed task opens explanation only when diagnostics exist', () => {
  const base = { id: 'T1', model: 'M', scene: 'S', solver: 'HiGHS', status: 'FAILED', progress: 100, cost: 0, created_at: '' };
  expect(hasTaskBusinessExplanation({ ...base, warnings: ['时间维度不匹配'] })).toBe(true);
  expect(resolveTaskDetailDefaultTab({ ...base, warnings: ['时间维度不匹配'] })).toBe('explain');
  expect(resolveTaskDetailDefaultTab({ ...base, error: '原始求解器错误' })).toBe('logs');
});

test.each(['PENDING', 'QUEUED', 'RUNNING', 'VALIDATING', 'BUILDING_MODEL', 'SOLVING', 'FORMATTING_RESULT'])('running compatibility status %s is consistent', status => {
  expect(isTaskRunning(status)).toBe(true);
  expect(shouldPollTask(status)).toBe(true);
  expect(isTaskCancellable(status)).toBe(true);
  expect(isTaskTerminal(status)).toBe(false);
  expect(isTaskFailed(status)).toBe(false);
});
