import type { ModelAsset } from '../../types/model';
import type { SolveResult } from '../../types/result';

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

function collectDefinitions(target: ResultLabelMap, source: unknown, visited = new WeakSet<object>()) {
  if (!source || typeof source !== 'object') return;
  if (visited.has(source)) return;
  visited.add(source);
  if (Array.isArray(source)) {
    source.forEach(item => collectDefinitions(target, item, visited));
    return;
  }

  const item = source as Record<string, unknown>;
  const code = String(item.code || item.key || item.variable || item.metric || item.id || '').trim();
  const label = String(item.display_name || item.label || item.business_name || item.name || item.title || '').trim();
  if (code && label && label !== code && /[\u3400-\u9fff]/u.test(label)) target[code] = label;
  Object.values(item).forEach(value => collectDefinitions(target, value, visited));
}

export function buildResultLabelMap(model?: ModelAsset, result?: SolveResult): ResultLabelMap {
  const labels: ResultLabelMap = {};
  collectDefinitions(labels, model);
  collectDefinitions(labels, objectValue(result?.result_metadata));
  collectDefinitions(labels, result?.metric_definitions);
  collectDefinitions(labels, result?.output_schema);
  return labels;
}

export function resultLabel(code: unknown, labels?: ResultLabelMap) {
  const key = String(code || '').trim();
  return labels?.[key] || BUILTIN_LABELS[key] || key || '-';
}
