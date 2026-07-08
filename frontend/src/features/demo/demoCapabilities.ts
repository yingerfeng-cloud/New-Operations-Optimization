import type { ModelAsset } from '../../types/model';

export interface DemoCapability {
  code: string;
  displayName: string;
  problemType: string;
  solver: string;
  buildMode: string;
  functionAssets: string;
  nonlinearHandling: string;
  onlineDebug: boolean;
  tags: string[];
  useCase: string;
  keyCapabilities: string[];
  risk: string;
  demoNotes: Array<{ label: string; value: string }>;
}

export const DEMO_TEMPLATE_CODES = ['cascade_hydro_dispatch', 'cascade_hydro_dispatch_v1', 'nonlinear_hydro_power_demo', 'contract_spot_exposure_v1', 'retail_da_spot_bidding_v1'];

const DEMO_CAPABILITIES: Record<string, DemoCapability> = {
  contract_spot_exposure_v1: {
    code: 'contract_spot_exposure_v1',
    displayName: '中长期合约分解与现货暴露控制模型',
    problemType: 'LP',
    solver: 'HiGHS',
    buildMode: '通用组件公式模板',
    functionAssets: '不依赖函数资产',
    nonlinearHandling: '线性模型，无非线性项',
    onlineDebug: true,
    tags: ['LP', 'HiGHS', 'market_trading', 'advisory_only'],
    useCase: '中长期合约分解与现货暴露控制',
    keyCapabilities: ['96 点 15 分钟交易优化', '合约电量分解', '现货暴露控制', '暴露比例校核', '成本与风险拆解'],
    risk: '结果依赖负荷预测、现货价格预测、合约电量和暴露比例边界，平台只生成策略建议，不执行申报或下单。',
    demoNotes: [
      { label: '业务目标', value: '在满足合约总量和现货暴露上限的前提下，生成合约使用曲线和现货暴露建议。' },
      { label: '时间粒度', value: '支持日前 24 小时 96 点、15 分钟粒度交易优化。' },
      { label: '模型类型', value: 'LP / HiGHS。' },
      { label: '关键输入', value: '负荷预测、合约总电量、合约价格、现货价格预测、最大暴露比例和偏差惩罚。' },
      { label: '输出指标', value: 'contract_use_curve、spot_exposure_curve、暴露比例、成本拆解和高风险时段。' },
      { label: '执行边界', value: '仅提供可解释、可审批、可复盘的交易策略建议。' },
    ],
  },
  retail_da_spot_bidding_v1: {
    code: 'retail_da_spot_bidding_v1',
    displayName: '售电公司日前现货申报优化模型',
    problemType: 'MILP',
    solver: 'HiGHS',
    buildMode: '通用组件公式模板',
    functionAssets: '不依赖函数资产',
    nonlinearHandling: '线性约束 + 二进制充放电互斥，无非线性项',
    onlineDebug: true,
    tags: ['MILP', 'HiGHS', 'spot_bidding', 'storage', 'flex_load'],
    useCase: '售电公司日前现货申报策略建议',
    keyCapabilities: ['96 点 15 分钟交易优化', '日前现货申报建议', '储能协同', '可调负荷调整', '偏差风险成本拆解'],
    risk: '结果依赖日前价格预测、合约分时电量、储能边界和可调负荷边界，需人工审批后在外部交易系统处理。',
    demoNotes: [
      { label: '业务目标', value: '协同合约电量、现货购电、储能和可调负荷，生成日前申报策略建议。' },
      { label: '时间粒度', value: '支持日前 24 小时 96 点、15 分钟粒度交易优化。' },
      { label: '模型类型', value: 'MILP / HiGHS，使用二进制变量表达储能充放电互斥。' },
      { label: '关键约束', value: '电量平衡、申报上下限、SOC 递推、充放电互斥、可调负荷边界和负荷转移守恒。' },
      { label: '输出指标', value: 'spot_buy_curve、adjusted_load_curve、soc_curve、偏差曲线、成本拆解和风险摘要。' },
      { label: '执行边界', value: '平台不连接交易平台、不自动申报、不自动下单。' },
    ],
  },
  cascade_hydro_dispatch: {
    code: 'cascade_hydro_dispatch',
    displayName: '梯级水电日前调度优化模型',
    problemType: 'MILP',
    solver: 'HiGHS',
    buildMode: '组件化 Builder',
    functionAssets: '基础水电运行参数',
    nonlinearHandling: '线性/混合整数线性建模',
    onlineDebug: true,
    tags: ['MILP', 'HiGHS', 'demo_ready'],
    useCase: '梯级水电日前调度',
    keyCapabilities: ['水量平衡', '检修可用容量', '负荷跟踪', '弃水分析'],
    risk: '结果依赖来水、库容边界和负荷预测质量。',
    demoNotes: [
      { label: '业务目标', value: '在满足水量平衡和电站边界的前提下优化梯级水电出力。' },
      { label: '核心约束', value: '水量平衡、库容上下限、出库流量边界、检修可用容量和负荷跟踪。' },
      { label: '求解技术', value: 'MILP / HiGHS。' },
      { label: '输出指标', value: '总发电量、弃水、期末库容偏差、负荷跟踪偏差。' },
    ],
  },
  cascade_hydro_dispatch_v1: {
    code: 'cascade_hydro_dispatch_v1',
    displayName: '梯级水电调度 PWL 标杆模型',
    problemType: 'MILP',
    solver: 'HiGHS',
    buildMode: '1D+2D PWL 组件化 Builder',
    functionAssets: '1D PWL + 2D PWL',
    nonlinearHandling: 'piecewise_1d / piecewise_2d + triangulated_milp_exact',
    onlineDebug: true,
    tags: ['MILP', '1D PWL', '2D PWL', 'HiGHS', 'demo_ready'],
    useCase: '日前/日内水电优化调度',
    keyCapabilities: ['水位库容曲线', '尾水位流量曲线', '二维出力曲面', '三角剖分 MILP'],
    risk: '二维曲面三角剖分会引入二进制变量，模型规模随电站和时段增长。',
    demoNotes: [
      { label: '业务目标', value: '基于水位库容、尾水位流量和出力曲面完成水电日前调度。' },
      { label: '函数资产', value: 'cascade_hydro_level_storage_v1、cascade_hydro_tailwater_outflow_v1、cascade_hydro_power_surface_v1。' },
      { label: '非线性处理方式', value: '使用 1D/2D PWL 将物理曲线转化为 MILP。' },
      { label: '输入参数说明', value: 'horizon、time、time_volume、station/reservoir、local_inflow、load_forecast 和水库/出力边界。' },
      { label: '输出指标说明', value: '库容、出库流量、出力、弃水、水量平衡校验和函数资产插值解释。' },
    ],
  },
  nonlinear_hydro_power_demo: {
    code: 'nonlinear_hydro_power_demo',
    displayName: '非线性水电出力 NLP 演示模型',
    problemType: 'NLP',
    solver: 'Ipopt',
    buildMode: '原生非线性 Builder',
    functionAssets: '不依赖 PWL 函数资产',
    nonlinearHandling: '原生非线性：power = k * flow * head',
    onlineDebug: true,
    tags: ['NLP', 'Ipopt', 'nlp_demo'],
    useCase: '非线性水电出力原生求解',
    keyCapabilities: ['连续变量 NLP', 'Ipopt 真实求解', 'power = k * flow * head'],
    risk: 'Ipopt 通常返回局部最优或求解器终止状态，不承诺全局最优；不支持整数变量。',
    demoNotes: [
      { label: '非线性关系', value: 'power = k * flow * head。' },
      { label: '问题类型', value: 'NLP，变量为连续变量。' },
      { label: '求解器', value: 'Ipopt。' },
      { label: '初值要求', value: '建议提供合理初值，并确保变量上下界完整。' },
      { label: '局部最优风险', value: 'NLP 结果不承诺全局最优，受初值、上下界和模型尺度影响。' },
      { label: '整数变量说明', value: '含整数变量的非线性模型属于 MINLP_RESERVED，当前不作为生产级能力开放。' },
    ],
  },
};

