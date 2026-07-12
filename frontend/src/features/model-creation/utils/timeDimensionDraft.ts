import type { ModelDraft, TimeDimensionConfig, TimeDimensionPolicy } from '../stores/modelCreationStore';
import { extractDimensions } from './modelDimensions';

export const NOT_APPLICABLE_TIME_DIMENSION: TimeDimensionConfig = {
  schema_version: 1,
  enabled: false,
  policy: 'not_applicable',
  editable: false,
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function positiveNumberMap(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(objectValue(value)).flatMap(([key, item]) => {
    const number = Number(item);
    return Number.isFinite(number) && number > 0 ? [[key, number]] : [];
  }));
}

export function normalizeTimeDimensionConfig(value: unknown, availableSetCodes?: Iterable<string>): TimeDimensionConfig {
  const source = objectValue(value);
  const policyValue = String(source.policy || (source.enabled ? 'fixed' : 'not_applicable'));
  const policy: TimeDimensionPolicy = ['not_applicable', 'fixed', 'runtime_variable', 'data_derived'].includes(policyValue)
    ? policyValue as TimeDimensionPolicy
    : 'not_applicable';
  if (policy === 'not_applicable' || source.enabled === false) return { ...NOT_APPLICABLE_TIME_DIMENSION };
  const allowed = Array.isArray(source.allowed_horizons)
    ? [...new Set(source.allowed_horizons.map(positiveInteger).filter((item): item is number => item !== undefined))]
    : [];
  const intervalMap = positiveNumberMap(source.interval_minutes_by_horizon);
  const deltaMap = positiveNumberMap(source.delta_t_by_horizon);
  const availableSets = new Set(availableSetCodes || []);
  const stateTimeSet = Object.prototype.hasOwnProperty.call(source, 'state_time_set')
    ? source.state_time_set === null || source.state_time_set === '' ? null : String(source.state_time_set)
    : availableSets.has('time_volume') ? 'time_volume' : null;
  return {
    schema_version: 1,
    enabled: true,
    policy,
    default_horizon: positiveInteger(source.default_horizon),
    time_set: String(source.time_set || 'time'),
    state_time_set: stateTimeSet,
    editable: policy === 'runtime_variable',
    min_horizon: positiveInteger(source.min_horizon),
    max_horizon: positiveInteger(source.max_horizon),
    horizon_step: positiveInteger(source.horizon_step),
    ...(allowed.length ? { allowed_horizons: allowed } : {}),
    interval_minutes: source.interval_minutes === undefined ? undefined : Number(source.interval_minutes),
    delta_t: source.delta_t === undefined ? undefined : Number(source.delta_t),
    ...(Object.keys(intervalMap).length ? { interval_minutes_by_horizon: intervalMap } : {}),
    ...(Object.keys(deltaMap).length ? { delta_t_by_horizon: deltaMap } : {}),
    ...(Object.prototype.hasOwnProperty.call(source, 'derive_from') ? { derive_from: source.derive_from ? String(source.derive_from) : null } : {}),
    ...(source.label_generation === 'auto' ? {
      label_set: source.label_set === null || source.label_set === '' ? null : String(source.label_set || 'time_labels'),
      label_generation: 'auto' as const,
      label_format: source.label_format === 'sequence' ? 'sequence' as const : 'HH:mm' as const,
    } : {}),
  };
}

export function findTimeSetReferences(draft: ModelDraft, setCode: string): Array<{ type: 'parameter' | 'variable' | 'formula' | 'component'; code: string; path: string }> {
  const result: Array<{ type: 'parameter' | 'variable' | 'formula' | 'component'; code: string; path: string }> = [];
  draft.semantic.parameters.forEach((item, index) => {
    if (extractDimensions(item as unknown as Record<string, unknown>).includes(setCode)) result.push({ type: 'parameter', code: item.code, path: `semantic.parameters[${index}]` });
  });
  draft.semantic.variables.forEach((item, index) => {
    if (extractDimensions(item as unknown as Record<string, unknown>).includes(setCode)) result.push({ type: 'variable', code: item.code, path: `semantic.variables[${index}]` });
  });
  draft.formulas.forEach((item, index) => {
    if ((item.referenced_sets || []).includes(setCode) || (item.free_indices || []).includes(setCode) || structuredReferenceContains(item, setCode)) {
      result.push({ type: 'formula', code: item.formula_id || item.name || `formula_${index + 1}`, path: `formulas[${index}]` });
    }
  });
  draft.components.forEach((item, index) => {
    if (structuredReferenceContains(item, setCode)) result.push({ type: 'component', code: String(item.code || item.component_id || item.type || `component_${index + 1}`), path: `components[${index}]` });
  });
  return result;
}

