import type { ModelAsset } from '../../../types/model';
import type { FormulaDef } from '../../../types/formula';
import { createInitialDraft, type ModelDraft } from '../stores/modelCreationStore';
import { normalizeModelDraft } from './normalizeModelDraft';
import { inferTimeDimensionConfig, normalizeTimeDimensionConfig } from './timeDimensionDraft';
import { extractDimensions } from './modelDimensions';
import { reconcileComponentParameterBindings } from './componentParameterBindings';

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

function hasKeys(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}

const SINGLETON_OBJECTIVE_WEIGHT_KEYS = new Set([
  'load_deviation',
  'spill',
  'ramp',
  'terminal_volume',
  'investment',
  'curtailment',
  'deviation',
  'deviation_penalty_cost',
  'storage_cycle',
  'battery_degradation',
  'energy_revenue',
  'terminal_soc',
  'generation',
  'revenue',
]);

function objectiveTermIdentities(term: Record<string, unknown>) {
  const identities: string[] = [];
  const weightKey = String(term.weight_key || '').trim();
  if (SINGLETON_OBJECTIVE_WEIGHT_KEYS.has(weightKey)) identities.push(`weight_key:${weightKey}`);
  const termId = String(term.term_id || '').trim();
  if (termId) identities.push(`term_id:${termId}`);
  return identities;
}

function mergeObjectiveTerms(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const existingIsComponentTerm = Boolean(existing.source_component);
  const incomingIsComponentTerm = Boolean(incoming.source_component);
  const canonical = existingIsComponentTerm ? existing : incomingIsComponentTerm ? incoming : existing;
  const override = existingIsComponentTerm && !incomingIsComponentTerm
    ? incoming
    : !existingIsComponentTerm && incomingIsComponentTerm
      ? existing
      : incoming;
  return {
    ...canonical,
    ...override,
    term_id: canonical.term_id || override.term_id,
    source_component: canonical.source_component || override.source_component,
  };
}

function normalizeObjectiveTerms(value: unknown) {
  const terms: Array<Record<string, unknown>> = [];
  const indexes = new Map<string, number>();
  arrayValue(value).forEach(term => {
    const identities = objectiveTermIdentities(term);
    const existingIndex = identities.map(identity => indexes.get(identity)).find(index => index !== undefined);
    if (existingIndex !== undefined) {
      terms[existingIndex] = mergeObjectiveTerms(terms[existingIndex], term);
      objectiveTermIdentities(terms[existingIndex]).forEach(identity => indexes.set(identity, existingIndex));
      identities.forEach(identity => indexes.set(identity, existingIndex));
      return;
    }
    terms.push({ ...term });
    identities.forEach(identity => indexes.set(identity, terms.length - 1));
  });
  return terms;
}

function normalizeObjectiveSpec(value: unknown): Record<string, unknown> {
  const objective = objectValue(value);
  return { ...objective, terms: normalizeObjectiveTerms(objective.terms) };
}

function normalizeSavedFormulas(formulas: ModelDraft['formulas']) {
  const previewObjectives = new Set<string>();
  return formulas.filter(formula => {
    if (formula.kind !== 'objective' || formula.solve_participation !== 'preview_only') return true;
    const identity = `${formula.name.trim()}\u0000${formula.dsl_formula.trim()}`;
    if (previewObjectives.has(identity)) return false;
    previewObjectives.add(identity);
    return true;
  });
}

const GENERATED_CONSTRAINT_NAMES_BY_COMPONENT: Record<string, string[]> = {
  hydro_volume_bounds: ['库容下限约束', '库容上限约束'],
  hydro_generation_flow_bounds: ['发电流量下限约束', '发电流量上限约束'],
  hydro_outflow_bounds: ['下泄流量下限约束', '下泄流量上限约束'],
  hydro_spill_bounds: ['弃水非负约束', '弃水上限约束'],
  hydro_ramp_smoothing: ['出力上爬坡约束', '出力下爬坡约束'],
};

