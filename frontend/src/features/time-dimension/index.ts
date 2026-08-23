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
  editorHint?: string; helpText?: string; dataSourceLabel?: string; sourceSystem?: string; defaultPolicy?: string;
  role?: 'parameter' | 'set_members' | 'time_labels'; editable?: boolean;
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
  const authoritativeInputCodes = new Set<string>();
  const setValues: Record<string, string[]> = {};
  const setMetadata = new Map<string, { editable?: boolean; sourceSystem?: string }>();
  const timeLabelSets = new Set<string>();
  const explicitGroups = new Map<string, { key: string; label: string; order: number }>();
  const seen = new Set<unknown>();
  const addField = (item: Record<string, unknown>) => {
    const code = String(item.code || item.math_param || item.key || item.parameter || item.parameter_code || item.model_parameter || '');
    if (!code) return;
    const existing = rows.get(code);
    const validation = objectValue(item.validation);
    const editableValue = item.runtime_editable ?? item.editable;
    const rawRole = String(item.field_role || item.semantic_role || item.ui_role || existing?.role || '');
    for (const [dimension, values] of Object.entries(objectValue(item.sets))) {
      if (Array.isArray(values) && values.length) setValues[dimension] = values.map(String);
    }
    rows.set(code, {
      code, name: String(item.name || item.label || item.display_name || existing?.name || code), required: Boolean(item.required ?? existing?.required),
      dimension: extractDimensions(item).length ? extractDimensions(item) : existing?.dimension || [],
      defaultValue: item.default ?? item.defaultValue ?? item.default_value ?? existing?.defaultValue,
      exampleValue: item.example ?? item.exampleValue ?? item.sample ?? item.sample_value ?? existing?.exampleValue,
      type: String(item.type || item.value_type || existing?.type || ''),
      unit: String(item.unit || existing?.unit || ''), description: String(item.description || existing?.description || ''),
      enumValues: Array.isArray(item.enum) ? item.enum : Array.isArray(validation.enum) ? validation.enum : existing?.enumValues,
      min: item.min == null && validation.min == null ? existing?.min : Number(item.min ?? validation.min),
      max: item.max == null && validation.max == null ? existing?.max : Number(item.max ?? validation.max),
      groupKey: String(item.ui_group || existing?.groupKey || '') || undefined, groupLabel: String(item.ui_group_label || existing?.groupLabel || '') || undefined,
      groupOrder: item.ui_group_order == null ? existing?.groupOrder : Number(item.ui_group_order), fieldOrder: item.ui_order == null ? existing?.fieldOrder : Number(item.ui_order),
      editorHint: String(item.ui_editor || existing?.editorHint || '') || undefined, helpText: String(item.ui_help || existing?.helpText || '') || undefined,
      dataSourceLabel: String(item.ui_data_source || existing?.dataSourceLabel || '') || undefined,
      sourceSystem: String(item.source_system || existing?.sourceSystem || '') || undefined,
      defaultPolicy: String(item.default_policy || existing?.defaultPolicy || '') || undefined,
      role: ['parameter', 'set_members', 'time_labels'].includes(rawRole) ? rawRole as RuntimeField['role'] : existing?.role,
      editable: editableValue == null ? existing?.editable : Boolean(editableValue),
    });
  };
  const rememberInputCodes = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return;
        const record = objectValue(item);
        const code = String(record.code || record.math_param || record.key || record.parameter || record.parameter_code || record.model_parameter || '');
        if (code) authoritativeInputCodes.add(code);
      });
      return;
    }
    const record = objectValue(value);
    [...records(record.parameters), ...records(record.runtime_parameters), ...records(record.parameter_bindings)].forEach(item => {
      const code = String(item.code || item.math_param || item.key || item.parameter || item.parameter_code || item.model_parameter || '');
      if (code) authoritativeInputCodes.add(code);
    });
  };
  sources.forEach(source => {
    const record = objectValue(source);
    rememberInputCodes(record.input_schema);
    rememberInputCodes(record.input_contract);
    const semantic = objectValue(record.semantic_spec);
    rememberInputCodes(semantic.input_schema);
    rememberInputCodes(semantic.input_contract);
    const draft = objectValue(record.model_draft);
    rememberInputCodes(draft.input_schema);
    rememberInputCodes(draft.input_contract);
  });
  const visit = (source: unknown) => {
    if (Array.isArray(source)) {
      source.forEach(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return;
        addField(objectValue(item));
        visit(item);
      });
      return;
    }
    if (!source || typeof source !== 'object' || seen.has(source)) return;
    seen.add(source);
    const record = objectValue(source);
    const uiMetadata = objectValue(record.ui_metadata);
    const timeDimension = objectValue(uiMetadata.time_dimension);
    if (timeDimension.label_set) timeLabelSets.add(String(timeDimension.label_set));
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
      if (code) {
        const editableValue = item.runtime_editable ?? item.editable;
        setMetadata.set(code, {
          editable: editableValue == null ? setMetadata.get(code)?.editable : Boolean(editableValue),
          sourceSystem: String(item.source_system || setMetadata.get(code)?.sourceSystem || '') || undefined,
        });
      }
    }
    for (const [code, value] of Object.entries(objectValue(record.sets))) if (Array.isArray(value)) setValues[code] = value.map(String);
    [...records(record.parameters), ...records(record.runtime_parameters), ...records(record.parameter_bindings)].forEach(addField);
    ['input_schema', 'parameter_schema', 'semantic_schema', 'input_contract', 'semantic_spec', 'semantic', 'component_spec', 'model_draft'].forEach(key => visit(record[key]));
  };
  sources.forEach(visit);
  return [...rows.values()].filter(field => !authoritativeInputCodes.size || authoritativeInputCodes.has(field.code)).map(field => {
    const explicit = explicitGroups.get(field.code);
    const isDimensionSet = field.dimension.length === 1 && field.dimension[0] === field.code && Boolean(setValues[field.code]);
    const metadata = setMetadata.get(field.code);
    const role = field.role || (timeLabelSets.has(field.code) ? 'time_labels' : isDimensionSet ? 'set_members' : 'parameter');
    return {
      ...field,
      groupKey: explicit?.key || field.groupKey,
      groupLabel: explicit?.label || field.groupLabel,
      groupOrder: explicit?.order ?? field.groupOrder,
      dimensionValues: Object.fromEntries(field.dimension.filter(code => setValues[code]).map(code => [code, setValues[code]])),
      role,
      editable: field.editable ?? (role === 'set_members' ? metadata?.editable ?? false : role === 'time_labels' ? true : undefined),
      sourceSystem: field.sourceSystem || metadata?.sourceSystem,
    };
  });
}