function structuredReferenceContains(value: unknown, setCode: string, parentKey = ''): boolean {
  if (Array.isArray(value)) return value.some(item => structuredReferenceContains(item, setCode, parentKey));
  if (!value || typeof value !== 'object') return ['dimension', 'dimensions', 'indices', 'index_sets', 'foreach', 'for_each', 'sum_over', 'sets'].includes(parentKey) && value === setCode;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (key === 'set' && child === setCode) return true;
    return structuredReferenceContains(child, setCode, key);
  });
}

export function timeDimensionReferences(draft: ModelDraft, config = draft.time_dimension) {
  const names = [...new Set([config.time_set || 'time', config.state_time_set || ''].filter(Boolean))];
  const refs = names.flatMap(name => findTimeSetReferences(draft, name));
  const parameters = refs.filter(item => item.type === 'parameter');
  const variables = refs.filter(item => item.type === 'variable');
  const formulas = refs.filter(item => item.type === 'formula');
  const components = refs.filter(item => item.type === 'component');
  return { parameters, variables, formulas, components, count: refs.length };
}

export type TimeDimensionMode = 'not_applicable' | 'fixed' | 'free' | 'choice' | 'data_derived';

export function normalizeTimeDimensionForMode(config: TimeDimensionConfig, mode: TimeDimensionMode): TimeDimensionConfig {
  if (mode === 'not_applicable') return { ...NOT_APPLICABLE_TIME_DIMENSION };
  const next = { ...config, schema_version: 1 as const, enabled: true };
  const remove = (...keys: Array<keyof TimeDimensionConfig>) => keys.forEach(key => delete next[key]);
  if (mode === 'fixed') {
    const mappedInterval = next.default_horizon ? next.interval_minutes_by_horizon?.[String(next.default_horizon)] : undefined;
    const mappedDelta = next.default_horizon ? next.delta_t_by_horizon?.[String(next.default_horizon)] : undefined;
    next.policy = 'fixed';
    next.editable = false;
    if (mappedInterval) next.interval_minutes = mappedInterval;
    if (mappedDelta) next.delta_t = mappedDelta;
    remove('allowed_horizons', 'min_horizon', 'max_horizon', 'horizon_step', 'interval_minutes_by_horizon', 'delta_t_by_horizon', 'derive_from');
  } else if (mode === 'free') {
    const mappedInterval = next.default_horizon ? next.interval_minutes_by_horizon?.[String(next.default_horizon)] : undefined;
    const mappedDelta = next.default_horizon ? next.delta_t_by_horizon?.[String(next.default_horizon)] : undefined;
    next.policy = 'runtime_variable';
    next.editable = true;
    next.min_horizon ||= 1;
    next.max_horizon ||= 168;
    next.horizon_step ||= 1;
    if (mappedInterval) next.interval_minutes = mappedInterval;
    if (mappedDelta) next.delta_t = mappedDelta;
    remove('allowed_horizons', 'interval_minutes_by_horizon', 'delta_t_by_horizon', 'derive_from');
  } else if (mode === 'choice') {
    const wasChoice = config.policy === 'runtime_variable' && Boolean(config.allowed_horizons?.length);
    next.policy = 'runtime_variable';
    next.editable = true;
    next.allowed_horizons = next.allowed_horizons?.length ? next.allowed_horizons : [24, 48, 96];
    next.interval_minutes_by_horizon = Object.keys(next.interval_minutes_by_horizon || {}).length ? next.interval_minutes_by_horizon : { '24': 60, '48': 30, '96': 15 };
    next.delta_t_by_horizon = Object.keys(next.delta_t_by_horizon || {}).length ? next.delta_t_by_horizon : { '24': 1, '48': 0.5, '96': 0.25 };
    if (!wasChoice || !next.default_horizon || !next.allowed_horizons.includes(next.default_horizon)) next.default_horizon = next.allowed_horizons.at(-1);
    remove('min_horizon', 'max_horizon', 'horizon_step', 'derive_from', 'interval_minutes', 'delta_t');
  } else {
    const mappedInterval = next.default_horizon ? next.interval_minutes_by_horizon?.[String(next.default_horizon)] : undefined;
    const mappedDelta = next.default_horizon ? next.delta_t_by_horizon?.[String(next.default_horizon)] : undefined;
    next.policy = 'data_derived';
    next.editable = false;
    if (mappedInterval) next.interval_minutes = mappedInterval;
    if (mappedDelta) next.delta_t = mappedDelta;
    remove('allowed_horizons', 'min_horizon', 'max_horizon', 'horizon_step', 'interval_minutes_by_horizon', 'delta_t_by_horizon');
  }
  return normalizeTimeDimensionConfig(next);
}

