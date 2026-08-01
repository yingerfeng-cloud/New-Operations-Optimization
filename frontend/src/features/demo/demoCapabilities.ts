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
  description: string;
  source: 'model_definition';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function rows(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function firstText(...values: unknown[]) {
  const value = values.find(item => item !== undefined && item !== null && String(item).trim());
  return value === undefined ? '' : String(value);
}

function modelSources(model: Partial<ModelAsset> | Record<string, unknown>) {
  const semantic = objectValue(model.semantic_spec);
  const componentSpec = objectValue(model.component_spec || semantic.component_spec);
  const draft = objectValue(model.model_draft);
  const advanced = objectValue(draft.advanced);
  const ui = {
    ...objectValue(semantic.ui_metadata),
    ...objectValue(model.ui_metadata),
    ...objectValue(advanced.ui_metadata),
  };
  const documentation = objectValue(ui.model_documentation || ui.documentation);
  const parameters = {
    ...objectValue(semantic.sample_runtime_parameters),
    ...objectValue(model.parameters),
  };
  return { semantic, componentSpec, draft, advanced, ui, documentation, parameters };
}

function functionAssetSummary(model: Partial<ModelAsset> | Record<string, unknown>) {
  const { componentSpec, documentation, parameters } = modelSources(model);
  const explicit = firstText(documentation.function_assets, documentation.functionAssets);
  if (explicit) return explicit;

  const bindings = objectValue(parameters.function_asset_bindings);
  const assetIds = [...new Set(Object.values(bindings).map(String).filter(Boolean))];
  if (assetIds.length) return assetIds.join('、');

  const componentTypes = rows(componentSpec.components).map(item => String(item.type || item.component_id || ''));
  const has1d = componentTypes.some(type => ['function_mapping_component', 'piecewise_linear_curve'].includes(type));
  const has2d = componentTypes.some(type => type === 'function_mapping_2d_component');
  if (has1d && has2d) return '1D PWL + 2D PWL（来自组件装配）';
  if (has2d) return '2D PWL（来自组件装配）';
  if (has1d) return '1D PWL（来自组件装配）';
  return '未配置';
}

function nonlinearSummary(model: Partial<ModelAsset> | Record<string, unknown>, problemType: string) {
  const { componentSpec, documentation, ui } = modelSources(model);
  const explicit = firstText(documentation.nonlinear_handling, documentation.nonlinearHandling, ui.nonlinear_handling);
  if (explicit) return explicit;

  if (problemType.toUpperCase().includes('NLP')) return '原生非线性模型（来自模型问题类型诊断）';
  const componentTypes = rows(componentSpec.components).map(item => String(item.type || item.component_id || ''));
  const has1d = componentTypes.some(type => ['function_mapping_component', 'piecewise_linear_curve'].includes(type));
  const has2d = componentTypes.some(type => type === 'function_mapping_2d_component');
  if (has1d && has2d) return '由模型组件定义：1D PWL + 2D 三角剖分线性化';
  if (has2d) return '由模型组件定义：2D PWL 线性化';
  if (has1d) return '由模型组件定义：1D PWL 线性化';
  return '模型定义未声明非线性处理';
}

export function modelCodeOf(model?: Partial<ModelAsset> | Record<string, unknown>) {
  const semantic = objectValue(model?.semantic_spec);
  return String(model?.template_id || model?.model_code || semantic.model_code || semantic.code || model?.id || model?.code || '');
}

export function demoCapabilityFor(model?: Partial<ModelAsset> | Record<string, unknown>): DemoCapability | undefined {
  if (!model) return undefined;
  const { semantic, componentSpec, draft, advanced, ui, documentation } = modelSources(model);
  const basicInfo = objectValue(draft.basic_info);
  const code = modelCodeOf(model);
  const displayName = firstText(model.name, semantic.name, basicInfo.name, code);
  const problemType = firstText(
    model.model_problem_type,
    model.problem_type,
    semantic.model_problem_type,
    semantic.problem_type,
    documentation.problem_type,
    '-',
  );
  const solver = firstText(model.solver, semantic.solver, ui.solver, documentation.solver, '-');
  const buildMode = firstText(
    model.build_mode,
    semantic.build_mode,
    basicInfo.builder_mode,
    documentation.build_mode,
    '-',
  );
  const description = firstText(
    model.description,
    ui.description,
    advanced.description,
    semantic.description,
    model.scene,
  );
  const tags = stringArray(model.tags).length ? stringArray(model.tags) : stringArray(semantic.tags);
  const componentNames = rows(componentSpec.components)
    .map(item => firstText(item.name, item.display_name, item.component_id, item.type))
    .filter(Boolean);
  const keyCapabilities = stringArray(documentation.key_capabilities).length
    ? stringArray(documentation.key_capabilities)
    : [...new Set(componentNames)].slice(0, 8);
  const deprecated = Boolean(ui.deprecated || semantic.deprecated);
  const replacement = firstText(ui.replacement_model_code, semantic.replacement_model_code);
  const risk = firstText(
    documentation.risk,
    ui.capability_boundary,
    deprecated && replacement ? `该模型为兼容入口；新建模型建议使用 ${replacement}。` : '',
    deprecated ? '该模型为兼容入口，不建议用于新建模型。' : '',
    '能力边界未在模型定义中配置。',
  );
  const functionAssets = functionAssetSummary(model);
  const configuredNotes = rows(documentation.notes || documentation.demo_notes)
    .map(item => ({ label: firstText(item.label, item.name), value: firstText(item.value, item.description) }))
    .filter(item => item.label && item.value);
  const demoNotes = configuredNotes.length ? configuredNotes : [
    ...(description ? [{ label: '模型说明', value: description }] : []),
    { label: '模型编码', value: code || '-' },
    ...(functionAssets !== '未配置' ? [{ label: '函数资产', value: functionAssets }] : []),
    ...(deprecated && replacement ? [{ label: '版本迁移', value: `兼容入口；新建模型建议使用 ${replacement}` }] : []),
  ];

  return {
    code,
    displayName,
    problemType,
    solver,
    buildMode,
    functionAssets,
    nonlinearHandling: nonlinearSummary(model, problemType),
    onlineDebug: ['published', 'trial'].includes(String(model.status || semantic.status || '')),
    tags,
    useCase: firstText(documentation.use_case, model.scene, semantic.scenario, description, '-'),
    keyCapabilities,
    risk,
    demoNotes,
    description,
    source: 'model_definition',
  };
}

export function capabilityOrFallback(model: Partial<ModelAsset> | Record<string, unknown>, fallbackProblemType = '-') {
  const capability = demoCapabilityFor(model);
  return {
    problemType: capability?.problemType || String(model.model_problem_type || model.problem_type || fallbackProblemType),
    solver: capability?.solver || String(model.solver || '-'),
    buildMode: capability?.buildMode || String(model.build_mode || '-'),
    functionAssets: capability?.functionAssets || '未配置',
    nonlinearHandling: capability?.nonlinearHandling || '模型定义未声明非线性处理',
    onlineDebug: capability?.onlineDebug ?? ['published', 'trial'].includes(String(model.status || '')),
    tags: capability?.tags || [],
    useCase: capability?.useCase || String(model.scene || model.description || '-'),
  };
}

export function isNlpLike(value?: Record<string, unknown>) {
  const problem = String(value?.problem_type || value?.model_problem_type || value?.solver_type || '').toUpperCase();
  const solver = String(value?.solver || value?.solver_name || '').toLowerCase();
  return problem === 'NLP' || solver.includes('ipopt');
}
