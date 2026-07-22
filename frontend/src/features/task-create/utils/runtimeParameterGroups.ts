import type { RuntimeField, TimeDimensionConfig } from '../../time-dimension';
import { isRuntimeValueEmpty } from '../../time-dimension';
import { parameterEditorKind } from '../components/ParameterEditor';

export type RuntimeParameterFilter = 'all' | 'required' | 'error' | 'modified';

export interface RuntimeParameterGroup {
  key: string;
  label: string;
  order: number;
  description?: string;
  fields: RuntimeField[];
}

export interface RuntimeFieldIssue {
  code: string;
  name: string;
  groupKey: string;
  groupLabel: string;
  message: string;
  fixHint: string;
}

function fallbackGroup(field: RuntimeField, config: TimeDimensionConfig) {
  const kind = parameterEditorKind(field);
  if (kind === 'matrix') return { key: 'matrix', label: '矩阵参数', order: 50 };
  if (kind === 'structured') return { key: 'structured', label: '高级结构', order: 60 };
  if (config.state_time_set && field.dimension.includes(config.state_time_set)) return { key: 'state-series', label: '状态序列', order: 30 };
  if (field.dimension.includes(config.time_set)) return { key: 'time-series', label: '时间序列', order: 20 };
  if (kind === 'keyvalue') return { key: 'key-value', label: '键值参数', order: 40 };
  return { key: 'basic', label: '基础参数', order: 10 };
}

export function groupRuntimeFields(fields: RuntimeField[], config: TimeDimensionConfig): RuntimeParameterGroup[] {
  const groups = new Map<string, RuntimeParameterGroup>();
  fields.forEach(field => {
    const fallback = fallbackGroup(field, config);
    const key = field.groupKey || fallback.key;
    const current = groups.get(key) || {
      key,
      label: field.groupLabel || fallback.label,
      order: field.groupOrder ?? fallback.order,
      fields: [],
    };
    current.fields.push(field);
    groups.set(key, current);
  });
  return [...groups.values()]
    .map(group => ({ ...group, fields: [...group.fields].sort((a, b) => (a.fieldOrder ?? 100) - (b.fieldOrder ?? 100) || a.name.localeCompare(b.name, 'zh-CN')) }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-CN'));
}

export function runtimeFieldIssues(
  groups: RuntimeParameterGroup[],
  values: Record<string, unknown>,
  editorErrors: Record<string, string>,
  timeErrors: string[] = [],
): RuntimeFieldIssue[] {
  const result: RuntimeFieldIssue[] = [];
  groups.forEach(group => group.fields.forEach(field => {
    const message = editorErrors[field.code] || (field.required && isRuntimeValueEmpty(values[field.code]) ? '必填值为空' : '');
    if (message) result.push({ code: field.code, name: field.name, groupKey: group.key, groupLabel: group.label, message, fixHint: field.helpText || '请按模型参数契约补充有效值并重新检查。' });
  }));
  timeErrors.forEach(message => {
    const field = groups.flatMap(group => group.fields.map(item => ({ group, field: item }))).find(({ field: item }) => message.includes(item.code) || message.includes(item.name));
    if (field && !result.some(item => item.code === field.field.code && item.message === message)) {
      result.push({ code: field.field.code, name: field.field.name, groupKey: field.group.key, groupLabel: field.group.label, message, fixHint: field.field.helpText || '请检查时间维度长度与当前 horizon 是否一致。' });
    }
  });
  return result;
}

export function filterRuntimeFields(
  fields: RuntimeField[],
  filter: RuntimeParameterFilter,
  values: Record<string, unknown>,
  defaultValues: Record<string, unknown>,
  errors: Record<string, string>,
) {
  if (filter === 'required') return fields.filter(field => field.required);
  if (filter === 'error') return fields.filter(field => Boolean(errors[field.code]) || (field.required && isRuntimeValueEmpty(values[field.code])));
  if (filter === 'modified') return fields.filter(field => isRuntimeValueModified(values[field.code], defaultValues[field.code]));
  return fields;
}

export function isRuntimeValueModified(value: unknown, defaultValue: unknown) {
  return JSON.stringify(value ?? null) !== JSON.stringify(defaultValue ?? null);
}

export function runtimeGroupStats(group: RuntimeParameterGroup, values: Record<string, unknown>, errors: Record<string, string>, defaults: Record<string, unknown>) {
  const required = group.fields.filter(field => field.required);
  return {
    completed: required.filter(field => !isRuntimeValueEmpty(values[field.code])).length,
    required: required.length,
    errors: group.fields.filter(field => Boolean(errors[field.code]) || (field.required && isRuntimeValueEmpty(values[field.code]))).length,
    modified: group.fields.filter(field => isRuntimeValueModified(values[field.code], defaults[field.code])).length,
  };
}