function normalizeGeneratedConstraintNames(value: unknown) {
  const constraints = arrayValue(value);
  const nameCounts = new Map<string, number>();
  constraints.forEach(constraint => {
    const name = formulaName(constraint, '');
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  });
  const componentIndexes = new Map<string, number>();
  return constraints.map(constraint => {
    const name = formulaName(constraint, '');
    if ((nameCounts.get(name) || 0) < 2) return constraint;
    const sourceComponent = String(constraint.source_component || '');
    const generatedNames = GENERATED_CONSTRAINT_NAMES_BY_COMPONENT[sourceComponent];
    if (!generatedNames) return constraint;
    const componentIndex = componentIndexes.get(sourceComponent) || 0;
    componentIndexes.set(sourceComponent, componentIndex + 1);
    return { ...constraint, name: generatedNames[componentIndex] || name };
  });
}

function asBuildMode(value: unknown): ModelDraft['basic_info']['builder_mode'] {
  return value === 'component_based' || value === 'template_based' || value === 'domain_builder' ? value : 'generic_linear';
}

function sourceType(value: unknown): 'runtime' | 'static' | 'ledger' | 'system' {
  return value === 'static' || value === 'ledger' || value === 'system' ? value : 'runtime';
}

function variableType(value: unknown): 'continuous' | 'binary' | 'integer' {
  const text = String(value || '').toLowerCase();
  if (text.includes('binary')) return 'binary';
  if (text.includes('integer')) return 'integer';
  return 'continuous';
}