function setValues(source: unknown) {
  return Array.isArray(source) ? source : source && typeof source === 'object' ? Object.values(source as Record<string, unknown>) : [];
}

function derivePreviewHorizon(draft: ModelDraft, config: TimeDimensionConfig) {
  if (!config.derive_from) return undefined;
  const definition = draft.semantic.parameters.find(item => item.code === config.derive_from);
  const dims = definition ? extractDimensions(definition as unknown as Record<string, unknown>) : [];
  const timeIndex = dims.indexOf(config.time_set || 'time');
  const value = draft.runtime_parameters[config.derive_from] ?? definition?.exampleValue ?? definition?.defaultValue ?? definition?.default;
  if (timeIndex <= 0) return setValues(value).length || undefined;
  const first = setValues(value)[0];
  return setValues(first).length || undefined;
}

function inferredHorizon(draft: Pick<ModelDraft, 'semantic' | 'runtime_parameters'>, timeSet = 'time') {
  const parameterHorizon = positiveInteger(draft.runtime_parameters.horizon);
  const set = draft.semantic.sets.find(item => item.code === timeSet);
  return parameterHorizon || positiveInteger(set?.horizon) || (set?.values?.length ? set.values.length : undefined);
}

export function inferTimeDimensionConfig(draft: Pick<ModelDraft, 'semantic' | 'runtime_parameters'>): TimeDimensionConfig {
  const timeSet = draft.semantic.sets.find(item => item.type === 'time_period' || item.dimensionType === 'time_period' || item.code === 'time');
  const stateSet = draft.semantic.sets.find(item => item.type === 'state_time' || item.dimensionType === 'state_time' || item.code === 'time_volume');
  const referenced = draft.semantic.parameters.some(item => extractDimensions(item as unknown as Record<string, unknown>).some(name => name === timeSet?.code || name === 'time' || name === 'time_volume'))
    || draft.semantic.variables.some(item => extractDimensions(item as unknown as Record<string, unknown>).some(name => name === timeSet?.code || name === 'time' || name === 'time_volume'));
  if (!timeSet && !stateSet && !referenced) return { ...NOT_APPLICABLE_TIME_DIMENSION };
  return normalizeTimeDimensionConfig({
    enabled: true,
    policy: 'fixed',
    default_horizon: inferredHorizon(draft, timeSet?.code || 'time'),
    time_set: timeSet?.code || 'time',
    state_time_set: stateSet?.code || null,
    editable: false,
  });
}

function intervalFor(config: TimeDimensionConfig, horizon: number) {
  return config.interval_minutes_by_horizon?.[String(horizon)] || config.interval_minutes;
}

function labelsFor(config: TimeDimensionConfig, horizon: number, minutes?: number) {
  if (config.label_format === 'sequence' || !minutes) return Array.from({ length: horizon }, (_, index) => `T${index + 1}`);
  return Array.from({ length: horizon }, (_, index) => `${String(Math.floor(index * minutes / 60) % 24).padStart(2, '0')}:${String(index * minutes % 60).padStart(2, '0')}`);
}

