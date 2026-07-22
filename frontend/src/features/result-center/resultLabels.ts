import type { ModelAsset } from '../../types/model';

export type ResultLabelMap = Record<string, string>;

const BUILTIN_LABELS: ResultLabelMap = {
  objective_value: '目标函数值',
  total_cost: '总成本',
  gap: '最优间隙（Gap）',
  risk: '风险等级',
  total_generation_MWh: '总发电量',
  total_spill_flow_sum_m3s: '总弃水流量',
  total_spill_volume_m3: '总弃水体积',
  total_spill_volume_million_m3: '总弃水量',
  total_spill_million_m3: '总弃水量',
  total_abs_load_deviation_MW: '负荷跟踪偏差',
  terminal_volume_deviation_sum_million_m3: '期末库容偏差',
  max_water_balance_error_million_m3: '最大水量平衡误差',
  generation_value: '发电量价值',
  revenue_value: '收益价值',
  spill_penalty_value: '弃水惩罚',
  terminal_storage_penalty_value: '期末库容偏差惩罚',
  load_deviation_penalty_value: '负荷偏差惩罚',
  total_objective_value: '总目标值',
  unit_output: '机组出力',
  station_power: '电站出力',
  q_gen: '发电流量',
  q_spill: '弃水流量',
  q_out: '下泄流量',
  volume: '库容',
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>> : [];
}

function addDefinitions(target: ResultLabelMap, definitions: unknown) {
  rows(definitions).forEach(item => {
    const code = String(item.code || item.key || item.variable || item.id || '').trim();
    const label = String(item.display_name || item.label || item.business_name || item.name || '').trim();
    if (code && label && label !== code) target[code] = label;
  });
}

export function buildResultLabelMap(model?: ModelAsset): ResultLabelMap {
  const labels: ResultLabelMap = {};
  if (!model) return labels;
  const semantic = objectValue(model.semantic_spec);
  const generic = objectValue(model.generic_spec);
  const component = objectValue(model.component_spec);
  const draft = objectValue(model.model_draft);
  const draftSemantic = objectValue(draft.semantic);
  const contract = objectValue(model.output_contract);
  [semantic.variables, generic.variables, component.variables, draft.variables, draftSemantic.variables, contract.variables]
    .forEach(definitions => addDefinitions(labels, definitions));
  return labels;
}

export function resultLabel(code: unknown, labels?: ResultLabelMap) {
  const key = String(code || '').trim();
  return labels?.[key] || BUILTIN_LABELS[key] || key || '-';
}
