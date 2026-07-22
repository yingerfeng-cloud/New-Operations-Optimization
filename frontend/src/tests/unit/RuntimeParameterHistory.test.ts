import { expect, test } from 'vitest';
import { resolveTimeDimension, type RuntimeField } from '../../features/time-dimension';
import { isCompatibleHistoricalTask, mergeHistoricalParameters } from '../../features/task-create/utils/runtimeParameterHistory';
import type { SolveTask } from '../../types/task';

const task = (patch: Partial<SolveTask>): SolveTask => ({ id: 'T1', scene: '', model: '', solver: 'HiGHS', status: 'SUCCESS', progress: 100, cost: 0, created_at: '', ...patch });

test('only accepts completed tasks from the same model or family', () => {
  expect(isCompatibleHistoricalTask(task({ model_id: 'M1' }), 'M1')).toBe(true);
  expect(isCompatibleHistoricalTask(task({ status: 'RUNNING', model_id: 'M1' }), 'M1')).toBe(false);
  expect(isCompatibleHistoricalTask(task({ resolved_model_code: 'F1' }), 'M2', 'F1')).toBe(true);
});

test('supports overwrite and fill-empty while filtering unknown and system time fields', () => {
  const fields: RuntimeField[] = [{ code: 'a', name: 'A', required: false, dimension: [] }, { code: 'b', name: 'B', required: false, dimension: [] }];
  const config = { ...resolveTimeDimension(), enabled: true, policy: 'fixed' as const, time_set: 'time' };
  const incoming = { a: 9, b: 2, horizon: 48, unknown: 1 };
  const fill = mergeHistoricalParameters({ current: { a: 1 }, incoming, fields, config, mode: 'fill-empty' });
  expect(fill.parameters).toEqual({ a: 1, b: 2 }); expect(fill.unknown).toEqual(['unknown']); expect(fill.ignoredSystem).toEqual(['horizon']);
  expect(mergeHistoricalParameters({ current: { a: 1 }, incoming, fields, config, mode: 'overwrite' }).parameters.a).toBe(9);
});

test('fill-empty uses recursive runtime emptiness without overwriting valid falsy values', () => {
  const fields: RuntimeField[] = ['nestedArray', 'nestedObject', 'zero', 'flag', 'partial'].map(code => ({ code, name: code, required: false, dimension: [] }));
  const current = { nestedArray: [[]], nestedObject: { a: '', b: null }, zero: 0, flag: false, partial: { a: '', b: 1 } };
  const incoming = { nestedArray: [[3]], nestedObject: { a: 2 }, zero: 9, flag: true, partial: { a: 2 } };
  const result = mergeHistoricalParameters({ current, incoming, fields, config: resolveTimeDimension(), mode: 'fill-empty' });
  expect(result.parameters).toEqual({ nestedArray: [[3]], nestedObject: { a: 2 }, zero: 0, flag: false, partial: { a: '', b: 1 } });
  expect(result.applied).toEqual(['nestedArray', 'nestedObject']);
});