export function systemTimeFieldCodes(config: TimeDimensionConfig) {
  if (!config.enabled) return new Set<string>();
  const fields = new Set([
    'horizon',
    config.time_set || 'time',
    config.state_time_set || '',
    config.label_generation === 'auto' ? config.label_set || '' : '',
  ].filter(Boolean));
  const managesInterval = config.interval_minutes !== undefined
    || Boolean(Object.keys(config.interval_minutes_by_horizon || {}).length)
    || config.label_generation === 'auto';
  const managesDelta = config.delta_t !== undefined
    || Boolean(Object.keys(config.delta_t_by_horizon || {}).length)
    || config.interval_minutes !== undefined
    || Boolean(Object.keys(config.interval_minutes_by_horizon || {}).length);
  if (managesInterval) fields.add('interval_minutes');
  if (managesDelta) fields.add('delta_t');
  return fields;
}

export function applyTimeDimensionToDraft(draft: ModelDraft, rawConfig: TimeDimensionConfig): ModelDraft {
  const config = normalizeTimeDimensionConfig(rawConfig);
  const previousManagedCodes = new Set(draft.semantic.sets.filter(item => item.managed_by === 'time_dimension').map(item => item.code));
  if (!config.enabled) {
    const runtime = { ...draft.runtime_parameters };
    new Set(['horizon', ...previousManagedCodes, ...systemTimeFieldCodes(draft.time_dimension)]).forEach(key => delete runtime[key]);
    return {
      ...draft,
      time_dimension: config,
      semantic: { ...draft.semantic, sets: draft.semantic.sets.filter(item => item.managed_by !== 'time_dimension') },
      runtime_parameters: runtime,
    };
  }

  const timeSet = config.time_set || 'time';
  const stateSet = config.state_time_set || null;
  const previewHorizon = derivePreviewHorizon(draft, config);
  const horizon = config.policy === 'data_derived' ? previewHorizon || config.default_horizon : config.default_horizon;
  const managedNames = new Set([timeSet, stateSet || '']);
  let sets = draft.semantic.sets.filter(item => item.managed_by !== 'time_dimension' || managedNames.has(item.code));
  const upsertManaged = (code: string, state: boolean) => {
    const index = sets.findIndex(item => item.code === code);
    const existing = index >= 0 ? sets[index] : undefined;
    if (existing && existing.managed_by !== 'time_dimension') return;
    const length = horizon ? horizon + (state ? 1 : 0) : 0;
    const next = {
      ...(existing || {}),
      code,
      name: state ? '状态时点' : '时间点',
      type: state ? 'state_time' : 'time_period',
      dimensionType: state ? 'state_time' : 'time_period',
      sourceType: 'system' as const,
      source_type: 'system' as const,
      managed_by: 'time_dimension',
      ...(state ? { base_set: timeSet, generation_rule: 'horizon_plus_1' } : {}),
      horizon: horizon || undefined,
      defaultSize: length,
      values: Array.from({ length }, (_, itemIndex) => itemIndex),
    };
    if (index >= 0) sets = sets.map((item, itemIndex) => itemIndex === index ? next : item);
    else sets = [...sets, next];
  };
  upsertManaged(timeSet, false);
  if (stateSet) upsertManaged(stateSet, true);

  const runtime = { ...draft.runtime_parameters };
  for (const code of new Set([...systemTimeFieldCodes(config), ...systemTimeFieldCodes(draft.time_dimension), ...previousManagedCodes])) delete runtime[code];
  if (horizon) {
    runtime.horizon = horizon;
    runtime[timeSet] = Array.from({ length: horizon }, (_, index) => index);
    if (stateSet) runtime[stateSet] = Array.from({ length: horizon + 1 }, (_, index) => index);
    const interval = intervalFor(config, horizon);
    const delta = config.delta_t_by_horizon?.[String(horizon)] || config.delta_t || (interval ? interval / 60 : undefined);
    if (interval) runtime.interval_minutes = interval;
    if (delta) runtime.delta_t = delta;
    if (config.label_generation === 'auto' && config.label_set) runtime[config.label_set] = labelsFor(config, horizon, interval);
  }
  return { ...draft, time_dimension: config, semantic: { ...draft.semantic, sets }, runtime_parameters: runtime };
}