function boundValue(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function normalizeSets(rows: unknown): ModelDraft['semantic']['sets'] {
  return arrayValue(rows).map(row => {
    const code = String(row.code || row.key || row.name || '');
    return {
      ...row,
      code,
      name: String(row.name || row.label || code),
      dimensionType: String(row.dimensionType || row.dimension || row.type || 'business'),
      sourceType: sourceType(row.sourceType || row.source_type || row.source_system),
      source_type: sourceType(row.sourceType || row.source_type || row.source_system),
      defaultSize: Number(row.defaultSize ?? (Array.isArray(row.values) ? row.values.length : 0)),
      values: Array.isArray(row.values) ? row.values : [],
    };
  }).filter(row => row.code);
}

function normalizeParameters(rows: unknown): ModelDraft['semantic']['parameters'] {
  return arrayValue(rows).map(row => {
    const code = String(row.code || row.key || row.name || '');
    const dimension = extractDimensions(row);
    return {
      ...row,
      code,
      name: String(row.name || row.label || code),
      unit: String(row.unit || ''),
      indices: dimension,
      dimension,
      sourceType: sourceType(row.sourceType || row.source_type || row.source_system),
      source_type: sourceType(row.sourceType || row.source_type || row.source_system),
      required: row.required !== false,
      defaultValue: row.defaultValue ?? row.default ?? row.default_value,
      default: row.default ?? row.defaultValue ?? row.default_value,
      exampleValue: row.exampleValue ?? row.sample_value,
      description: String(row.description || ''),
    };
  }).filter(row => row.code);
}

function normalizeVariables(rows: unknown): ModelDraft['semantic']['variables'] {
  return arrayValue(rows).map(row => {
    const code = String(row.code || row.key || row.name || '');
    const dimension = extractDimensions(row);
    const type = variableType(row.variableType || row.type || row.domain);
    return {
      ...row,
      code,
      name: String(row.name || row.label || code),
      variableType: type,
      indices: dimension,
      dimension,
      lowerBound: boundValue(row.lowerBound ?? row.lower_bound ?? row.lb),
      upperBound: boundValue(row.upperBound ?? row.upper_bound ?? row.ub),
      unit: String(row.unit || ''),
      description: String(row.description || ''),
      domain: String(row.domain || (type === 'binary' ? 'Binary' : type === 'integer' ? 'Integers' : 'NonNegativeReals')),
    };
  }).filter(row => row.code);
}

function componentsFrom(value: unknown): Array<Record<string, unknown>> {
  return arrayValue(value).map(component => ({ enabled: true, ...component }));
}

function formulaText(row: Record<string, unknown>, fallback = '') {
  return String(row.display_formula || row.readable_formula || row.dsl_formula || row.formula || row.expression || row.math_expression || row.name || fallback);
}

function formulaName(row: Record<string, unknown>, fallback: string) {
  return String(row.name || row.title || row.constraint_id || row.term_id || row.code || fallback);
}

function genericObjectiveFormula(term: Record<string, unknown>) {
  const explicit = formulaText(term, '');
  if (explicit) return explicit;
  const variable = String(term.var || term.variable || term.name || '');
  const key = Array.isArray(term.key) ? term.key as string[] : Array.isArray(term.indices) ? term.indices as string[] : [];
  const coefficient = String(term.coef_param || term.coefficient_parameter || term.weight_key || '').trim();
  const variableExpr = variable ? `${variable}${key.length ? `[${key.join(',')}]` : ''}` : '0';
  return coefficient ? `${coefficient} * ${variableExpr}` : variableExpr;
}

function formulaMetadata(source: Record<string, unknown>): Partial<FormulaDef> {
  const metadata: Partial<FormulaDef> = {};
  const boundary = String(source.boundary_strategy || '').trim();
  if (['strict', 'skip_first', 'skip_last', 'skip_out_of_range', 'explicit_subset'].includes(boundary)) {
    metadata.boundary_strategy = boundary as NonNullable<FormulaDef['boundary_strategy']>;
  }
  if (Array.isArray(source.scope)) {
    const scope = source.scope
      .filter(item => item && typeof item === 'object')
      .map(item => {
        const value = item as Record<string, unknown>;
        return { alias: String(value.alias || ''), set: String(value.set || value.code || '') };
      })
      .filter(item => item.alias && item.set);
    if (scope.length) metadata.scope = scope;
  }
  if (Array.isArray(source.foreach) && source.foreach.every(item => typeof item === 'string')) {
    metadata.foreach = source.foreach as string[];
  }
  return metadata;
}

function formulaDef(
  kind: FormulaDef['kind'],
  name: string,
  expression: string,
  id: string,
  solveParticipation: FormulaDef['solve_participation'] = 'solve_active',
  metadata: Partial<FormulaDef> = {},
): FormulaDef {
  return {
    formula_id: id,
    name,
    kind,
    display_formula: expression,
    dsl_formula: expression,
    tokens: [],
    foreach: [],
    referenced_sets: [],
    referenced_parameters: [],
    referenced_variables: [],
    free_indices: [],
    ...metadata,
    solve_participation: solveParticipation,
    compile_status: expression ? 'ready' : 'error',
  };
}

function formulasFromGenericSpec(genericSpec: Record<string, unknown>): FormulaDef[] {
  const objective = objectValue(genericSpec.objective);
  const objectiveTerms = arrayValue(objective.terms);
  const constraints = arrayValue(genericSpec.constraints);
  return [
    ...objectiveTerms.map((term, index) => formulaDef(
      'objective',
      formulaName(term, `目标项 ${index + 1}`),
      genericObjectiveFormula(term),
      `asset-objective-${index}`,
      'solve_active',
      formulaMetadata(term),
    )),
    ...constraints.map((constraint, index) => formulaDef(
      'constraint',
      formulaName(constraint, `约束 ${index + 1}`),
      formulaText(constraint),
      `asset-constraint-${index}`,
      'solve_active',
      formulaMetadata(constraint),
    )),
  ];
}

function formulasFromTemplateDraft(savedDraft: Record<string, unknown>, mathematicalExpansion: Record<string, unknown>): FormulaDef[] {
  const objective = normalizeObjectiveSpec(savedDraft.objective || mathematicalExpansion.objective);
  const objectiveTerms = arrayValue(objective.terms);
  const constraintSource = arrayValue(savedDraft.constraints).length
    ? arrayValue(savedDraft.constraints)
    : arrayValue(mathematicalExpansion.sections).filter(section => String(section.type || 'constraint') === 'constraint');
  const constraints = normalizeGeneratedConstraintNames(constraintSource);
  return [
    ...objectiveTerms.map((term, index) => formulaDef(
      'objective',
      formulaName(term, `目标项 ${index + 1}`),
      formulaText(term),
      `asset-template-objective-${String(term.term_id || index)}`,
      'preview_only',
      formulaMetadata(term),
    )),
    ...constraints.map((constraint, index) => formulaDef(
      'constraint',
      formulaName(constraint, `约束 ${index + 1}`),
      formulaText(constraint),
      `asset-template-constraint-${String(constraint.constraint_id || index)}`,
      'preview_only',
      formulaMetadata(constraint),
    )),
  ];
}

function componentsFromSpec(componentSpec: Record<string, unknown>, mathematicalExpansion: Record<string, unknown>) {
  const sections = arrayValue(mathematicalExpansion.sections);
  const objectiveTerms = arrayValue(objectValue(componentSpec.objective).terms);
  return componentsFrom(componentSpec.components).map((rawComponent, index) => {
    const component = rawComponent as Record<string, unknown>;
    const componentId = String(component.component_id || component.type || component.code || component.name || '');
    const generatedConstraints = arrayValue(component.generated_constraints || component.constraints);
    const generatedObjectiveTerms = arrayValue(component.generated_objective_terms || component.objective_terms);
    const sectionConstraints = sections
      .filter(section => String(section.type || 'constraint') === 'constraint')
      .filter(section => !section.source_component || String(section.source_component) === componentId)
      .map((section, sectionIndex) => ({
        constraint_id: section.constraint_id || section.title || `${componentId || 'constraint'}_${sectionIndex}`,
        name: section.title || section.name,
        expression: formulaText(section),
        source_component: section.source_component || componentId,
      }));
    const componentObjectiveTerms = objectiveTerms
      .filter(term => !term.source_component || String(term.source_component) === componentId)
      .map((term, termIndex) => ({
        term_id: term.term_id || term.weight_key || `${componentId || 'objective'}_${termIndex}`,
        name: formulaName(term, `目标项 ${termIndex + 1}`),
        expression: formulaText(term, ''),
        source_component: term.source_component || componentId,
      }));
    return {
      ...component,
      component_id: componentId || `component_${index + 1}`,
      type: component.type || componentId,
      name: component.name || component.display_name || componentId || `组件 ${index + 1}`,
      enabled: true,
      generated_constraints: generatedConstraints.length ? generatedConstraints : sectionConstraints,
      generated_objective_terms: generatedObjectiveTerms.length ? generatedObjectiveTerms : componentObjectiveTerms,
    };
  });
}

export function modelAssetToDraft(asset: ModelAsset): ModelDraft {
  const base = createInitialDraft();
  const savedDraft = objectValue(asset.model_draft);
  const savedBasic = objectValue(savedDraft.basic_info);
  const savedSemantic = objectValue(savedDraft.semantic);
  const semanticSpec = objectValue(asset.semantic_spec);
  const componentSpec = objectValue(asset.component_spec || semanticSpec.component_spec);
  const genericSpec = objectValue(asset.generic_spec || semanticSpec.generic_spec);
  const mathematicalExpansion = objectValue(asset.mathematical_expansion || semanticSpec.mathematical_expansion || savedDraft.mathematical_expansion);
  const savedAdvanced = objectValue(savedDraft.advanced);
  const savedGenericSpec = objectValue(savedAdvanced.generic_spec);
  const savedComponentSpec = objectValue(savedAdvanced.component_spec);
  const runtimeFromDraft = objectValue(savedDraft.runtime_parameters);
  const runtimeFromAsset = objectValue(asset.parameters);
  const semanticSource = hasKeys(savedSemantic) ? savedSemantic : semanticSpec;
  const componentSemanticFallback = hasKeys(componentSpec) ? componentSpec : {};
  const objectiveSource = hasKeys(objectValue(savedDraft.objective))
    ? savedDraft.objective
    : hasKeys(objectValue(componentSpec.objective))
      ? componentSpec.objective
      : mathematicalExpansion.objective;
  const normalizedObjective = normalizeObjectiveSpec(objectiveSource);
  const normalizedComponentSpec = hasKeys(componentSpec)
    ? { ...componentSpec, objective: normalizeObjectiveSpec(componentSpec.objective) }
    : componentSpec;
  const savedComponents = componentsFrom(savedDraft.components);
  const specComponents = componentsFromSpec(normalizedComponentSpec, mathematicalExpansion);
  const savedFormulas = normalizeSavedFormulas(Array.isArray(savedDraft.formulas) ? savedDraft.formulas as ModelDraft['formulas'] : []);
  const fallbackGenericFormulas = formulasFromGenericSpec(hasKeys(genericSpec) ? genericSpec : savedGenericSpec);
  const fallbackTemplateFormulas = formulasFromTemplateDraft({ ...savedDraft, objective: normalizedObjective }, mathematicalExpansion);

  const candidate = {
    ...base,
    ...savedDraft,
    basic_info: {
      ...base.basic_info,
      ...savedBasic,
      name: String(asset.name || savedBasic.name || base.basic_info.name),
      model_code: String(asset.template_id || savedBasic.model_code || semanticSpec.model_code || semanticSpec.code || asset.id),
      scenario_id: String(asset.scenario_id || savedBasic.scenario_id || semanticSpec.scenario_id || '') || undefined,
      scenario: String(asset.scene || savedBasic.scenario || semanticSpec.scenario || base.basic_info.scenario),
      builder_mode: asBuildMode(asset.build_mode || savedBasic.builder_mode || semanticSpec.build_mode || componentSpec.build_mode),
      solver: String(asset.solver || savedBasic.solver || 'HiGHS'),
      template_code: String(asset.template_id || savedBasic.template_code || semanticSpec.model_code || semanticSpec.code || asset.id),
    },
    semantic: {
      ui_metadata: objectValue(semanticSource.ui_metadata),
      sets: normalizeSets(semanticSource.sets || componentSemanticFallback.sets || base.semantic.sets),
      parameters: normalizeParameters(semanticSource.parameters || componentSemanticFallback.parameters || []),
      variables: normalizeVariables(semanticSource.variables || componentSemanticFallback.variables || []),
    },
    components: savedComponents.length ? savedComponents : specComponents,
    objective: normalizedObjective,
    formulas: savedFormulas.length ? savedFormulas : fallbackGenericFormulas.length ? fallbackGenericFormulas : fallbackTemplateFormulas,
    runtime_parameters: hasKeys(runtimeFromDraft) ? runtimeFromDraft : { ...runtimeFromAsset },
    parameter_groups: hasKeys(objectValue(savedDraft.parameter_groups)) ? objectValue(savedDraft.parameter_groups) as ModelDraft['parameter_groups'] : base.parameter_groups,
    advanced: {
      ...base.advanced,
      ...savedAdvanced,
      description: String(savedAdvanced.description || objectValue(asset.ui_metadata).description || semanticSpec.description || ''),
      ui_metadata: { ...objectValue(asset.ui_metadata), ...objectValue(savedAdvanced.ui_metadata) },
      generic_spec: hasKeys(genericSpec) ? genericSpec : hasKeys(savedGenericSpec) ? savedGenericSpec : undefined,
      component_spec: hasKeys(normalizedComponentSpec) ? normalizedComponentSpec : hasKeys(savedComponentSpec) ? savedComponentSpec : undefined,
    },
  } as ModelDraft;
  const explicitTimeDimension = objectValue(asset.ui_metadata).time_dimension
    || savedDraft.time_dimension
    || objectValue(savedAdvanced.ui_metadata).time_dimension
    || objectValue(semanticSpec.ui_metadata).time_dimension
    || objectValue(componentSpec.ui_metadata).time_dimension
    || objectValue(genericSpec.ui_metadata).time_dimension;
  candidate.time_dimension = explicitTimeDimension
    ? normalizeTimeDimensionConfig(explicitTimeDimension, candidate.semantic.sets.map(item => item.code))
    : inferTimeDimensionConfig(candidate);
  candidate.components = reconcileComponentParameterBindings(candidate.semantic.parameters, candidate.components);
  return normalizeModelDraft(candidate);
}