export function modelCodeOf(model?: Partial<ModelAsset> | Record<string, unknown>) {
  return String(model?.template_id || model?.model_code || model?.id || model?.code || '');
}

export function demoCapabilityFor(model?: Partial<ModelAsset> | Record<string, unknown>) {
  const code = modelCodeOf(model);
  return DEMO_CAPABILITIES[code];
}

export function capabilityOrFallback(model: Partial<ModelAsset> | Record<string, unknown>, fallbackProblemType = '-') {
  const capability = demoCapabilityFor(model);
  return {
    problemType: capability?.problemType || String(model.model_problem_type || model.problem_type || fallbackProblemType),
    solver: capability?.solver || String(model.solver || '-'),
    buildMode: capability?.buildMode || String(model.build_mode || '-'),
    functionAssets: capability?.functionAssets || '-',
    nonlinearHandling: capability?.nonlinearHandling || '-',
    onlineDebug: capability?.onlineDebug ?? ['published', 'trial', 'tested', '已发布', '试运行', '已测试'].includes(String(model.status || '')),
    tags: capability?.tags || [],
    useCase: capability?.useCase || String(model.scene || model.description || '-'),
  };
}

export function isNlpLike(value?: Record<string, unknown>) {
  const problem = String(value?.problem_type || value?.model_problem_type || value?.solver_type || '').toUpperCase();
  const solver = String(value?.solver || value?.solver_name || '').toLowerCase();
  return problem === 'NLP' || solver.includes('ipopt');
}