function valuesAsLabels(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => item !== undefined && item !== null && String(item).trim() !== '').map(String) : [];
}

export function runtimeDimensionValues(field: RuntimeField, fields: RuntimeField[], parameters: Record<string, unknown>): Record<string, string[]> {
  return Object.fromEntries(field.dimension.map(dimension => {
    const setField = fields.find(item => item.code === dimension && (item.role === 'set_members' || item.dimension.length === 1 && item.dimension[0] === dimension));
    const runtime = valuesAsLabels(parameters[dimension]);
    const fallback = valuesAsLabels(setField?.defaultValue).length
      ? valuesAsLabels(setField?.defaultValue)
      : valuesAsLabels(setField?.exampleValue).length ? valuesAsLabels(setField?.exampleValue) : field.dimensionValues?.[dimension] || [];
    return [dimension, runtime.length ? runtime : fallback];
  }).filter(([, values]) => values.length));
}

export function runtimeTimeLabels(config: TimeDimensionConfig, fields: RuntimeField[], parameters: Record<string, unknown>, horizon?: number, resolvedIntervalMinutes?: number): string[] {
  if (!config.enabled || !horizon || horizon <= 0) return [];
  const labelField = config.label_set ? fields.find(field => field.code === config.label_set) : undefined;
  const explicit = config.label_set ? valuesAsLabels(parameters[config.label_set]) : [];
  const declared = explicit.length ? explicit : valuesAsLabels(labelField?.defaultValue).length ? valuesAsLabels(labelField?.defaultValue) : valuesAsLabels(labelField?.exampleValue);
  if (declared.length >= horizon) return declared.slice(0, horizon);
  const intervalMinutes = resolvedIntervalMinutes || config.interval_minutes;
  if (config.label_generation === 'auto' && config.label_format === 'HH:mm' && intervalMinutes) {
    return Array.from({ length: horizon }, (_, index) => {
      const minutes = index * intervalMinutes;
      return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    });
  }
  return [...declared, ...Array.from({ length: horizon - declared.length }, (_, index) => `T${declared.length + index + 1}`)];
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

function truncateAlongAxis(value: unknown, axis: number, length: number): unknown {
  if (axis === 0) {
    if (Array.isArray(value)) return value.slice(0, length);
    const entries = Object.entries(objectValue(value));
    return entries.length ? Object.fromEntries(entries.slice(0, length)) : value;
  }
  if (Array.isArray(value)) return value.map(item => truncateAlongAxis(item, axis - 1, length));
  const record = objectValue(value);
  return Object.keys(record).length
    ? Object.fromEntries(Object.entries(record).map(([key, item]) => [key, truncateAlongAxis(item, axis - 1, length)]))
    : value;
}

/**
 * Keeps the leading time points when an editable horizon is shortened.
 * Mapping-shaped matrices remain mappings, e.g. `{ U1: [0, 1] }`.
 */
export function truncateRuntimeParametersForHorizon(parameters: Record<string, unknown>, fields: RuntimeField[], config: TimeDimensionConfig, horizon: number) {
  const next = { ...parameters };
  for (const field of fields) {
    if (!(field.code in parameters)) continue;
    const stateAxis = config.state_time_set ? field.dimension.indexOf(config.state_time_set) : -1;
    const timeAxis = field.dimension.indexOf(config.time_set);
    const axis = stateAxis >= 0 ? stateAxis : timeAxis;
    if (axis < 0) continue;
    next[field.code] = truncateAlongAxis(parameters[field.code], axis, horizon + (stateAxis >= 0 ? 1 : 0));
  }
  return next;
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
