import { describe, expect, test } from 'vitest';
import { resolveTimeDimension, runtimeFieldsFromContracts, type RuntimeField } from '../../features/time-dimension';
import { filterRuntimeFields, groupRuntimeFields, runtimeGroupStats } from '../../features/task-create/utils/runtimeParameterGroups';

const config = { ...resolveTimeDimension(), enabled: true, policy: 'fixed' as const, time_set: 'time', state_time_set: 'state_time' };

describe('runtime parameter grouping', () => {
  test('uses model groups before parameter groups and keeps ordering', () => {
    const source = { ui_metadata: { runtime_parameter_groups: [{ key: 'forecast', label: '预测数据', order: 2, parameter_codes: ['load'] }] }, parameters: [{ code: 'load', name: '负荷', required: true, dimension: ['time'], ui_group: 'self', ui_order: 3 }] };
    const fields = runtimeFieldsFromContracts(source);
    expect(fields[0]).toMatchObject({ groupKey: 'forecast', groupLabel: '预测数据', groupOrder: 2, fieldOrder: 3 });
    expect(groupRuntimeFields(fields, config)[0].label).toBe('预测数据');
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
    expect(runtimeGroupStats({ key: 'g', label: 'G', order: 1, fields }, values, errors, defaults)).toMatchObject({ completed: 1, required: 1, errors: 1, modified: 1 });
  });
});
