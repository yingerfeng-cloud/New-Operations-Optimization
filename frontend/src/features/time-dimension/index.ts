import { extractDimensions } from '../model-creation/utils/modelDimensions';

export type TimeDimensionPolicy = 'not_applicable' | 'fixed' | 'runtime_variable' | 'data_derived';
export interface TimeDimensionConfig {
  schema_version?: string; enabled: boolean; policy: TimeDimensionPolicy; default_horizon?: number;
  time_set: string; state_time_set: string | null; editable: boolean; min_horizon?: number; max_horizon?: number;
  horizon_step?: number; allowed_horizons: number[]; interval_minutes?: number; delta_t?: number;
  interval_minutes_by_horizon: Record<string, number>; delta_t_by_horizon: Record<string, number>;
  derive_from?: string | null; label_set?: string; label_generation?: string; label_format?: string;
}
export interface RuntimeField {
  code: string; name: string; required: boolean; dimension: string[]; defaultValue?: unknown; exampleValue?: unknown;
  type?: string; unit?: string; description?: string; enumValues?: unknown[]; dimensionValues?: Record<string, string[]>; min?: number; max?: number;
  groupKey?: string; groupLabel?: string; groupOrder?: number; fieldOrder?: number;
  editorHint?: string; helpText?: string; dataSourceLabel?: string;
}

export const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const records = (value: unknown) => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[] : [];
const numberMap = (value: unknown) => Object.fromEntries(Object.entries(objectValue(value)).map(([key, item]) => [key, Number(item)]).filter(([, item]) => Number.isFinite(item)));

export function normalizeTimeDimension(value: unknown): TimeDimensionConfig | undefined {
  const record = objectValue(value);
  const policy = String(record.policy || '') as TimeDimensionPolicy;
  if (!['not_applicable', 'fixed', 'runtime_variable', 'data_derived'].includes(policy)) return undefined;
  return {
    schema_version: record.schema_version ? String(record.schema_version) : undefined,
    enabled: Boolean(record.enabled ?? policy !== 'not_applicable'), policy,
    default_horizon: record.default_horizon == null ? undefined : Number(record.default_horizon),
    time_set: String(record.time_set || 'time'),
    state_time_set: Object.prototype.hasOwnProperty.call(record, 'state_time_set') ? (record.state_time_set == null || record.state_time_set === '' ? null : String(record.state_time_set)) : null,
    editable: Boolean(record.editable ?? policy === 'runtime_variable'),
    min_horizon: record.min_horizon == null ? undefined : Number(record.min_horizon), max_horizon: record.max_horizon == null ? undefined : Number(record.max_horizon),
    horizon_step: record.horizon_step == null ? undefined : Number(record.horizon_step),
    allowed_horizons: Array.isArray(record.allowed_horizons) ? [...new Set(record.allowed_horizons.map(Number).filter(item => Number.isInteger(item) && item > 0))] : [],
    interval_minutes: record.interval_minutes == null ? undefined : Number(record.interval_minutes), delta_t: record.delta_t == null ? undefined : Number(record.delta_t),
    interval_minutes_by_horizon: numberMap(record.interval_minutes_by_horizon), delta_t_by_horizon: numberMap(record.delta_t_by_horizon),
    derive_from: record.derive_from == null ? null : String(record.derive_from), label_set: record.label_set ? String(record.label_set) : undefined,
    label_generation: record.label_generation ? String(record.label_generation) : undefined, label_format: record.label_format ? String(record.label_format) : undefined,
  };
}

export function resolveTimeDimension(...sources: unknown[]): TimeDimensionConfig {
  for (const source of sources) {
    const record = objectValue(source);
    const candidates = [objectValue(record.ui_metadata).time_dimension, objectValue(objectValue(record.semantic_spec).ui_metadata).time_dimension, objectValue(objectValue(record.component_spec).ui_metadata).time_dimension, objectValue(objectValue(record.generic_spec).ui_metadata).time_dimension];
    for (const candidate of candidates) { const normalized = normalizeTimeDimension(candidate); if (normalized) return normalized; }
  }
  return { enabled: false, policy: 'not_applicable', time_set: 'time', state_time_set: null, editable: false, allowed_horizons: [], interval_minutes_by_horizon: {}, delta_t_by_horizon: {} };
}