export function migrateModelDraft(rawDraft: unknown, fallback: ModelDraft): ModelDraft {
  const source = objectValue(rawDraft);
  const semantic = objectValue(source.semantic);
  const advanced = objectValue(source.advanced);
  const advancedUi = objectValue(advanced.ui_metadata);
  const explicit = source.time_dimension || objectValue(source.ui_metadata).time_dimension || advancedUi.time_dimension;
  const merged = {
    ...fallback,
    ...source,
    basic_info: { ...fallback.basic_info, ...objectValue(source.basic_info) },
    semantic: {
      ...fallback.semantic,
      ...semantic,
      sets: Array.isArray(semantic.sets) ? semantic.sets : fallback.semantic.sets,
      parameters: Array.isArray(semantic.parameters) ? semantic.parameters : fallback.semantic.parameters,
      variables: Array.isArray(semantic.variables) ? semantic.variables : fallback.semantic.variables,
    },
    runtime_parameters: objectValue(source.runtime_parameters),
    parameter_groups: { ...fallback.parameter_groups, ...objectValue(source.parameter_groups) },
    advanced: { ...fallback.advanced, ...advanced },
  } as ModelDraft;
  const config = explicit ? normalizeTimeDimensionConfig(explicit, merged.semantic.sets.map(item => item.code)) : inferTimeDimensionConfig(merged);
  return applyTimeDimensionToDraft({ ...merged, time_dimension: config }, config);
}

