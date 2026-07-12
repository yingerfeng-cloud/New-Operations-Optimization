import { expect, test } from 'vitest';
import { defaultTaskTab, isPollingTaskStatus, validateTimeSeriesFields } from '../../pages/TaskCenter/TaskCenterPage';

test('keeps the public horizon validation helper backward compatible', () => {
  expect(validateTimeSeriesFields([], {}, { enabled: true, policy: 'runtime_variable', allowed_horizons: [24, 48, 96] }, 36)).toBe('当前模型仅支持 24、48、96 点切换，请选择有效的调度时段。');
});

test.each([['RUNNING', 'timeline'], ['PENDING', 'timeline'], ['SUCCESS', 'result'], ['FAILED', 'explain'], ['INFEASIBLE', 'explain'], ['TIMEOUT', 'explain'], ['CANCELLED', 'overview']])('task %s opens %s', (status, tab) => expect(defaultTaskTab(status)).toBe(tab));
test('failed task falls back to logs without business explanation', () => expect(defaultTaskTab('FAILED', false)).toBe('logs'));
test.each(['PENDING', 'QUEUED', 'RUNNING'])('polls %s task', status => expect(isPollingTaskStatus(status)).toBe(true));
test.each(['SUCCESS', 'FAILED', 'CANCELLED'])('stops polling %s task', status => expect(isPollingTaskStatus(status)).toBe(false));
