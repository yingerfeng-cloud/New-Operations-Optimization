import { describe, expect, test } from 'vitest';
import { buildTaskPayload } from '../../features/task-create/utils/buildTaskPayload';
import { parseTaskRuntimeJson } from '../../features/task-create/TaskCreateWizard';
import { deriveHorizon, managedTimeFields, validateRuntimeTimeDimension, type RuntimeField, type TimeDimensionConfig } from '../../features/time-dimension';

const base = (overrides: Partial<TimeDimensionConfig>): TimeDimensionConfig => ({ enabled: true, policy: 'fixed', time_set: 'time', state_time_set: null, editable: false, allowed_horizons: [], interval_minutes_by_horizon: {}, delta_t_by_horizon: {}, ...overrides });
const series: RuntimeField = { code: 'load_forecast', name: '负荷预测', required: true, dimension: ['time'] };

describe('task create contract gate', () => {
  test('runtime JSON import requires an object root', () => {
    expect(parseTaskRuntimeJson('{"load":[1,2,3]}')).toEqual({ load: [1, 2, 3] });
    expect(() => parseTaskRuntimeJson('[1,2,3]')).toThrow('运行参数 JSON 的根节点必须为对象，例如 {"load": [1,2,3]}。');
    expect(() => parseTaskRuntimeJson('null')).toThrow('运行参数 JSON 的根节点必须为对象，例如 {"load": [1,2,3]}。');
  });
  test('not_applicable never injects horizon', () => {
    const config = base({ enabled: false, policy: 'not_applicable' });
    const payload = buildTaskPayload({ model_id: 'm1', solver: 'HiGHS', horizon: 24, parameters: { demand: 100 } }, config);
    expect(payload).not.toHaveProperty('horizon');
    expect(payload.runtime_parameters).toEqual({ demand: 100 });
  });

  test('fixed horizon is read-only and omitted from legacy payload fields', () => {
    const config = base({ policy: 'fixed', default_horizon: 24 });
    const payload = buildTaskPayload({ model_id: 'm1', solver: 'HiGHS', horizon: 24, parameters: { horizon: 96, demand: 100 } }, config);
    expect(payload).not.toHaveProperty('horizon');
    expect(payload.runtime_parameters).toEqual({ demand: 100 });
    expect(payload.parameters).toEqual(payload.runtime_parameters);
  });

  test('runtime choice horizon is submitted in all backward-compatible locations', () => {
    const config = base({ policy: 'runtime_variable', editable: true, allowed_horizons: [24, 48, 96] });
    const payload = buildTaskPayload({ model_id: 'm1', solver: 'HiGHS', horizon: 96, parameters: { load_forecast: Array(96).fill(1) } }, config);
    expect(payload.horizon).toBe(96);
    expect(payload.runtime_parameters).toMatchObject({ horizon: 96 });
    expect(payload.parameters).toEqual(payload.runtime_parameters);
  });

  test('free horizon validates range and time series length', () => {
    const config = base({ policy: 'runtime_variable', editable: true, min_horizon: 12, max_horizon: 96 });
    expect(validateRuntimeTimeDimension(config, [series], { load_forecast: Array(24).fill(1) }, 24)).toEqual([]);
    expect(validateRuntimeTimeDimension(config, [series], { load_forecast: Array(12).fill(1) }, 24)[0]).toContain('长度应为 24');
  });

  test('data_derived horizon follows the declared field', () => {
    const config = base({ policy: 'data_derived', derive_from: 'load_forecast' });
    expect(deriveHorizon(config, [series], { load_forecast: Array(48).fill(1) })).toBe(48);
  });

  test.each([
    ['missing', undefined],
    ['empty array', []],
    ['empty nested array', [[]]],
  ])('data_derived blocks %s source', (_label, source) => {
    const config = base({ policy: 'data_derived', derive_from: 'load_forecast' });
    const errors = validateRuntimeTimeDimension(config, [series], { load_forecast: source });
    expect(errors[0]).toContain('无法从参数 load_forecast 推导调度时段');
  });

  test('data_derived uses the declared time axis for multi-dimensional sources', () => {
    const stationTime: RuntimeField = { code: 'station_load', name: '站点负荷', required: false, dimension: ['station', 'time'] };
    const timeStation: RuntimeField = { code: 'time_load', name: '时点负荷', required: false, dimension: ['time', 'station'] };
    expect(deriveHorizon(base({ policy: 'data_derived', derive_from: 'station_load' }), [stationTime], { station_load: [Array(24).fill(1), Array(24).fill(2)] })).toBe(24);
    expect(deriveHorizon(base({ policy: 'data_derived', derive_from: 'time_load' }), [timeStation], { time_load: Array.from({ length: 48 }, () => [1, 2]) })).toBe(48);
  });

  test.each([
    [['station'], [100, 200]],
    [['station', 'unit'], [[1, 2], [3, 4]]],
    [[], [1, 2, 3]],
  ])('data_derived rejects source dimension %j without time', (dimension, value) => {
    const source: RuntimeField = { code: 'station_capacity', name: '电站容量', required: false, dimension };
    const config = base({ policy: 'data_derived', derive_from: source.code, time_set: 'time' });
    expect(deriveHorizon(config, [source], { [source.code]: value })).toBeUndefined();
    expect(validateRuntimeTimeDimension(config, [source], { [source.code]: value }).join(' ')).toContain(dimension.length ? '未引用时间点集合 time' : '缺少维度声明');
  });

  test.each([
    [0, '大于 0 的整数'],
    [13, '步长为 12'],
    [25, '步长为 12'],
    [95, '步长为 12'],
    [6, '不能小于 12'],
    [108, '不能大于 96'],
    [24.5, '大于 0 的整数'],
  ])('free horizon %s is rejected', (horizon, message) => {
    const config = base({ policy: 'runtime_variable', min_horizon: 12, max_horizon: 96, horizon_step: 12, default_horizon: 24 });
    expect(validateRuntimeTimeDimension(config, [], {}, horizon).join(' ')).toContain(message);
  });

  test.each([12, 24, 36, 48, 60, 72, 84, 96])('free horizon %s satisfies step', horizon => {
    const config = base({ policy: 'runtime_variable', min_horizon: 12, max_horizon: 96, horizon_step: 12, default_horizon: 24 });
    expect(validateRuntimeTimeDimension(config, [], {}, horizon)).toEqual([]);
  });

  test('state time uses horizon plus one and remains optional when null', () => {
    const state: RuntimeField = { code: 'storage_volume', name: '库容状态', required: true, dimension: ['reservoir', 'time_volume'] };
    const config = base({ policy: 'fixed', default_horizon: 24, state_time_set: 'time_volume' });
    expect(validateRuntimeTimeDimension(config, [state], { storage_volume: [Array(25).fill(1)] })).toEqual([]);
    expect(validateRuntimeTimeDimension(config, [state], { storage_volume: [Array(24).fill(1)] })[0]).toContain('长度应为 25');
    expect(managedTimeFields(base({ state_time_set: null })).has('time_volume')).toBe(false);
  });

  test('managed granularity is filtered only when the contract owns it', () => {
    expect(managedTimeFields(base({ interval_minutes: 15, delta_t: 0.25 })).has('delta_t')).toBe(true);
    expect(managedTimeFields(base({ interval_minutes: undefined, delta_t: undefined })).has('delta_t')).toBe(false);
  });
});
