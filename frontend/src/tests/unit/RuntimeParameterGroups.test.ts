import { describe, expect, test } from 'vitest';
import { resolveTimeDimension, runtimeFieldsFromContracts, type RuntimeField } from '../../features/time-dimension';
import { filterRuntimeFields, groupRuntimeFields, runtimeFieldIssues, runtimeGroupStats } from '../../features/task-create/utils/runtimeParameterGroups';

const config = { ...resolveTimeDimension(), enabled: true, policy: 'fixed' as const, time_set: 'time', state_time_set: 'state_time' };

describe('runtime parameter grouping', () => {
  test('uses model groups before parameter groups and keeps ordering', () => {
    const source = { ui_metadata: { runtime_parameter_groups: [{ key: 'forecast', label: '预测数据', order: 2, parameter_codes: ['load'] }] }, parameters: [{ code: 'load', name: '负荷', required: true, dimension: ['time'], ui_group: 'self', ui_order: 3 }] };
    const fields = runtimeFieldsFromContracts(source);
    expect(fields[0]).toMatchObject({ groupKey: 'forecast', groupLabel: '预测数据', groupOrder: 2, fieldOrder: 3 });
    expect(groupRuntimeFields(fields, config)[0].label).toBe('预测数据');
  });

  test('reads array input schema metadata and preserves it when semantic fields omit flags', () => {
    const source = {
      input_schema: [{
        key: 'unit_max_output', name: '机组最大出力', required: true, dimension: ['unit'], type: 'dict',
        default_value: { U1: 100 }, sample_value: { U1: 120, U2: 90 }, sets: { unit: ['U1', 'U2'] }, validation: { min: 0 },
      }],
      semantic_spec: { parameters: [{ code: 'unit_max_output', name: '机组最大出力', dimension: ['unit'] }] },
    };
    expect(runtimeFieldsFromContracts(source)[0]).toMatchObject({
      code: 'unit_max_output', required: true, type: 'dict', dimension: ['unit'], min: 0,
      defaultValue: { U1: 100 }, exampleValue: { U1: 120, U2: 90 }, dimensionValues: { unit: ['U1', 'U2'] },
    });
  });

  test('uses the declared input schema as the runtime-field allowlist', () => {
    const fields = runtimeFieldsFromContracts({
      input_schema: [
        { key: 'station', name: '电站清单', required: true, type: 'list', sample_value: ['S1'] },
        { key: 'availability', name: '机组可用状态', required: true, type: 'dict', dimension: ['unit', 'time'], sample_value: { U1: [1, 1] } },
      ],
      component_spec: { parameters: [{ code: 'station_pmax', name: '电站可用容量', dimension: ['station', 'time'], default: 100 }] },
    });
    expect(fields.map(field => field.code)).toEqual(['station', 'availability']);
  });

  test('maps a time error to the exact parameter code instead of its prefix', () => {
    const groups = groupRuntimeFields([
      { code: 'station', name: '电站清单', required: true, dimension: [] },
      { code: 'station_pmax', name: '电站可用容量', required: false, dimension: ['station', 'time'] },
    ], config);
    const issues = runtimeFieldIssues(groups, { station: ['S1'], station_pmax: 100 }, {}, ['电站可用容量（station_pmax）时间维长度应为 4，当前为无法识别']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'station_pmax', name: '电站可用容量' });
  });

  test('falls back from structure without name keyword classification', () => {
    const fields: RuntimeField[] = [
      { code: 'x', name: '任意', required: false, dimension: [] },
      { code: 'y', name: '任意', required: true, dimension: ['time'] },
      { code: 'z', name: '任意', required: false, dimension: ['plant', 'time'] },
      { code: 'q', name: '任意', required: false, dimension: ['a', 'b', 'c'] },
    ];
    expect(groupRuntimeFields(fields, config).map(group => group.label)).toEqual(['基础参数', '时间序列', '矩阵参数', '高级结构']);
  });

  test('filters required, errors and modified without changing values', () => {
    const fields: RuntimeField[] = [{ code: 'a', name: 'A', required: true, dimension: [] }, { code: 'b', name: 'B', required: false, dimension: [] }];
    const values = { a: 1, b: 2 }; const defaults = { a: 1, b: 0 }; const errors = { a: '错误' };
    expect(filterRuntimeFields(fields, 'required', values, defaults, errors).map(field => field.code)).toEqual(['a']);
    expect(filterRuntimeFields(fields, 'error', values, defaults, errors).map(field => field.code)).toEqual(['a']);
    expect(filterRuntimeFields(fields, 'modified', values, defaults, errors).map(field => field.code)).toEqual(['b']);
    expect(values).toEqual({ a: 1, b: 2 });
    expect(runtimeGroupStats({ key: 'g', label: 'G', order: 1, fields }, values, errors, defaults)).toMatchObject({ filled: 2, total: 2, completed: 1, required: 1, errors: 1, modified: 1 });
  });
});
