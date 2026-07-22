import type { ScenarioCatalogItem, ScenarioModelItem } from '../../../types/scenario';
import type { DictionaryItem } from '../../../types/systemConfig';

export const BLANK_MODEL_ID = '__blank_model__';
export const DEFAULT_SCENARIO_ID = 'day_ahead_unit_commitment';
export const DEFAULT_MODEL_ID = 'day_ahead_unit_commitment_milp';

export const scenarioCatalog: ScenarioCatalogItem[] = [
  {
    id: DEFAULT_SCENARIO_ID,
    name: '日前机组组合优化',
    description: '面向日前计划的机组启停、出力和备用协同优化。',
    status: 'published',
    models: [
      {
        id: DEFAULT_MODEL_ID,
        name: '日前机组组合优化模型',
        code: 'unit_commitment_day_ahead',
        builderMode: 'generic_linear',
        problemType: 'MILP',
        paradigmSummary: 'MILP / 机组组合',
        objectiveSummary: '最小化燃料成本、启停成本和备用偏差成本。',
        setSummary: '机组 unit、调度时段 time、状态时点 time_volume。',
        description: '包含机组启停状态、爬坡、出力上下限、负荷平衡和备用约束。',
        templateCode: 'unit_commitment_day_ahead',
      },
    ],
  },
  {
    id: 'economic_dispatch',
    name: '经济负荷分配',
    description: '在满足负荷平衡的前提下进行机组经济出力分配。',
    status: 'published',
    models: [
      {
        id: 'economic_dispatch_lp',
        name: '经济负荷分配模型',
        code: 'economic_dispatch',
        builderMode: 'generic_linear',
        problemType: 'LP',
        paradigmSummary: 'LP / 经济调度',
        objectiveSummary: '最小化分段线性发电成本或综合运行成本。',
        setSummary: '机组 unit、调度时段 time。',
        description: '覆盖负荷平衡、机组出力上下限和成本目标。',
        templateCode: 'economic_dispatch',
      },
    ],
  },
  {
    id: 'storage_charge_discharge',
    name: '储能充放电优化',
    description: '协调储能充放电功率、SOC 和收益成本。',
    status: 'published',
    models: [
      {
        id: 'storage_dispatch_lp',
        name: '储能充放电优化模型',
        code: 'storage_dispatch',
        builderMode: 'generic_linear',
        problemType: 'LP',
        paradigmSummary: 'LP / 储能时序优化',
        objectiveSummary: '最大化峰谷套利收益或最小化购电成本。',
        setSummary: '储能设备 storage、调度时段 time、状态时点 time_volume。',
        description: '包含充放电功率、SOC 递推、容量边界和效率损耗。',
        templateCode: 'storage_dispatch',
      },
    ],
  },
  {
    id: 'renewable_storage_coordination',
    name: '风光储协同优化',
    description: '联合新能源出力、弃电和储能响应。',
    status: 'published',
    models: [
      {
        id: 'renewable_storage_component',
        name: '风光储协同优化模型',
        code: 'renewable_storage_dispatch',
        builderMode: 'component_based',
        problemType: 'LP',
        paradigmSummary: '组件化 / 新能源储能协同',
        objectiveSummary: '最小化弃风弃光、偏差惩罚和储能运行成本。',
        setSummary: '新能源 plant、储能 storage、调度时段 time、状态时点 time_volume。',
        description: '通过新能源、储能和负荷平衡组件组合生成模型。',
        templateCode: 'renewable_storage_dispatch',
      },
    ],
  },
  {
    id: 'cascade_hydro_day_ahead',
    name: '梯级水电日前调度',
    description: '面向梯级水库的水量平衡、出力和库容协同优化。',
    status: 'published',
    models: [
      {
        id: 'cascade_hydro_dispatch_lp',
        name: '梯级水电日前调度模型',
        code: 'cascade_hydro_dispatch',
        builderMode: 'component_based',
        problemType: 'LP',
        paradigmSummary: '组件化 / 梯级水电调度',
        objectiveSummary: '最大化发电收益并控制弃水、库容偏差和生态流量偏差。',
        setSummary: '水电站 hydro_station、河段 link、调度时段 time、状态时点 time_volume。',
        description: '包含水量递推、上下游耦合、库容边界和发电流量约束。',
        templateCode: 'cascade_hydro_dispatch',
      },
    ],
  },
  {
    id: 'chp_coordination',
    name: '热电协同优化',
    description: '协调热电联产机组的电功率、热功率和燃料消耗。',
    status: 'published',
    models: [
      {
        id: 'chp_dispatch_component',
        name: '热电协同优化模型',
        code: 'chp_dispatch',
        builderMode: 'component_based',
        problemType: 'MILP',
        paradigmSummary: '组件化 / 热电联产',
        objectiveSummary: '最小化燃料成本、启停成本和热电偏差惩罚。',
        setSummary: '热电机组 chp_unit、热负荷 heat_load、电负荷 power_load、调度时段 time。',
        description: '通过热电耦合组件表达热电比、供热平衡和电力平衡。',
        templateCode: 'chp_dispatch',
      },
    ],
  },
  {
    id: 'power_market_trading',
    name: '电力市场交易',
    description: '面向市场报价、成交电量和偏差结算的交易优化。',
    status: 'trial',
    models: [
      {
        id: 'market_trading_lp',
        name: '电力市场交易优化模型',
        code: 'power_market_trading',
        builderMode: 'generic_linear',
        problemType: 'LP',
        paradigmSummary: 'LP / 市场交易组合',
        objectiveSummary: '最大化交易收益并控制偏差结算风险。',
        setSummary: '交易品种 product、市场时段 time、报价段 bid_segment。',
        description: '覆盖报价量、成交量、价格边界和偏差成本。',
      },
    ],
  },
  {
    id: 'carbon_emission_optimization',
    name: '碳排放优化',
    description: '面向碳配额、碳成本和低碳调度的优化模型。',
    status: 'trial',
    models: [
      {
        id: 'carbon_dispatch_lp',
        name: '碳排放优化模型',
        code: 'carbon_emission_optimization',
        builderMode: 'generic_linear',
        problemType: 'LP',
        paradigmSummary: 'LP / 碳成本调度',
        objectiveSummary: '最小化发电成本、碳排放成本和超配额惩罚。',
        setSummary: '排放主体 emitter、调度时段 time、碳配额 quota。',
        description: '覆盖排放因子、碳配额、碳交易成本和常规调度约束。',
      },
    ],
  },
];