export function runtimeFieldsFromContracts(...sources: unknown[]): RuntimeField[] {
  const rows = new Map<string, RuntimeField>();
  const setValues: Record<string, string[]> = {};
  const explicitGroups = new Map<string, { key: string; label: string; order: number }>();
  const seen = new Set<unknown>();
  const visit = (source: unknown) => {
    if (!source || typeof source !== 'object' || Array.isArray(source) || seen.has(source)) return;
    seen.add(source);
    const record = objectValue(source);
    const uiMetadata = objectValue(record.ui_metadata);
    for (const group of records(uiMetadata.runtime_parameter_groups)) {
      const key = String(group.key || '');
      if (!key) continue;
      const metadata = { key, label: String(group.label || key), order: Number(group.order ?? 100) };
      const parameterCodes = Array.isArray(group.parameter_codes) ? group.parameter_codes : [];
      parameterCodes.forEach(code => explicitGroups.set(String(code), metadata));
    }
    for (const item of records(record.sets)) {
      const code = String(item.code || item.name || '');
      const values = Array.isArray(item.values) ? item.values : Array.isArray(item.members) ? item.members : [];
      if (code && values.length) setValues[code] = values.map(String);
    }
    for (const [code, value] of Object.entries(objectValue(record.sets))) if (Array.isArray(value)) setValues[code] = value.map(String);
    for (const item of [...records(record.parameters), ...records(record.runtime_parameters), ...records(record.parameter_bindings)]) {
      const code = String(item.code || item.math_param || item.key || item.parameter || item.parameter_code || item.model_parameter || '');
      if (!code) continue;
      const existing = rows.get(code);
      rows.set(code, {
        code, name: String(item.name || item.label || item.display_name || existing?.name || code), required: Boolean(item.required ?? existing?.required),
        dimension: extractDimensions(item).length ? extractDimensions(item) : existing?.dimension || [], defaultValue: item.default ?? item.defaultValue ?? existing?.defaultValue,
        exampleValue: item.example ?? item.exampleValue ?? item.sample ?? existing?.exampleValue, type: String(item.type || item.value_type || existing?.type || ''),
        unit: String(item.unit || existing?.unit || ''), description: String(item.description || existing?.description || ''), enumValues: Array.isArray(item.enum) ? item.enum : existing?.enumValues,
        min: item.min == null ? existing?.min : Number(item.min), max: item.max == null ? existing?.max : Number(item.max),
        groupKey: String(item.ui_group || existing?.groupKey || '') || undefined, groupLabel: String(item.ui_group_label || existing?.groupLabel || '') || undefined,
        groupOrder: item.ui_group_order == null ? existing?.groupOrder : Number(item.ui_group_order), fieldOrder: item.ui_order == null ? existing?.fieldOrder : Number(item.ui_order),
        editorHint: String(item.ui_editor || existing?.editorHint || '') || undefined, helpText: String(item.ui_help || existing?.helpText || '') || undefined,
        dataSourceLabel: String(item.ui_data_source || existing?.dataSourceLabel || '') || undefined,
      });
    }
    ['input_schema', 'parameter_schema', 'semantic_schema', 'input_contract', 'semantic_spec', 'component_spec'].forEach(key => visit(record[key]));
  };
  sources.forEach(visit);
  return [...rows.values()].map(field => {
    const explicit = explicitGroups.get(field.code);
    return {
      ...field,
      groupKey: explicit?.key || field.groupKey,
      groupLabel: explicit?.label || field.groupLabel,
      groupOrder: explicit?.order ?? field.groupOrder,
      dimensionValues: Object.fromEntries(field.dimension.filter(code => setValues[code]).map(code => [code, setValues[code]])),
    };
  });
}

export function managedTimeFields(config: TimeDimensionConfig) {
  if (!config.enabled) return new Set<string>();
  const fields = new Set(['horizon', config.time_set]);
  if (config.state_time_set) fields.add(config.state_time_set);
  if (config.label_generation === 'auto' && config.label_set) fields.add(config.label_set);
  if (config.interval_minutes !== undefined || Object.keys(config.interval_minutes_by_horizon).length || config.label_generation === 'auto') fields.add('interval_minutes');
  if (config.delta_t !== undefined || Object.keys(config.delta_t_by_horizon).length || fields.has('interval_minutes')) fields.add('delta_t');
  return fields;
}

export const stripSystemTimeParameters = (parameters: Record<string, unknown>, config: TimeDimensionConfig) => Object.fromEntries(Object.entries(parameters).filter(([key]) => !managedTimeFields(config).has(key)));

function axisLength(value: unknown, axis: number) {
  let current = value;
  for (let index = 0; index < axis; index += 1) {
    const values = Array.isArray(current) ? current : Object.values(objectValue(current));
    if (!values.length) return undefined;
    current = values[0];
  }
  const length = Array.isArray(current) ? current.length : Object.keys(objectValue(current)).length;
  return length > 0 ? length : undefined;
}

export function isRuntimeValueEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.length === 0 || value.every(isRuntimeValueEmpty);
  if (typeof value === 'object') {
    const values = Object.values(value as Record<string, unknown>);
    return values.length === 0 || values.every(isRuntimeValueEmpty);
  }
  return false;
}