export function validateDraftTimeDimension(draft: ModelDraft): string[] {
  const config = draft.time_dimension;
  const errors: string[] = [];
  const references = timeDimensionReferences(draft, config);
  if (!config.enabled || config.policy === 'not_applicable') {
    if (references.count) errors.push(`非时序模型仍有 ${references.count} 个参数、变量或公式引用时间集合`);
    return errors;
  }
  const horizon = config.default_horizon;
  const timeSet = config.time_set || 'time';
  const timeRow = draft.semantic.sets.find(item => item.code === timeSet);
  if (!horizon && config.policy !== 'data_derived') errors.push('时间维度默认 horizon 必须大于 0');
  if (!timeRow) errors.push(`时间集合 ${timeSet} 不存在`);
  else if ((timeRow.type || timeRow.dimensionType) !== 'time_period') errors.push(`时间集合 ${timeSet} 类型必须为 time_period`);
  if (horizon && timeRow?.values?.length !== horizon) errors.push(`时间集合 ${timeSet} 长度必须等于默认 horizon=${horizon}`);
  if (config.state_time_set) {
    const stateRow = draft.semantic.sets.find(item => item.code === config.state_time_set);
    if (!stateRow) errors.push(`状态时点集合 ${config.state_time_set} 不存在`);
    else {
      if ((stateRow.type || stateRow.dimensionType) !== 'state_time') errors.push(`状态时点集合 ${config.state_time_set} 类型必须为 state_time`);
      if (stateRow.base_set !== timeSet) errors.push(`状态时点集合 ${config.state_time_set} 的 base_set 必须为 ${timeSet}`);
      if (horizon && stateRow.values?.length !== horizon + 1) errors.push(`状态时点集合 ${config.state_time_set} 长度必须为 ${horizon + 1}`);
    }
  }
  if (config.policy === 'runtime_variable' && !config.allowed_horizons?.length) {
    if (config.interval_minutes_by_horizon && Object.keys(config.interval_minutes_by_horizon).length) errors.push('自由 horizon 模式不应配置 interval_minutes_by_horizon');
    if (config.delta_t_by_horizon && Object.keys(config.delta_t_by_horizon).length) errors.push('自由 horizon 模式不应配置 delta_t_by_horizon');
    const minimum = config.min_horizon || 1;
    const maximum = config.max_horizon;
    if (minimum <= 0) errors.push('min_horizon 必须大于 0');
    if (maximum !== undefined && maximum < minimum) errors.push('max_horizon 必须不小于 min_horizon');
    if ((config.horizon_step || 1) <= 0) errors.push('horizon_step 必须大于 0');
    if (horizon && (horizon < minimum || maximum !== undefined && horizon > maximum)) errors.push('默认 horizon 必须位于 min/max 范围内');
  }
  if (config.policy === 'fixed') {
    if (config.allowed_horizons?.length) errors.push('固定时段模式不应配置 allowed_horizons');
    if (config.min_horizon || config.max_horizon || config.horizon_step) errors.push('固定时段模式不应配置 min/max/step');
    if (Object.keys(config.interval_minutes_by_horizon || {}).length || Object.keys(config.delta_t_by_horizon || {}).length) errors.push('固定时段模式不应配置候选粒度映射');
    if (config.derive_from) errors.push('固定时段模式不应配置 derive_from');
  }
  if (config.policy === 'runtime_variable' && config.allowed_horizons?.length && (config.min_horizon || config.max_horizon || config.horizon_step || config.derive_from)) errors.push('候选 horizon 模式不应配置 min/max/step/derive_from');
  if (config.policy === 'data_derived') {
    if (config.allowed_horizons?.length || config.min_horizon || config.max_horizon || config.horizon_step) errors.push('data_derived 不应配置候选值或 horizon 范围');
    if (Object.keys(config.interval_minutes_by_horizon || {}).length || Object.keys(config.delta_t_by_horizon || {}).length) errors.push('data_derived 不应配置候选粒度映射');
  }
  if (config.allowed_horizons?.length && (config.interval_minutes !== undefined || config.delta_t !== undefined)) errors.push('候选 horizon 模式不能同时配置标量时间粒度');
  if (!config.allowed_horizons?.length && config.interval_minutes !== undefined && config.delta_t !== undefined && Math.abs(config.delta_t - config.interval_minutes / 60) > 1e-8) errors.push('delta_t 必须等于 interval_minutes / 60');
  if (config.allowed_horizons?.length) errors.push(...candidateErrorsForValidation(config));
  if (config.policy === 'data_derived') {
    const source = draft.semantic.parameters.find(item => item.code === config.derive_from);
    const dimensions = source ? extractDimensions(source as unknown as Record<string, unknown>) : [];
    if (!source || !dimensions.includes(timeSet) || (source.sourceType || source.source_type || 'runtime') !== 'runtime') errors.push('data_derived 的推导来源必须是维度包含时间集合的运行时参数');
    if (!config.default_horizon && !derivePreviewHorizon(draft, config)) errors.push('data_derived 缺少可用于建模预览的样例序列或 default_horizon');
  }
  if (config.label_generation === 'auto' && !config.label_set) errors.push('自动生成时间标签时 label_set 必填');
  if (draft.basic_info.builder_mode === 'generic_linear' && ['runtime_variable', 'data_derived'].includes(config.policy)) errors.push('当前通用公式模型尚未满足动态时间集合编译条件，请改为固定时段');
  return errors;
}

function candidateErrorsForValidation(config: TimeDimensionConfig) {
  const errors: string[] = [];
  const allowed = config.allowed_horizons || [];
  if (new Set(allowed).size !== allowed.length || allowed.some(item => !Number.isInteger(item) || item <= 0)) errors.push('候选 horizon 必须为不重复的正整数');
  if (!config.default_horizon || !allowed.includes(config.default_horizon)) errors.push('默认 horizon 必须属于候选值');
  const expected = new Set(allowed.map(String));
  for (const [name, mapping] of [['interval_minutes_by_horizon', config.interval_minutes_by_horizon], ['delta_t_by_horizon', config.delta_t_by_horizon]] as const) {
    const keys = Object.keys(mapping || {});
    if (keys.length !== expected.size || keys.some(key => !expected.has(key))) errors.push(`${name} 必须完整覆盖候选 horizon`);
  }
  for (const horizon of allowed) {
    const interval = config.interval_minutes_by_horizon?.[String(horizon)];
    const delta = config.delta_t_by_horizon?.[String(horizon)];
    if (!interval || !delta || Math.abs(delta - interval / 60) > 1e-8) errors.push(`${horizon} 点的 delta_t 必须等于时间粒度 / 60`);
  }
  return errors;
}