export function getScenarioById(id: string) {
  return scenarioCatalog.find(item => item.id === id);
}

export function modelBelongsToScenario(model: Record<string, unknown>, scenario: ScenarioCatalogItem, catalogModel?: ScenarioModelItem) {
  const values = [
    model.scene,
    model.scenario,
    model.template_id,
    model.model_code,
    model.resolved_model_code,
    model.code,
  ].map(value => String(value || ''));
  const modelCodes = scenario.models.map(item => item.code);
  const templateCodes = scenario.models.map(item => item.templateCode).filter((value): value is string => Boolean(value));
  const matchesCode = (value: string, code: string) => value === code || value.startsWith(`${code}_`);
  if (values.includes(scenario.id) || values.includes(scenario.name)) return true;
  if (catalogModel && values.some(value => [catalogModel.id, catalogModel.code, catalogModel.templateCode || ''].some(code => code && matchesCode(value, code)))) return true;
  return values.some(value => [...modelCodes, ...templateCodes].some(code => matchesCode(value, code)));
}

export function scenariosFromDictionary(items?: DictionaryItem[]) {
  if (items === undefined) return scenarioCatalog;
  return items
    .filter(item => item.enabled !== false)
    .map(item => {
      const catalogItem = scenarioCatalog.find(scenario => scenario.id === item.code);
      return {
        ...(catalogItem || { id: item.code, name: item.label, description: '', status: 'published' as const, models: [] }),
        name: item.label || catalogItem?.name || item.code,
        sortOrder: item.sort_order ?? 9999,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ sortOrder: _sortOrder, ...item }) => item);
}

export function scenarioNameFromDictionary(id: string, items?: DictionaryItem[]) {
  return items?.find(item => item.code === id && item.enabled !== false)?.label || getScenarioById(id)?.name || '';
}

export function getScenarioModelById(scenarioId: string, modelId: string): ScenarioModelItem | undefined {
  return getScenarioById(scenarioId)?.models.find(model => model.id === modelId);
}

export function getDefaultScenario() {
  return getScenarioById(DEFAULT_SCENARIO_ID) || scenarioCatalog[0];
}

export function getDefaultScenarioModel() {
  const scenario = getDefaultScenario();
  return scenario.models.find(model => model.id === DEFAULT_MODEL_ID) || scenario.models[0];
}