export function deriveHorizon(config: TimeDimensionConfig, fields: RuntimeField[], parameters: Record<string, unknown>, selected?: number) {
  if (config.policy === 'data_derived' && config.derive_from) {
    if (isRuntimeValueEmpty(parameters[config.derive_from])) return undefined;
    const field = fields.find(item => item.code === config.derive_from);
    const axis = field?.dimension.indexOf(config.time_set) ?? -1;
    if (axis < 0) return undefined;
    return axisLength(parameters[config.derive_from], axis);
  }
  return selected !== undefined ? selected : config.default_horizon;
}

export function validateRuntimeTimeDimension(config: TimeDimensionConfig, fields: RuntimeField[], parameters: Record<string, unknown>, selected?: number) {
  if (!config.enabled) return [];
  const errors: string[] = [];
  const horizon = deriveHorizon(config, fields, parameters, selected);
  if (config.policy === 'data_derived') {
    const source = config.derive_from || '未配置的推导来源';
    const field = fields.find(item => item.code === config.derive_from);
    if (!field || !field.dimension.length) {
      errors.push(`参数 ${source} 缺少维度声明，未明确引用时间点集合 ${config.time_set}，不能作为 horizon 推导来源。请补充维度元数据或修改 derive_from。`);
      return errors;
    }
    if (!field.dimension.includes(config.time_set)) {
      errors.push(`参数 ${source} 的维度为 [${field.dimension.join(', ')}]，未引用时间点集合 ${config.time_set}，不能作为 horizon 推导来源。请修改模型时间维度契约中的 derive_from，或为该参数补充 ${config.time_set} 维度。`);
      return errors;
    }
  }
  if (config.policy === 'data_derived' && (!Number.isFinite(horizon) || !Number.isInteger(horizon) || Number(horizon) <= 0)) {
    const source = config.derive_from || '未配置的推导来源';
    const field = fields.find(item => item.code === config.derive_from);
    const current = parameters[source];
    const state = current === undefined ? '缺失' : isRuntimeValueEmpty(current) ? '为空' : '结构无法识别';
    errors.push(`无法从参数 ${source} 推导调度时段。字段 ${field?.name || source} 当前${state}，请按维度 [${field?.dimension.join(', ') || config.time_set}] 至少提供一个有效时间点。`);
    return errors;
  }
  if (config.policy === 'runtime_variable' && (!Number.isFinite(horizon) || !Number.isInteger(horizon) || Number(horizon) <= 0)) errors.push('当前 horizon 必须为大于 0 的整数。');
  if (!Number.isFinite(horizon) || !Number.isInteger(horizon) || Number(horizon) <= 0) return errors;
  const value = Number(horizon);
  if (config.allowed_horizons.length && !config.allowed_horizons.includes(value)) errors.push(`当前 horizon 为 ${value}。该模型仅允许 ${config.allowed_horizons.join('、')}。`);
  if (config.min_horizon !== undefined && value < config.min_horizon) errors.push(`当前 horizon 为 ${value}，不能小于 ${config.min_horizon}。`);
  if (config.max_horizon !== undefined && value > config.max_horizon) errors.push(`当前 horizon 为 ${value}，不能大于 ${config.max_horizon}。`);
  if (!config.allowed_horizons.length && config.horizon_step && config.horizon_step > 0) {
    const base = config.min_horizon ?? config.default_horizon ?? 0;
    if ((value - base) % config.horizon_step !== 0) {
      const options: number[] = [];
      const start = config.min_horizon ?? base;
      const end = config.max_horizon ?? (start + config.horizon_step * 7);
      for (let item = start; item <= end && options.length < 12; item += config.horizon_step) options.push(item);
      errors.push(`当前 horizon 为 ${value}。该模型允许范围为 ${config.min_horizon ?? 1}～${config.max_horizon ?? '不限'}，步长为 ${config.horizon_step}，可选值包括 ${options.join('、')}。`);
    }
  }
  for (const field of fields) {
    const timeAxis = field.dimension.findIndex(item => item === config.time_set || item === config.state_time_set);
    if (timeAxis < 0 || parameters[field.code] === undefined) continue;
    const expected = field.dimension[timeAxis] === config.state_time_set ? value + 1 : value;
    const actual = axisLength(parameters[field.code], timeAxis);
    if (actual !== expected) errors.push(`${field.name}（${field.code}）时间维长度应为 ${expected}，当前为 ${actual ?? '无法识别'}`);
  }
  return errors;
}

export function timeDimensionLabel(config: TimeDimensionConfig, selected?: number) {
  if (config.policy === 'not_applicable') return '非时序模型';
  if (config.policy === 'fixed') return `固定 ${config.default_horizon ?? '-'} 点`;
  if (config.policy === 'data_derived') return `由 ${config.derive_from || '主时间序列'} 自动推导`;
  if (config.allowed_horizons.length) return `候选周期：${config.allowed_horizons.join(' / ')} 点`;
  return `运行时可调${selected ? `：${selected} 点` : ''}`;
}
