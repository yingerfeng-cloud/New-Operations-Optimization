import { Alert, Button, Card, Descriptions, Empty, Form, Input, Modal, Popover, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { Collapse } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { FormulaDef } from '../../../types/formula';
import type { ModelDraft } from '../stores/modelCreationStore';
import type { FunctionAsset } from '../../../types/functionAsset';
import { getFunctionAssets } from '../../../api/functionAssets';
import { FormulaBuilderModal } from '../../formula-editor/FormulaBuilderModal';
import { JsonViewer } from '../../../components/JsonViewer';
import { FormulaDisplay } from '../../formula-editor/FormulaDisplay';
import { analyzeDraftNonlinear, analyzeFormulaText, firstBilinearDiagnostic } from '../utils/nonlinearDiagnostics';
import { FormulaManagementPanel } from '../../formula-editor/FormulaManagementPanel';
import { compileFormulaAuthoritatively, isAuthoritativeArtifactCurrent, type AuthoritativeCompileContext } from '../../formula-editor/authoritativeCompilation';
import { composeAuthoritativeGenericSpec } from '../utils/composeAuthoritativeGenericSpec';
import { markFormulaApplied, markFormulaCompiled, markFormulaSaved } from '../../formula-editor/formulaVersioning';

const newFormula = (kind: 'constraint' | 'objective'): FormulaDef => ({
  formula_id: crypto.randomUUID(),
  name: kind === 'constraint' ? '新约束' : '目标函数',
  kind,
  display_formula: '',
  dsl_formula: '',
  tokens: [],
  foreach: [],
  referenced_sets: [],
  referenced_parameters: [],
  referenced_variables: [],
  free_indices: [],
  compile_status: 'error',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

function componentRows(component: Record<string, unknown>, key: string) {
  const value = component[key];
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function schemaCode(row: Record<string, unknown>) {
  return String(row.code || row.key || row.name || '').trim();
}

function schemaDimension(row: Record<string, unknown>) {
  const value = row.indices || row.dimension || row.dimensions || row.index_sets;
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function mergeSchemaRows(
  base: Array<Record<string, unknown>>,
  additions: Array<Record<string, unknown>>,
) {
  const rows = [...base];
  const seen = new Set(rows.map(schemaCode).filter(Boolean));
  additions.forEach(row => {
    const code = schemaCode(row);
    if (!code || seen.has(code)) return;
    rows.push({ ...row, code, indices: schemaDimension(row), dimension: schemaDimension(row) });
    seen.add(code);
  });
  return rows;
}

function componentDefinitionRows(draft: ModelDraft, key: 'variables' | 'derived_parameters') {
  const rows: Array<Record<string, unknown>> = [];
  const catalogValue = (draft.advanced as unknown as Record<string, unknown>).component_catalog;
  const catalog = Array.isArray(catalogValue)
    ? catalogValue as Array<Record<string, unknown>>
    : [];
  draft.components.forEach(component => {
    const componentType = String(component.type || component.component_id || '');
    const definition = component.definition && typeof component.definition === 'object'
      ? component.definition as Record<string, unknown>
      : catalog.find(item => String(item.type || item.component_id || '') === componentType);
    if (definition) rows.push(...componentRows(definition, key));
  });
  return rows;
}

const HYDRO_DERIVED_PARAMETER_FALLBACK: Record<string, Array<Record<string, unknown>>> = {
  hydro_station_available_capacity: [{ code: 'station_pmax', name: '电站可用容量', dimension: ['station', 'time'], derived: true }],
  hydro_reservoir_balance: [{ code: 'delta_v', name: '流量库容换算系数', dimension: [], derived: true }],
};

const tableRowIds = new WeakMap<object, string>();
let tableRowSeq = 0;

function stableRowKey(row: Record<string, unknown>) {
  const stableId = row.id || row.constraint_id || row.term_id || row.weight_key || row.component_parameter || row.parameter || row.parameter_code || row.code;
  if (stableId) return String(stableId);
  if (!tableRowIds.has(row)) {
    tableRowIds.set(row, `${String(row.name || row.expression || row.formula || 'row')}-${tableRowSeq}`);
    tableRowSeq += 1;
  }
  return tableRowIds.get(row)!;
}

function variableExpressionOptions(draft: ModelDraft) {
  return draft.semantic.variables.map(variable => {
    const code = variable.code;
    const indices = variable.indices || variable.dimension || [];
    const expression = indices.length ? `${code}[${indices.map((_, index) => (index === 0 ? 't' : `i${index}`)).join(',')}]` : code;
    return { value: expression, label: `${variable.name || code} (${expression})` };
  });
}

function setOptions(draft: ModelDraft) {
  return draft.semantic.sets.map(set => ({ value: set.code, label: set.name ? `${set.name} (${set.code})` : set.code }));
}

function baseVariableName(expression?: string) {
  return String(expression || '').trim().match(/^([A-Za-z_]\w*)/)?.[1] || '';
}

function hasSemanticVariable(draft: ModelDraft, expression?: string) {
  const variable = baseVariableName(expression);
  return Boolean(variable && draft.semantic.variables.some(item => item.code === variable));
}

function functionMappingType(component: Record<string, unknown>) {
  const id = String(component.type || component.component_id || '');
  if (id === 'function_mapping_2d_component') return 'piecewise_2d';
  if (id === 'function_mapping_component' || id === 'piecewise_linear_curve') return 'piecewise_1d';
  return undefined;
}

function assetOptionLabel(asset: FunctionAsset) {
  const status = asset.validation_status || 'valid';
  const suffix = status === 'invalid' ? ` - 异常：${(asset.validation_errors || []).map(item => String(item.message || item.error || '')).filter(Boolean).join('; ') || '校验未通过'}` : '';
  const solveSuffix = asset.solve_strategy === 'display_only' ? ' - 仅展示，不可用于求解' : '';
  return `${asset.name || asset.function_id} (${asset.function_id}, ${status})${suffix}${solveSuffix}`;
}

function invalidAssetReason(asset: FunctionAsset) {
  return (asset.validation_errors || []).map(item => String(item.message || item.error || '')).filter(Boolean).join('；') || '资产校验未通过，不能参与模型发布';
}

function isDisplayOnlyAsset(asset?: FunctionAsset) {
  return asset?.solve_strategy === 'display_only';
}

function isSolveSelectableAsset(asset: FunctionAsset) {
  return asset.validation_status !== 'invalid' && !isDisplayOnlyAsset(asset);
}

function formulaStatus(formula: FormulaDef, variableCodes: string[]) {
  if (formula.compile_status === 'compile_valid') {
    return { color: 'green', text: '已校验', description: '后端已完成权威编译，当前公式片段可用于生成求解结构。' };
  }
  if (formula.compile_status === 'stale') {
    return { color: 'orange', text: '需重新校验', description: '公式或其依赖的语义定义发生变化，原有编译结果已过期。' };
  }
  if (formula.compile_status === 'error' || formula.compile_status === 'compile_failed' || formula.compile_status === 'unsupported') {
    return { color: 'red', text: '校验失败', description: formula.compile_error || '后端编译未通过，请打开编辑器查看具体诊断。' };
  }
  if (formula.compile_status === 'disabled') {
    return { color: 'default', text: '已停用', description: '该公式不会参与当前模型求解。' };
  }
  if (formula.compile_status === 'preview_only') {
    return { color: 'default', text: '仅预览', description: '该公式只用于展示，不会参与当前模型求解。' };
  }

  const diagnostics = analyzeFormulaText(formula.dsl_formula || '', variableCodes, formula.name);
  const nonlinear = diagnostics.find(item => item.blocking || item.risk_level === 'high' || item.risk_level === 'medium');
  if (nonlinear) {
    return {
      color: nonlinear.blocking ? 'red' : 'orange',
      text: nonlinear.blocking ? '非线性阻断' : '需确认',
      description: nonlinear.message,
    };
  }

  if (formula.compile_status === 'syntax_valid') {
    return { color: 'blue', text: '待语义校验', description: '语法已通过，但变量、参数维度和求解片段还未完成权威校验。' };
  }
  if (formula.compile_status === 'semantic_valid') {
    return { color: 'blue', text: '待权威编译', description: '语义检查已通过，还需要执行后端权威编译才能参与发布。' };
  }
  return { color: 'blue', text: '待校验', description: '尚未完成后端权威编译；这个状态不代表公式有问题，只表示还没有最终校验结论。' };
}

function bindingStatusTag(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'bound' || normalized === 'complete' || normalized === 'configured') {
    return <Tooltip title="组件参数已对应到模型参数或运行时输入，求解时可以正常取值。"><Tag color="green">已绑定</Tag></Tooltip>;
  }
  if (normalized === 'missing' || normalized === 'unbound' || normalized === 'pending') {
    return <Tooltip title="组件参数尚未对应到模型参数或运行时输入，完成绑定后才能通过发布校验。"><Tag color="orange">待绑定</Tag></Tooltip>;
  }
  return <Tooltip title={normalized ? `原始状态：${String(status)}` : '尚未得到参数绑定校验结论。'}><Tag color="default">{normalized ? String(status) : '待确认'}</Tag></Tooltip>;
}

function formulaBusinessCards(formulas: FormulaDef[], onEdit: (formula: FormulaDef) => void, variableCodes: string[]) {
  const objectives = formulas.filter(formula => formula.kind === 'objective');
  const constraints = formulas.filter(formula => formula.kind === 'constraint');
  const groups = [
    { key: 'objective', title: '目标函数', empty: '尚未维护目标函数', rows: objectives },
    { key: 'constraint', title: '约束条件', empty: '尚未维护约束条件', rows: constraints },
  ];
  return (
    <div className="formula-business-grid section-gap">
      {groups.map(group => (
        <div key={group.key} className="model-section-anchor" data-section-key={group.key}>
          <Card title={group.title}>
            <Space orientation="vertical" size={10} style={{ width: '100%' }}>
              {group.rows.length ? group.rows.map(formula => {
                const status = formulaStatus(formula, variableCodes);
                return (
                  <div className="formula-business-card" key={formula.formula_id}>
                    <div>
                      <Space wrap>
                        <Typography.Text strong>{formula.name}</Typography.Text>
                        <Tooltip title={status.description}>
                          <Tag color={status.color}>{status.text}</Tag>
                        </Tooltip>
                      </Space>
                      <FormulaDisplay row={formula as unknown as Record<string, unknown>} />
                      <Space wrap size={4}>
                        {(formula.referenced_variables || []).map(item => <Tag color="purple" key={`v-${item}`}>{item}</Tag>)}
                        {(formula.referenced_parameters || []).map(item => <Tag color="green" key={`p-${item}`}>{item}</Tag>)}
                      </Space>
                    </div>
                    <Button onClick={() => onEdit(formula)}>编辑</Button>
                  </div>
                );
              }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={group.empty} />}
            </Space>
          </Card>
        </div>
      ))}
    </div>
  );
}

export function Step3MathExpansion({ draft, onChange }: { draft: ModelDraft; onChange: (d: ModelDraft) => void }) {
  const [modal, modalContextHolder] = Modal.useModal();
  const [editing, setEditing] = useState<FormulaDef>();
  const [selectedComponentKey, setSelectedComponentKey] = useState<string>();
  const [compileError, setCompileError] = useState('');
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingTargetIndex, setMappingTargetIndex] = useState<number | null>(null);
  const [mappingForm] = Form.useForm();
  const functionAssets = useQuery({ queryKey: ['function-assets'], queryFn: getFunctionAssets, enabled: mappingOpen });
  const selectedFunctionAssetId = Form.useWatch('function_asset_id', mappingForm);
  const selectedStrategy = Form.useWatch('solve_strategy', mappingForm);
  const selectedMappingType = Form.useWatch('mapping_type', mappingForm);
  const selectedAsset = (functionAssets.data || []).find(asset => asset.function_id === selectedFunctionAssetId);
  const effectiveMappingType = selectedMappingType === 'piecewise_2d'
    ? 'piecewise_2d'
    : selectedMappingType === 'piecewise_1d'
      ? 'piecewise_1d'
      : selectedAsset?.function_type === 'piecewise_2d'
        ? 'piecewise_2d'
        : 'piecewise_1d';
  const targetMappingType = mappingTargetIndex === null ? undefined : functionMappingType(draft.components[mappingTargetIndex] || {});
  const matchingFunctionAssets = targetMappingType
    ? (functionAssets.data || []).filter(asset => asset.function_type === targetMappingType)
    : (functionAssets.data || []);
  const selectedConvexity = selectedAsset?.convexity || selectedAsset?.diagnostics?.convexity;
  const legacyDisplayOnlyStrategy = selectedStrategy === 'display_only'
    ? [{ value: 'display_only', label: 'display_only - 仅展示（不可用于求解）', disabled: true }]
    : [];
  const componentVariables = componentDefinitionRows(draft, 'variables');
  const componentDerivedParameters = componentDefinitionRows(draft, 'derived_parameters');
  const fallbackDerivedParameters = draft.components.flatMap(component => {
    const type = String(component.type || component.component_id || '');
    return HYDRO_DERIVED_PARAMETER_FALLBACK[type] || [];
  });
  const parameterRows = mergeSchemaRows(
    draft.semantic.parameters as unknown as Array<Record<string, unknown>>,
    [...componentDerivedParameters, ...fallbackDerivedParameters],
  );
  const variableRows = mergeSchemaRows(
    draft.semantic.variables as unknown as Array<Record<string, unknown>>,
    componentVariables,
  );
  const symbols = {
    sets: Object.fromEntries(draft.semantic.sets.map(x => [x.code, x.name || x.code])),
    parameters: Object.fromEntries(parameterRows.map(x => [schemaCode(x), { label: String(x.name || schemaCode(x)), indices: schemaDimension(x), unit: String(x.unit || ''), description: String(x.description || '') }])),
    variables: Object.fromEntries(variableRows.map(x => [schemaCode(x), { label: String(x.name || schemaCode(x)), indices: schemaDimension(x), unit: String(x.unit || ''), description: String(x.description || '') }])),
  };
  const authoritativeContext: AuthoritativeCompileContext = {
    symbols: {
      sets: Object.fromEntries(draft.semantic.sets.map(set => [set.code, { values: set.values || [] }])),
      parameters: parameterRows.map(parameter => ({
        ...parameter,
        dimension: schemaDimension(parameter),
      })),
      variables: variableRows.map(variable => ({
        ...variable,
        dimension: schemaDimension(variable),
      })),
    },
    model_context: { time_dimension: draft.time_dimension },
  };
  const formulaVariableCodes = [...new Set([
    ...draft.semantic.variables.map(variable => variable.code),
    ...draft.formulas.flatMap(formula => formula.referenced_variables || []),
  ].filter(Boolean))];
  const nonlinearReport = analyzeDraftNonlinear(draft);
  const nonlinearMessageGroups = Object.entries(nonlinearReport.relationships.reduce<Record<string, number>>((counts, item) => {
    const messageText = String(item.message || '检测到非线性关系');
    counts[messageText] = (counts[messageText] || 0) + 1;
    return counts;
  }, {})).map(([messageText, count]) => ({ messageText, count }));
  const nonlinearSummary = nonlinearMessageGroups.map(item => `${item.messageText}${item.count > 1 ? `（${item.count} 处）` : ''}`).join('；');
  const nonlinearDetails = <div className="model-diagnostic-details">{nonlinearMessageGroups.map(item => <div key={item.messageText}><span>{item.messageText}</span>{item.count > 1 && <Tag>{item.count} 处</Tag>}</div>)}</div>;
  const formulaStatusGuide = (
    <Alert
      className="section-gap compact-step-note formula-status-guide"
      type="info"
      showIcon
      title="公式状态说明"
      description="“待校验”表示尚未完成后端权威编译，不代表公式有问题；只有检测到决策变量之间相乘、变量除法、幂或一般非线性函数时，才会显示非线性风险或需确认。普通的参数 × 变量成本项仍属于线性表达。"
    />
  );

  useEffect(() => {
    if (!mappingOpen || !functionAssets.data?.length) return;
    const currentId = mappingForm.getFieldValue('function_asset_id');
    const current = functionAssets.data.find(asset => asset.function_id === currentId);
    if (current && current.validation_status !== 'invalid' && (!targetMappingType || current.function_type === targetMappingType)) return;
    const firstSelectable = functionAssets.data.find(asset => (!targetMappingType || asset.function_type === targetMappingType) && isSolveSelectableAsset(asset));
    mappingForm.setFieldValue('function_asset_id', firstSelectable?.function_id);
  }, [functionAssets.data, mappingForm, mappingOpen, targetMappingType]);

  useEffect(() => {
    if (!mappingOpen || !selectedAsset) return;
    if (selectedAsset.function_type === 'piecewise_2d') {
      mappingForm.setFieldsValue({ mapping_type: 'piecewise_2d', solve_strategy: 'triangulated_milp_exact' });
    } else if (selectedAsset.function_type === 'piecewise_1d') {
      mappingForm.setFieldsValue({ mapping_type: 'piecewise_1d', solve_strategy: 'convex_combination_lp' });
    }
  }, [mappingForm, mappingOpen, selectedAsset]);

  const compile = async () => {
    try {
      let formulas = [...draft.formulas];
      for (const source of formulas.filter(formula => (formula.solve_participation || 'solve_active') === 'solve_active')) {
        if (isAuthoritativeArtifactCurrent(source, authoritativeContext)) continue;
        const { result, artifact } = await compileFormulaAuthoritatively(source, authoritativeContext);
        const updated = markFormulaCompiled({
          ...source,
          scope: result.scope,
          diagnostics: result.diagnostics,
          ast_version: result.ast_version,
          compiler_version: result.compiler_version,
          compile_status: artifact ? 'compile_valid' : 'compile_failed',
          compile_error: result.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('；') || undefined,
          authoritative_artifact: artifact,
        }, artifact);
        formulas = formulas.map(item => item.formula_id === source.formula_id ? updated : item);
        if (!artifact) throw new Error(`${source.name} 未通过后端权威编译：${updated.compile_error || '未返回可求解片段'}`);
      }
      const nextDraft = { ...draft, formulas };
      const spec = composeAuthoritativeGenericSpec(nextDraft);
      const appliedFormulas = formulas.map(formula => (formula.solve_participation || 'solve_active') === 'solve_active' ? markFormulaApplied(formula) : formula);
      setCompileError('');
      onChange({ ...nextDraft, formulas: appliedFormulas, advanced: { ...draft.advanced, generic_spec: spec } });
      modal.success({ title: 'generic_spec 权威编译成功', content: '最终求解结构仅由后端 compiled fragments 组合生成。' });
    } catch (error) {
      const text = String(error);
      setCompileError(text);
      modal.error({ title: '编译失败，已阻止发布', content: text });
    }
  };

  const applyFormula = (formula: FormulaDef) => {
    const requiresUniqueName = formula.solve_participation !== 'preview_only';
    const duplicateName = requiresUniqueName && draft.formulas.some(item => (
      item.formula_id !== formula.formula_id
      && item.solve_participation !== 'preview_only'
      && item.name.trim() === formula.name.trim()
    ));
    if (!formula.name.trim()) {
      message.error('公式名称不能为空');
      return;
    }
    if (duplicateName) {
      message.error(`公式名称必须唯一：${formula.name}`);
      return;
    }
    if ((formula.solve_participation || 'solve_active') === 'solve_active' && !isAuthoritativeArtifactCurrent(formula, authoritativeContext)) {
      message.error('solve_active 公式必须先完成当前版本的后端权威编译');
      return;
    }
    const exists = draft.formulas.some(x => x.formula_id === formula.formula_id);
    const now = new Date().toISOString();
    const saved = markFormulaSaved({ ...formula, created_at: formula.created_at || now, updated_at: now }, now);
    onChange({ ...draft, formulas: exists ? draft.formulas.map(x => x.formula_id === formula.formula_id ? saved : x) : [...draft.formulas, saved], advanced: { ...draft.advanced, generic_spec: undefined } });
    setEditing(undefined);
  };

  const deleteFormula = (formulaId: string) => {
    onChange({ ...draft, formulas: draft.formulas.filter(x => x.formula_id !== formulaId), advanced: { ...draft.advanced, generic_spec: undefined } });
    setEditing(undefined);
  };

  const addMccormickFromDiagnostic = () => {
    const diagnostic = firstBilinearDiagnostic(draft);
    if (!diagnostic) return;
    const [x, y] = diagnostic.involved_variables;
    const lhs = diagnostic.expression.match(/^\s*([^=<>!]+)\s*==/)?.[1]?.trim();
    const xBase = baseVariableName(x);
    const yBase = baseVariableName(y);
    const indexSuffix = x.match(/\[[^\]]+\]/)?.[0] || y.match(/\[[^\]]+\]/)?.[0] || '';
    const w = lhs && ![xBase, yBase].includes(baseVariableName(lhs)) ? lhs : `${xBase}_${yBase}_mccormick${indexSuffix}`;
    const wBase = baseVariableName(w);
    const xVar = draft.semantic.variables.find(variable => variable.code === xBase);
    const yVar = draft.semantic.variables.find(variable => variable.code === yBase);
    const hasW = draft.semantic.variables.some(variable => variable.code === wBase);
    const component = {
      component_id: 'mccormick_bilinear_relaxation_component',
      type: 'mccormick_bilinear_relaxation_component',
      name: 'McCormick 双线性松弛',
      enabled: true,
      x,
      y,
      w,
      x_lower: xVar?.lowerBound,
      x_upper: xVar?.upperBound,
      y_lower: yVar?.lowerBound,
      y_upper: yVar?.upperBound,
      indices: draft.semantic.sets.find(set => set.code === 'time') ? [{ set: 'time', alias: 't' }] : [],
      relaxation_type: 'convex_envelope',
      generated_constraints: [{ constraint_id: `mccormick_${xBase}_${yBase}`, type: 'mccormick', expression: `${w} ~= ${x} * ${y}` }],
      metadata: { relaxation_warning: 'McCormick 是松弛，不是精确等价表达。' },
    };
    const variables = hasW ? draft.semantic.variables : [...draft.semantic.variables, { code: wBase, name: wBase, dimension: xVar?.dimension || xVar?.indices || [], domain: 'NonNegativeReals' }];
    onChange({ ...draft, semantic: { ...draft.semantic, variables }, components: [...draft.components, component] });
    message.success('已生成 McCormick 松弛组件，请确认 x/y 上下界后再发布。');
  };

  const openFunctionMapping = (targetIndex?: number) => {
    const variables = variableExpressionOptions(draft);
    const sets = setOptions(draft);
    const existing = targetIndex === undefined ? undefined : draft.components[targetIndex];
    const existingMappingType = existing ? functionMappingType(existing) : undefined;
    const existingIndex = Array.isArray(existing?.indices) ? existing.indices[0] as Record<string, unknown> | undefined : undefined;
    mappingForm.resetFields();
    mappingForm.setFieldsValue({
      function_asset_id: existing?.function_asset_id,
      mapping_type: existingMappingType || 'piecewise_1d',
      x: existing?.x || variables[0]?.value,
      x_pick: existing?.x || variables[0]?.value,
      y: existing?.y || variables[1]?.value || variables[0]?.value,
      y_pick: existing?.y || variables[1]?.value || variables[0]?.value,
      z: existing?.z || variables[2]?.value || variables[1]?.value || variables[0]?.value,
      z_pick: existing?.z || variables[2]?.value || variables[1]?.value || variables[0]?.value,
      index_set: existingIndex?.set || sets.find(item => item.value === 'time')?.value || sets[0]?.value,
      index_alias: existingIndex?.alias || 't',
      solve_strategy: existing?.solve_strategy || (existingMappingType === 'piecewise_2d' ? 'triangulated_milp_exact' : 'convex_combination_lp'),
      constraint_id: existing?.constraint_id || `function_mapping_${Date.now()}`,
    });
    setMappingTargetIndex(targetIndex ?? null);
    setMappingOpen(true);
  };

  const addFunctionMappingComponent = (values: Record<string, string>) => {
    const persistMappingComponent = (component: Record<string, unknown>) => {
      const nextComponents = [...draft.components];
      let selectedIndex = nextComponents.length;
      if (mappingTargetIndex !== null && nextComponents[mappingTargetIndex]) {
        const existing = nextComponents[mappingTargetIndex];
        nextComponents[mappingTargetIndex] = {
          ...existing,
          ...component,
          name: existing.name || component.name,
          display_name: existing.display_name || component.display_name,
        };
        selectedIndex = mappingTargetIndex;
      } else {
        nextComponents.push(component);
      }
      onChange({ ...draft, components: nextComponents });
      setSelectedComponentKey(String(nextComponents[selectedIndex].constraint_id || nextComponents[selectedIndex].function_asset_id));
      message.success(mappingTargetIndex === null ? '函数映射已添加' : '函数资产绑定已更新');
      setMappingTargetIndex(null);
      setMappingOpen(false);
    };
    const selectedAssetForMapping = (functionAssets.data || []).find(asset => asset.function_id === values.function_asset_id);
    const is2dMapping = selectedAssetForMapping?.function_type === 'piecewise_2d' || values.mapping_type === 'piecewise_2d';
    if (is2dMapping) {
      const expressions = [values.x, values.y, values.z];
      if (expressions.some(value => !/^[A-Za-z_]\w*(\[[^\]]+\])?$/.test(value || ''))) {
        message.error('x、y、z 必须填写变量名或带索引的变量表达式，例如 flow[t]');
        return;
      }
      if (!selectedAssetForMapping || selectedAssetForMapping.validation_status === 'invalid' || selectedAssetForMapping.function_type !== 'piecewise_2d') {
        message.error('二维函数映射需要选择有效的二维函数资产（piecewise_2d）。当前选择的资产不是二维资产。');
        return;
      }
      if (isDisplayOnlyAsset(selectedAssetForMapping)) {
        message.error('当前函数资产标记为“仅展示”，不能用于建模求解，请更换为可求解资产。');
        return;
      }
      if (!hasSemanticVariable(draft, values.z)) {
        message.error(`输出变量 ${baseVariableName(values.z) || values.z} 未在 Step2 中定义，请先在语义模型中新增或选择已有变量。`);
        return;
      }
      if (values.solve_strategy === 'display_only') {
        message.error('display_only 只能用于展示，不能作为可求解组件发布。');
        return;
      }
      const component = {
        component_id: 'function_mapping_2d_component',
        type: 'function_mapping_2d_component',
        name: '二维函数映射',
        display_name: '二维函数映射',
        enabled: true,
        function_asset_id: values.function_asset_id,
        x: values.x,
        y: values.y,
        z: values.z,
        indices: values.index_set ? [{ set: values.index_set, alias: values.index_alias || 't' }] : [],
        solve_strategy: values.solve_strategy || 'triangulated_milp_exact',
        constraint_id: values.constraint_id,
        generated_constraints: [{
          constraint_id: values.constraint_id,
          type: 'piecewise_2d',
          expression: `${values.z} == piecewise_2d(${values.x}, ${values.y}, ${values.function_asset_id})`,
          piecewise_method: values.solve_strategy || 'triangulated_milp_exact',
          function_asset_id: values.function_asset_id,
        }],
        metadata: {
          function_asset_name: selectedAssetForMapping.name,
          validation_status: selectedAssetForMapping.validation_status || 'valid',
          triangle_count: selectedAssetForMapping.surface_diagnostics?.triangle_count || selectedAssetForMapping.diagnostics?.triangle_count,
          point_count: selectedAssetForMapping.surface_diagnostics?.point_count || selectedAssetForMapping.diagnostics?.point_count,
        },
      };
      persistMappingComponent(component);
      return;
    }
    if (!/^[A-Za-z_]\w*(\[[^\]]+\])?$/.test(values.x || '') || !/^[A-Za-z_]\w*(\[[^\]]+\])?$/.test(values.y || '')) {
      message.error('输入变量 x 和输出变量 y 必须是变量名或变量索引表达式，例如 volume[t]');
      return;
    }
    if (!hasSemanticVariable(draft, values.y)) {
      const yVar = baseVariableName(values.y);
      message.error(`输出变量 ${yVar || values.y} 未在语义模型变量中定义，请先在 Step2 新增该变量，或选择已有变量。`);
      return;
    }
    const selectedAsset = (functionAssets.data || []).find(asset => asset.function_id === values.function_asset_id);
    if (!selectedAsset || selectedAsset.validation_status === 'invalid') {
      message.error('请选择校验状态为“有效”或“有警告”的函数/曲线资产（valid 或 warning）。');
      return;
    }
    if (isDisplayOnlyAsset(selectedAsset)) {
      message.error('当前函数资产标记为“仅展示”，不能用于建模求解，请更换为可求解资产。');
      return;
    }
    const component = {
      component_id: 'function_mapping_component',
      type: 'function_mapping_component',
      name: '函数映射',
      display_name: '函数映射',
      enabled: true,
      function_asset_id: values.function_asset_id,
      x: values.x,
      y: values.y,
      indices: values.index_set ? [{ set: values.index_set, alias: values.index_alias || 't' }] : [],
      solve_strategy: values.solve_strategy,
      constraint_id: values.constraint_id,
      generated_constraints: [{
        constraint_id: values.constraint_id,
        type: 'piecewise',
        expression: `${values.y} == piecewise(${values.x}, ${values.function_asset_id})`,
        piecewise_method: values.solve_strategy,
        function_asset_id: values.function_asset_id,
      }],
      metadata: {
        function_asset_name: selectedAsset.name,
        validation_status: selectedAsset.validation_status || 'valid',
        convexity: selectedAsset.convexity || selectedAsset.diagnostics?.convexity,
        monotonicity: selectedAsset.monotonicity,
      },
    };
    persistMappingComponent(component);
  };

  const componentStatus = (component: Record<string, unknown>) => {
    if (functionMappingType(component) && !component.function_asset_id) return { color: 'red', text: '未绑定函数资产' };
    if (component.solve_strategy === 'display_only') return { color: 'default', text: '不参与求解' };
    if (component.solve_strategy === 'binary_segment_milp' || component.solve_strategy === 'convex_hull_lp_approx') return { color: 'orange', text: '有风险' };
    if (component.function_asset_id && (!component.x || !component.y || (String(component.type || component.component_id) === 'function_mapping_2d_component' && !component.z))) return { color: 'red', text: '缺少配置' };
    return { color: 'green', text: '已配置' };
  };

  const componentType = (component: Record<string, unknown>) => {
    if (component.function_asset_id) return '函数映射';
    if (component.type === 'custom_constraint') return '自定义约束';
    if (component.type === 'objective') return '目标函数';
    return '通用组件';
  };

  const componentKey = (component: Record<string, unknown>, index: number) => String(component.constraint_id || component.function_asset_id || component.component_id || component.name || `component_${index}`);

  const formulaEditor = (
    <FormulaBuilderModal
      open={!!editing}
      value={editing}
      symbols={symbols}
      compileContext={authoritativeContext}
      onApply={applyFormula}
      onCancel={() => setEditing(undefined)}
      onDelete={deleteFormula}
    />
  );

  const renderComponentDetail = (component?: Record<string, unknown>) => {
    if (!component) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择左侧构件查看配置" />;
    const status = componentStatus(component);
    const generatedConstraints = [...componentRows(component, 'generated_constraints'), ...componentRows(component, 'constraints')];
    const generatedObjectives = [...componentRows(component, 'generated_objective_terms'), ...componentRows(component, 'objective_terms')];
    const parameterBindings = componentRows(component, 'parameter_bindings');
    return (
      <Card title={String(component.display_name || component.name || component.component_id || '构件配置')} extra={<Tag color={status.color}>{status.text}</Tag>}>
        <Descriptions size="small" column={3} items={[
          { key: 'type', label: '构件类型', children: componentType(component) },
          { key: 'asset', label: '函数资产', children: String(component.function_asset_id || '-') },
          { key: 'strategy', label: '求解策略', children: String(component.solve_strategy || '-') },
          { key: 'x', label: '输入 x', children: String(component.x || '-') },
          { key: 'y', label: functionMappingType(component) === 'piecewise_2d' ? '输入 y' : '输出 y', children: String(component.y || '-') },
          { key: 'z', label: '输出 z', children: String(component.z || '-') },
          { key: 'indices', label: '索引集合', children: JSON.stringify(component.indices || []) },
          { key: 'dependencies', label: '依赖项', children: Array.isArray(component.dependencies) && component.dependencies.length ? component.dependencies.join(', ') : '-' },
        ]} />
        {component.solve_strategy === 'binary_segment_milp' && <Alert className="section-gap" type="warning" showIcon title="预留能力，当前不可发布为可求解模型。" />}
        {Boolean(component.metadata) && ['unknown', 'nonconvex'].includes(String((component.metadata as Record<string, unknown>).convexity || '')) && component.solve_strategy === 'convex_combination_lp' && (
          <Alert className="section-gap compact-step-note" type="warning" showIcon title="凸组合 LP 风险" description="当前曲线凸性未知或非凸，结果可能不严格落在原始折线上。" />
        )}
        {component.solve_strategy === 'convex_hull_lp_approx' && (
          <Alert className="section-gap compact-step-note" type="warning" showIcon title="convex_hull_lp_approx 非精确近似" description="该策略不是一般二维曲面的精确表达，只适用于凸包近似或特定凸/凹函数边界。" />
        )}
        {generatedConstraints.length ? (
          <Table className="section-gap" size="small" pagination={false} rowKey={stableRowKey} dataSource={generatedConstraints} columns={[{ title: '约束', dataIndex: 'name' }, { title: '公式', render: (_, row) => <FormulaDisplay row={row} /> }]} />
        ) : <Typography.Paragraph className="component-output-empty" type="secondary">约束：0（当前构件没有生成约束）</Typography.Paragraph>}
        {generatedObjectives.length ? (
          <Table className="section-gap" size="small" pagination={false} rowKey={stableRowKey} dataSource={generatedObjectives} columns={[{ title: '目标项', dataIndex: 'name' }, { title: '公式', render: (_, row) => <FormulaDisplay row={row} /> }]} />
        ) : <Typography.Paragraph className="component-output-empty" type="secondary">目标项：0（当前构件不生成目标项）</Typography.Paragraph>}
        {parameterBindings.length ? (
          <>
            <Typography.Text type="secondary">参数绑定记录（组件参数 → 模型参数）</Typography.Text>
            <Table className="section-gap" size="small" pagination={false} rowKey={stableRowKey} dataSource={parameterBindings} columns={[{ title: '组件参数', dataIndex: 'component_parameter' }, { title: '模型参数', dataIndex: 'model_parameter', render: value => value || '—' }, { title: '状态', dataIndex: 'status', render: value => bindingStatusTag(value) }]} />
          </>
        ) : <Typography.Paragraph className="component-output-empty" type="secondary">参数绑定：0（当前构件没有需要绑定的参数）</Typography.Paragraph>}
      </Card>
    );
  };

  const renderComponentWorkbench = () => {
    const selected = draft.components.find((component, index) => componentKey(component, index) === selectedComponentKey) || draft.components[0];
    return (
      <div className="math-expansion-workbench section-gap">
        <Card className="component-list-panel" title="构件清单">
          {draft.components.length ? draft.components.map((component, index) => {
            const name = String(component.display_name || component.name || component.component_id || `组件 ${index + 1}`);
            const status = componentStatus(component);
            const key = componentKey(component, index);
            return (
              <button type="button" className={`component-list-item ${componentKey(selected || {}, 0) === key ? 'active' : ''}`} key={key} onClick={() => setSelectedComponentKey(key)}>
                <span>
                  <strong>{name}</strong>
                  <small>{componentType(component)}</small>
                </span>
                <Tag color={status.color}>{status.text}</Tag>
              </button>
            );
          }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未添加构件" />}
        </Card>
        <div className="component-config-panel">
          {renderComponentDetail(selected)}
        </div>
      </div>
    );
  };

  const renderComponentSummaryList = () => (
    <Space orientation="vertical" size={16} style={{ width: '100%' }} className="section-gap">
      <Typography.Paragraph className="component-summary-intro" type="secondary">
        这里是组件装配后的审计视图：展示组件实际生成的约束、目标项、上游依赖和参数映射。它与上方公式卡片引用同一份模型定义，便于核对生成结果，不会重复求解或生成第二套公式。
      </Typography.Paragraph>
      {draft.components.length ? draft.components.map((component, index) => {
        const name = String(component.display_name || component.name || component.component_id || `组件 ${index + 1}`);
        const dependencies = [...new Set([...(Array.isArray(component.dependencies) ? component.dependencies : []), ...(Array.isArray(component.depends_on) ? component.depends_on : [])])];
        const generatedConstraints = [...componentRows(component, 'generated_constraints'), ...componentRows(component, 'constraints')];
        const generatedObjectives = [...componentRows(component, 'generated_objective_terms'), ...componentRows(component, 'objective_terms')];
        const parameterBindings = componentRows(component, 'parameter_bindings');
        return (
          <Card
            key={`${name}-${index}`}
            title={name}
            extra={functionMappingType(component) ? (
              <Button type={component.function_asset_id ? 'default' : 'primary'} onClick={() => openFunctionMapping(index)}>
                {component.function_asset_id ? '编辑函数资产绑定' : '绑定函数资产'}
              </Button>
            ) : undefined}
          >
            <Descriptions size="small" column={3} items={[
              { key: 'constraints', label: '生成约束', children: generatedConstraints.length },
              { key: 'objectives', label: '生成目标项', children: generatedObjectives.length },
              { key: 'bindings', label: '参数绑定', children: parameterBindings.length },
            ]} />
            {Boolean(component.function_asset_id) && (
              <Descriptions className="section-gap" size="small" column={3} items={[
                { key: 'asset', label: '函数资产', children: String(component.function_asset_id) },
                { key: 'x', label: '输入 x', children: String(component.x || '-') },
                { key: 'y', label: functionMappingType(component) === 'piecewise_2d' ? '输入 y' : '输出 y', children: String(component.y || '-') },
                { key: 'strategy', label: '求解策略', children: String(component.solve_strategy || '-') },
              ]} />
            )}
            {generatedConstraints.length ? (
              <Table className="section-gap" size="small" pagination={false} rowKey={stableRowKey} dataSource={generatedConstraints} columns={[{ title: '约束', dataIndex: 'name' }, { title: '公式', render: (_, row) => <FormulaDisplay row={row} /> }]} />
            ) : <Typography.Paragraph className="component-output-empty" type="secondary">约束：0（当前组件未生成约束）</Typography.Paragraph>}
            {generatedObjectives.length ? (
              <Table className="section-gap" size="small" pagination={false} rowKey={stableRowKey} dataSource={generatedObjectives} columns={[{ title: '目标项', dataIndex: 'name' }, { title: '公式', render: (_, row) => <FormulaDisplay row={row} /> }]} />
            ) : <Typography.Paragraph className="component-output-empty" type="secondary">目标项：0（当前组件不生成目标项；目标函数由上方公式区维护。）</Typography.Paragraph>}
            {dependencies.length ? (
              <div className="component-dependency-state"><Typography.Text type="secondary">上游组件：</Typography.Text>{dependencies.map(item => <Tag key={String(item)}>{String(item)}</Tag>)}</div>
            ) : (
              <div className="component-dependency-state"><Tag>无上游组件依赖</Tag><Typography.Text type="secondary">该组件可独立装配。</Typography.Text></div>
            )}
            {parameterBindings.length ? (
              <>
                <Typography.Text type="secondary">参数绑定记录（组件参数 → 模型参数）</Typography.Text>
                <Table className="section-gap" size="small" pagination={false} rowKey={stableRowKey} dataSource={parameterBindings} columns={[{ title: '组件参数', dataIndex: 'component_parameter' }, { title: '模型参数', dataIndex: 'model_parameter', render: value => value || '—' }, { title: '状态', dataIndex: 'status', render: value => bindingStatusTag(value) }]} />
              </>
            ) : <Typography.Paragraph className="component-output-empty" type="secondary">参数绑定：0（当前组件没有需要绑定的参数）</Typography.Paragraph>}
          </Card>
        );
      }) : <Card><Alert type="warning" title="尚未选择组件" description="组件化 Builder 需要组件清单后才能展示生成约束、目标项、依赖和参数绑定。" /></Card>}
    </Space>
  );

  if (draft.basic_info.builder_mode !== 'generic_linear') return (
    <>
      <Alert
        className="compact-step-note"
        type="info"
        title={draft.basic_info.builder_mode === 'template_based' ? '模板数学展开' : '组件化数学展开'}
        description={draft.basic_info.builder_mode === 'template_based'
          ? '约束和目标项来自内置模板资产；可继续添加自定义公式或保存为新的草稿资产。'
          : '约束和目标项由已选组件生成；自定义公式仍通过统一公式编辑器维护。'}
      />
      <div className="model-section-anchor" data-section-key="mapping">
        <Space wrap className="section-gap">
          <Button onClick={() => setEditing(newFormula('constraint'))}>添加自定义公式</Button>
          <Button type="primary" onClick={() => openFunctionMapping()}>添加函数映射</Button>
          {nonlinearReport.relationships.some(item => item.nonlinear_type === 'bilinear' && !item.converted) && (
            <Button onClick={addMccormickFromDiagnostic}>一键生成 McCormick 组件</Button>
          )}
        </Space>
      </div>
      {nonlinearReport.count > 0 && (
        <Alert
          className="section-gap compact-step-note model-diagnostic-alert"
          type={nonlinearReport.has_blocking_nonlinearity ? 'error' : 'warning'}
          showIcon
          title="非线性转换建议"
          description={nonlinearSummary}
          action={<Popover title="转换建议明细" content={nonlinearDetails} trigger="click"><Button type="link" size="small">查看明细</Button></Popover>}
        />
      )}
      {formulaStatusGuide}
      {formulaBusinessCards(draft.formulas, setEditing, formulaVariableCodes)}
      <div className="model-section-anchor" data-section-key="compile">
        <FormulaManagementPanel
          formulas={draft.formulas}
          semantic={draft.semantic}
          symbols={symbols}
          compileContext={authoritativeContext}
          onEdit={setEditing}
          onChange={formulas => onChange({ ...draft, formulas, advanced: { ...draft.advanced, generic_spec: undefined } })}
        />
      </div>
      <div className="model-section-anchor" data-section-key="expansion">
        {draft.basic_info.builder_mode === 'component_based' ? renderComponentSummaryList() : (
          <Card size="small" className="section-gap" title="组件展开">
            <Typography.Text type="secondary">当前为模板模式，约束和目标项由模板直接展开，没有单独的组件生成审计表。</Typography.Text>
          </Card>
        )}
      </div>
      <div className="model-section-anchor" data-section-key="debug">
        <Collapse className="section-gap" items={[{ key: 'debug', label: '高级调试', children: renderComponentWorkbench() }]} />
      </div>
      <Modal
        width={720}
        open={mappingOpen}
        destroyOnHidden
        onCancel={() => {
          setMappingTargetIndex(null);
          setMappingOpen(false);
        }}
        title={mappingTargetIndex === null ? '添加函数映射' : '绑定函数资产'}
        footer={null}
      >
        <Form form={mappingForm} layout="vertical" onFinish={addFunctionMappingComponent}>
          <Form.Item name="function_asset_id" label="函数/曲线资产" rules={[{ required: true, message: '请选择函数/曲线资产' }]}>
            <Select
              loading={functionAssets.isLoading}
              showSearch
              optionFilterProp="label"
              optionLabelProp="labelText"
              filterOption={(input, option) => String(option?.labelText || '').toLowerCase().includes(input.toLowerCase())}
              options={matchingFunctionAssets.map(asset => ({
                value: asset.function_id,
                labelText: assetOptionLabel(asset),
                label: asset.validation_status === 'invalid'
                  ? <Tooltip title={`禁用原因：${invalidAssetReason(asset)}`}><span>{assetOptionLabel(asset)}</span></Tooltip>
                  : assetOptionLabel(asset),
                disabled: asset.validation_status === 'invalid' || isDisplayOnlyAsset(asset),
              }))}
              notFoundContent="暂无函数/曲线资产"
            />
          </Form.Item>
          <Descriptions size="small" column={1} items={[{ key: 'binary', label: '精确分段 MILP', children: '该策略需要二进制变量选择具体曲线分段，目前作为预留能力展示，暂不能发布为可求解模型。' }]} />
          {isDisplayOnlyAsset(selectedAsset) && (
            <Alert
              className="section-gap compact-step-note"
              type="warning"
              showIcon
              title="当前资产仅用于展示"
              description="该资产不能参与模型求解，请更换为 LP 凸组合或 MILP 分段资产。"
            />
          )}
          <Form.Item name="mapping_type" label="函数映射类型" rules={[{ required: true }]}>
            <Select
              disabled={mappingTargetIndex !== null}
              options={[
                { value: 'piecewise_1d', label: '一维函数映射 y = f(x)' },
                { value: 'piecewise_2d', label: '二维函数映射 z = f(x,y)' },
              ]}
              onChange={value => {
                if (value === 'piecewise_2d') mappingForm.setFieldValue('solve_strategy', 'triangulated_milp_exact');
                if (value === 'piecewise_1d') mappingForm.setFieldValue('solve_strategy', 'convex_combination_lp');
              }}
            />
          </Form.Item>
          <Alert
            className="section-gap compact-step-note function-mapping-strategy-alert"
            type="info"
            showIcon
            title="求解策略说明"
            description={(
              <div className="function-mapping-strategy-hints">
                <span><strong>convex_combination_lp</strong>：当前可求解，LP 凸组合近似</span>
                <span><strong>display_only</strong>：仅展示，不参与模型求解</span>
                <span><strong>binary_segment_milp</strong>：精确分段 MILP，当前暂不可发布</span>
              </div>
            )}
          />
          {selectedAsset?.function_type === 'piecewise_1d'
            && effectiveMappingType === 'piecewise_1d'
            && selectedStrategy === 'convex_combination_lp'
            && ['unknown', 'nonconvex'].includes(String(selectedConvexity || '')) && (
            <Alert
              className="section-gap compact-step-note"
              type="warning"
              showIcon
              title="曲线形态存在求解风险"
              description="当前选择凸组合 LP 策略，但曲线凸性未知或非凸，求解结果可能落在非相邻断点的组合上。需要严格贴合原始分段时，请先修正曲线形态或等待精确分段 MILP 能力。"
            />
          )}
          {selectedStrategy === 'convex_hull_lp_approx' && (
            <Alert
              className="section-gap compact-step-note"
              type="warning"
              showIcon
              title="convex_hull_lp_approx 非精确近似"
              description="该策略不是一般二维曲面的精确表达，只适用于凸包近似或特定凸/凹函数边界。"
            />
          )}
          <div className="function-mapping-section-heading">
            <span className="function-mapping-section-title">变量绑定</span>
            <span className="function-mapping-section-help">从左侧选择模型变量，再确认右侧表达式</span>
          </div>
          <Space className="function-mapping-field-row" style={{ width: '100%' }} size={12} align="start">
            <Form.Item style={{ flex: 1 }} name="x_pick" label="输入变量 x">
              <Select allowClear showSearch options={variableExpressionOptions(draft)} onChange={value => value && mappingForm.setFieldValue('x', value)} />
            </Form.Item>
            <Form.Item style={{ flex: 1 }} name="x" label="表达式 x" rules={[{ required: true, message: '请输入或选择输入变量 x' }]}>
              <Input placeholder="例如 volume[t]" />
            </Form.Item>
          </Space>
          <Space className="function-mapping-field-row" style={{ width: '100%' }} size={12} align="start">
            <Form.Item style={{ flex: 1 }} name="y_pick" label={effectiveMappingType === 'piecewise_2d' ? '输入变量选择 y' : '输出变量选择 y'}>
              <Select allowClear showSearch options={variableExpressionOptions(draft)} onChange={value => value && mappingForm.setFieldValue('y', value)} />
            </Form.Item>
            <Form.Item
              style={{ flex: 1 }}
              name="y"
              label={effectiveMappingType === 'piecewise_2d' ? '输入表达式 y' : '输出表达式 y'}
              rules={[
                { required: true, message: effectiveMappingType === 'piecewise_2d' ? '请输入或选择输入变量 y' : '请输入或选择输出变量 y' },
                {
                  validator: (_, value) => {
                    if (!value || hasSemanticVariable(draft, value)) return Promise.resolve();
                    const yVar = baseVariableName(value);
                    return Promise.reject(new Error(`${effectiveMappingType === 'piecewise_2d' ? '输入变量' : '输出变量'} ${yVar || value} 未在语义模型变量中定义，请先在 Step2 新增该变量，或选择已有变量。`));
                  },
                },
              ]}
            >
              <Input placeholder="例如 level[t]" />
            </Form.Item>
          </Space>
          {effectiveMappingType === 'piecewise_2d' && (
            <Space className="function-mapping-field-row" style={{ width: '100%' }} size={12} align="start">
              <Form.Item style={{ flex: 1 }} name="z_pick" label="输出变量 z">
                <Select allowClear showSearch options={variableExpressionOptions(draft)} onChange={value => value && mappingForm.setFieldValue('z', value)} />
              </Form.Item>
              <Form.Item
                style={{ flex: 1 }}
                name="z"
                label="表达式 z"
                rules={[
                  { required: true, message: '请选择输出变量 z' },
                  {
                    validator: (_, value) => {
                      if (!value || hasSemanticVariable(draft, value)) return Promise.resolve();
                      return Promise.reject(new Error(`输出变量 ${baseVariableName(value) || value} 未在 Step2 中定义，请先在语义模型中新增或选择已有变量。`));
                    },
                  },
                ]}
              >
                <Input placeholder="例如 power[t]" />
              </Form.Item>
            </Space>
          )}
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item style={{ flex: 1 }} name="index_set" label="索引集合">
              <Select allowClear options={setOptions(draft)} />
            </Form.Item>
            <Form.Item name="index_alias" label="索引别名">
              <Input style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="solve_strategy" label="求解策略" rules={[{ required: true }]}>
            <Select options={effectiveMappingType === 'piecewise_2d' ? [
              ...legacyDisplayOnlyStrategy,
              { value: 'triangulated_milp_exact', label: 'triangulated_milp_exact - MILP 精确三角剖分' },
              { value: 'convex_hull_lp_approx', label: 'convex_hull_lp_approx - LP 近似，非精确' },
            ] : [
              ...legacyDisplayOnlyStrategy,
              { value: 'convex_combination_lp', label: 'convex_combination_lp - LP 凸组合近似' },
              { value: 'binary_segment_milp', label: 'binary_segment_milp - 精确分段 MILP（预留，暂不可发布）' },
            ]} />
          </Form.Item>
          <Form.Item name="constraint_id" label="约束名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space>
            <Button onClick={() => {
              setMappingTargetIndex(null);
              setMappingOpen(false);
            }}>取消</Button>
            <Button type="primary" htmlType="submit">{mappingTargetIndex === null ? '添加' : '保存绑定'}</Button>
          </Space>
        </Form>
      </Modal>
      {formulaEditor}
    </>
  );

  return (
    <>
      {modalContextHolder}
      <Card className="section-gap" title="目标编译策略" size="small">
        <Space wrap align="start">
          <div>
            <Typography.Text type="secondary">目标模式</Typography.Text>
            <Select
              aria-label="目标模式"
              value={draft.objective?.mode || (draft.objective?.type === 'weighted_sum' ? 'weighted_sum' : 'single')}
              style={{ width: 160, display: 'block' }}
              options={[{ value: 'single', label: 'single 单目标' }, { value: 'weighted_sum', label: 'weighted_sum 加权和' }]}
              onChange={mode => onChange({ ...draft, objective: { ...(draft.objective || {}), mode, type: mode }, advanced: { ...draft.advanced, generic_spec: undefined } })}
            />
          </div>
          <div>
            <Typography.Text type="secondary">全局方向</Typography.Text>
            <Select
              aria-label="全局目标方向"
              value={draft.objective?.global_direction || (draft.objective?.sense === 'maximize' ? 'maximize' : 'minimize')}
              style={{ width: 160, display: 'block' }}
              options={[{ value: 'minimize', label: 'minimize' }, { value: 'maximize', label: 'maximize' }]}
              onChange={global_direction => onChange({ ...draft, objective: { ...(draft.objective || {}), global_direction, sense: global_direction }, advanced: { ...draft.advanced, generic_spec: undefined } })}
            />
          </div>
          <Alert
            type="info"
            showIcon
            title="方向归一化"
            description={draft.formulas.filter(item => item.kind === 'objective' && (item.solve_participation || 'solve_active') === 'solve_active').map(item => {
              const global = draft.objective?.global_direction || (draft.objective?.sense === 'maximize' ? 'maximize' : 'minimize');
              const sign = item.objective_direction === global ? 1 : -1;
              const mode = draft.objective?.mode || (draft.objective?.type === 'weighted_sum' ? 'weighted_sum' : 'single');
              const weight = mode === 'weighted_sum' ? item.weight : 1;
              return `${sign < 0 ? '-' : '+'}${String(weight ?? '未填')} × ${item.name}（${item.objective_direction || '方向未填'}）`;
            }).join('；') || '尚未配置参与求解的目标'}
          />
        </Space>
      </Card>
      <div className="model-section-anchor" data-section-key="mapping">
        <Space wrap>
          <Button type="primary" onClick={() => setEditing(newFormula('constraint'))}>新增约束公式</Button>
          <Button onClick={() => setEditing(newFormula('objective'))}>新增目标函数</Button>
          <Button onClick={() => { void compile(); }}>编译模型（后端权威）</Button>
          {nonlinearReport.relationships.some(item => item.nonlinear_type === 'bilinear' && !item.converted) && (
            <Button onClick={addMccormickFromDiagnostic}>一键生成 McCormick 组件</Button>
          )}
        </Space>
      </div>
      {nonlinearReport.count > 0 && (
        <Alert
          className="section-gap compact-step-note model-diagnostic-alert"
          type={nonlinearReport.has_blocking_nonlinearity ? 'error' : 'warning'}
          showIcon
          title="非线性转换建议"
          description={nonlinearSummary}
          action={<Popover title="转换建议明细" content={nonlinearDetails} trigger="click"><Button type="link" size="small">查看明细</Button></Popover>}
        />
      )}
      {compileError && <Alert className="section-gap compact-step-note" type="error" showIcon title="编译失败" description={compileError} />}
      {formulaStatusGuide}
      {formulaBusinessCards(draft.formulas, setEditing, formulaVariableCodes)}
      <div className="model-section-anchor" data-section-key="compile">
        <FormulaManagementPanel
          formulas={draft.formulas}
          semantic={draft.semantic}
          symbols={symbols}
          compileContext={authoritativeContext}
          onEdit={setEditing}
          onChange={formulas => onChange({ ...draft, formulas, advanced: { ...draft.advanced, generic_spec: undefined } })}
        />
      </div>
      <div className="model-section-anchor" data-section-key="expansion">
        <Card size="small" className="section-gap" title="组件展开">
          <Typography.Text type="secondary">当前为通用公式模式，数学结构直接由公式生成，没有单独的组件生成审计表。</Typography.Text>
        </Card>
      </div>
      <div className="model-section-anchor" data-section-key="debug">
        <Collapse
          className="section-gap"
          items={[{
            key: 'debug',
            label: '高级调试',
            children: (
              <>
                <div className="math-expansion-workbench section-gap">
                <Card className="component-list-panel" title="构件清单">
                  {draft.formulas.length ? draft.formulas.map(f => (
                    <button type="button" className={`component-list-item ${selectedComponentKey === f.formula_id ? 'active' : ''}`} key={f.formula_id} onClick={() => setSelectedComponentKey(f.formula_id)}>
                      <span><strong>{f.name}</strong><small>{f.kind === 'objective' ? '目标函数' : '自定义约束'}</small></span>
                      <Tag color={f.compile_status === 'ready' ? 'green' : 'orange'}>{f.compile_status === 'ready' ? '已配置' : '缺少配置'}</Tag>
                    </button>
                  )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未维护公式" />}
                </Card>
                <div className="component-config-panel">
                  <Card title="展开预览">
                    <Descriptions size="small" column={4} items={[
                      { key: 'variables', label: '变量', children: draft.semantic.variables.length },
                      { key: 'constraints', label: '约束公式', children: draft.formulas.filter(item => item.kind === 'constraint').length },
                      { key: 'objectives', label: '目标函数', children: draft.formulas.filter(item => item.kind === 'objective').length },
                      { key: 'compiled', label: '编译状态', children: draft.advanced.generic_spec ? <Tag color="green">已生成</Tag> : <Tag color="orange">待编译</Tag> },
                    ]} />
                  </Card>
                  <div className="formula-list section-gap">
                    {draft.formulas.length ? draft.formulas.map(f => (
                      <div className="formula-row" key={f.formula_id}>
                        <div>
                          <Space wrap><Tag color={f.kind === 'objective' ? 'purple' : 'blue'}>{f.kind === 'objective' ? '目标' : '约束'}</Tag><Typography.Text strong>{f.name}</Typography.Text><Tag color={f.compile_status === 'ready' ? 'green' : 'orange'}>{f.compile_status}</Tag></Space>
                          <FormulaDisplay row={f as unknown as Record<string, unknown>} />
                        </div>
                        <Button onClick={() => setEditing(f)}>编辑</Button>
                      </div>
                    )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未维护公式" />}
                  </div>
                </div>
              </div>
              {draft.advanced.generic_spec && <Card className="section-gap" title="generic_spec 预览"><JsonViewer value={draft.advanced.generic_spec} /></Card>}
            </>
          ),
        }]}
        />
      </div>
      {formulaEditor}
    </>
  );
}


