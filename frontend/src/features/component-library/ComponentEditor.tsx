import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, Form, Input, Row, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { useEffect, useState } from 'react';
import { FormulaBuilderModal } from '../formula-editor/FormulaBuilderModal';
import type { ComponentDef, SchemaItem } from '../../types/component';
import type { FormulaDef } from '../../types/formula';
import type { AuthoritativeCompileContext } from '../formula-editor/authoritativeCompilation';
import type { DictionaryItem, SystemDictionaries } from '../../types/systemConfig';
import { StatusTag } from '../../components/StatusTag';
import {
  analyzeComponentDependencyCandidate,
  getComponentDependencyIds,
  getComponentId,
} from '../../utils/componentDependencies';

type EditorProps = {
  component?: ComponentDef;
  availableComponents?: ComponentDef[];
  dictionaries?: SystemDictionaries;
  onSave: (value: Partial<ComponentDef>) => void;
};

type FormulaRow = Record<string, unknown>;

const LEGACY_ACTIVE_PARTICIPATION = new Set(['solve_active', 'solve', 'active', 'generated', 'template_builder']);
const indexAliases: Record<string, string> = { time: 't', time_volume: 't', state_time: 't', soc_time: 't', station: 's', unit: 'u', edge: 'e', scenario: 'sc' };

function rowsFrom(value: unknown): FormulaRow[] {
  return Array.isArray(value) ? value as FormulaRow[] : [];
}

function preferredRows(primary: unknown, legacy: unknown): FormulaRow[] {
  const primaryRows = rowsFrom(primary);
  return primaryRows.length ? primaryRows : rowsFrom(legacy);
}

export function normalizeFormulaParticipation(row?: FormulaRow): NonNullable<FormulaDef['solve_participation']> {
  const raw = String(row?.solve_participation || row?.participation || '').trim().toLowerCase();
  if (raw === 'disabled' || raw === 'none' || raw === 'inactive' || raw === 'off' || (!raw && row?.enabled === false)) return 'disabled';
  if (['preview_only', 'display_only', 'remark_only'].includes(raw) || (!raw && row?.participates_in_solve === false)) return 'preview_only';
  if (row?.enabled === false) return 'disabled';
  if (row?.participates_in_solve === false) return 'preview_only';
  return !raw || LEGACY_ACTIVE_PARTICIPATION.has(raw) ? 'solve_active' : 'preview_only';
}

export function normalizeFormulaRowForSave(row: FormulaRow): FormulaRow {
  const expression = String(row.dsl_formula || row.formula || row.expression || '').trim();
  const participation = normalizeFormulaParticipation(row);
  return {
    ...row,
    dsl_formula: expression,
    formula: expression,
    expression,
    solve_participation: participation,
    participates_in_solve: participation === 'solve_active',
    enabled: participation !== 'disabled',
  };
}

function normalizeBoundaryStrategy(value: unknown): NonNullable<FormulaDef['boundary_strategy']> {
  const raw = String(value || 'strict');
  if (raw === 'normal') return 'strict';
  if (raw === 'use_initial_value') return 'skip_first';
  if (raw === 'use_terminal_value') return 'skip_last';
  return ['strict', 'skip_first', 'skip_last', 'skip_out_of_range', 'explicit_subset'].includes(raw)
    ? raw as NonNullable<FormulaDef['boundary_strategy']>
    : 'strict';
}

function scopeFromRow(row?: FormulaRow) {
  const raw = Array.isArray(row?.scope) && row.scope.length ? row.scope : Array.isArray(row?.indices) ? row.indices : [];
  return raw.map(item => {
    if (typeof item === 'string') return { set: item, alias: indexAliases[item] || item };
    const value = item as Record<string, unknown>;
    const set = String(value.set || value.code || value.name || '');
    return { set, alias: String(value.alias || indexAliases[set] || set) };
  }).filter(item => item.set && item.alias);
}

export function componentFormulaCompileContext(
  sets: SchemaItem[] = [],
  parameters: SchemaItem[] = [],
  variables: SchemaItem[] = [],
): AuthoritativeCompileContext {
  const time = sets.find(item => item.type === 'time_period' || item.set_type === 'time_period' || item.code === 'time');
  const stateTime = sets.find(item => item.type === 'state_time' || item.set_type === 'state_time' || ['state_time', 'time_volume', 'soc_time'].includes(item.code));
  const timeSet = time?.code || 'time';
  const stateTimeSet = stateTime?.code;
  const setRows = sets.length ? sets : [{ code: timeSet, name: timeSet }];
  const setSymbols = Object.fromEntries(setRows.map(item => {
    const explicit = item.values?.length ? item.values : item.members?.length ? item.members : undefined;
    const values = explicit || (item.code === timeSet ? [0, 1] : item.code === stateTimeSet ? [0, 1, 2] : [0, 1]);
    return [item.code, { code: item.code, label: item.name || item.code, values }];
  }));
  if (!setSymbols[timeSet]) setSymbols[timeSet] = { code: timeSet, label: timeSet, values: [0, 1] };
  if (stateTimeSet && !setSymbols[stateTimeSet]) setSymbols[stateTimeSet] = { code: stateTimeSet, label: stateTimeSet, values: [0, 1, 2] };
  return {
    symbols: {
      sets: setSymbols,
      parameters: parameters.map(item => ({ code: item.code, label: item.name || item.code, dimension: item.dimension || item.indices || [], unit: item.unit })),
      variables: variables.map(item => ({ code: item.code, label: item.name || item.code, dimension: item.dimension || item.indices || [], unit: item.unit })),
    },
    model_context: {
      component_compile_sample_only: true,
      time_dimension: { time_set: timeSet, state_time_set: stateTimeSet || null },
    },
  };
}

export function normalizeComponentForEditor(component?: ComponentDef): Partial<ComponentDef> | undefined {
  if (!component) return undefined;
  const componentContract = { ...component };
  delete componentContract.parameter_bindings;
  delete componentContract.enabled;
  delete componentContract.implemented;
  const componentLabel = String(component.display_name || component.name || component.component_id || '组件');
  const withFormulaNames = (rows: FormulaRow[], kind: 'constraint' | 'objective') => rows.map((row, index) => {
    const code = String(row.constraint_id || row.term_id || row.code || `${kind}_${index + 1}`);
    const fallback = rows.length === 1 ? componentLabel : `${componentLabel} · ${code}`;
    return { ...row, name: String(row.name || fallback) };
  });
  const generatedConstraints = withFormulaNames(preferredRows(component.generated_constraints, component.constraints), 'constraint');
  const generatedObjectiveTerms = withFormulaNames(preferredRows(component.generated_objective_terms, component.objective_terms), 'objective');
  return {
    ...componentContract,
    required_sets: (component.required_sets?.length ? component.required_sets : rowsFrom(component.sets)) as SchemaItem[],
    parameters: (component.parameters?.length ? component.parameters : rowsFrom(component.inputs)) as SchemaItem[],
    variables: component.variables || [],
    generated_constraints: generatedConstraints,
    generated_objective_terms: generatedObjectiveTerms,
    depends_on: getComponentDependencyIds(component),
  };
}

function SchemaList({ name, title }: { name: 'required_sets' | 'parameters' | 'variables'; title: string }) {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {fields.map(field => (
            <Card
              key={field.key}
              size="small"
              title={`${title} #${field.name + 1}`}
              extra={<Button aria-label={`删除${title}`} danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
            >
              <Row gutter={12}>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'code']} label="编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'name']} label="名称" rules={[{ required: true, whitespace: true, message: `请输入${title}名称` }]}><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'unit']} label="单位"><Input /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={[field.name, 'dimension']} label="维度"><Select mode="tags" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={[field.name, 'source_system']} label="数据来源"><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'required']} label="必填" valuePropName="checked"><Switch /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'default']} label="默认值"><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={[field.name, 'sample_value']} label="示例值"><Input /></Form.Item></Col>
              </Row>
            </Card>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => add({ required: name !== 'variables' })}>新增{title}</Button>
        </Space>
      )}
    </Form.List>
  );
}

export function formulaFromRow(row: Record<string, unknown> | undefined, kind: 'constraint' | 'objective'): FormulaDef {
  const id = String(row?.constraint_id || row?.term_id || row?.name || crypto.randomUUID());
  const dsl = String(row?.dsl_formula || row?.formula || row?.expression || '');
  const solveParticipation = normalizeFormulaParticipation(row);
  const scope = scopeFromRow(row);
  const boundaryStrategy = normalizeBoundaryStrategy(row?.boundary_strategy);
  const rawDirection = String(row?.objective_direction || row?.direction || row?.sense || '').toLowerCase();
  const weight = Number(row?.weight);
  const priority = Number(row?.priority);
  const compileStatuses: FormulaDef['compile_status'][] = ['ready', 'error', 'unsupported', 'draft', 'stale', 'syntax_valid', 'semantic_valid', 'compile_valid', 'compile_failed', 'preview_only', 'disabled'];
  const compileStatus = compileStatuses.includes(row?.compile_status as FormulaDef['compile_status'])
    ? row?.compile_status as FormulaDef['compile_status']
    : dsl ? 'ready' : 'error';
  return {
    formula_id: id,
    name: String(row?.name || (kind === 'constraint' ? '新约束' : '目标项')),
    kind,
    solve_participation: solveParticipation,
    boundary_strategy: kind === 'constraint' ? boundaryStrategy : undefined,
    objective_direction: kind === 'objective' ? (['maximize', 'max'].includes(rawDirection) ? 'maximize' : 'minimize') : undefined,
    weight: kind === 'objective' ? (Number.isFinite(weight) ? weight : 1) : undefined,
    priority: kind === 'objective' && Number.isFinite(priority) ? priority : undefined,
    business_group: String(row?.business_group || ''),
    display_formula: String(row?.display_formula || row?.readable_formula || dsl),
    dsl_formula: dsl,
    tokens: Array.isArray(row?.tokens) ? row.tokens as FormulaDef['tokens'] : [],
    foreach: Array.isArray(row?.foreach) && row.foreach.every(item => typeof item === 'string') ? row.foreach as string[] : scope.map(item => item.set),
    scope,
    referenced_sets: Array.isArray(row?.referenced_sets) ? row.referenced_sets as string[] : [],
    referenced_parameters: Array.isArray(row?.referenced_parameters) ? row.referenced_parameters as string[] : [],
    referenced_variables: Array.isArray(row?.referenced_variables) ? row.referenced_variables as string[] : [],
    free_indices: Array.isArray(row?.free_indices) ? row.free_indices as string[] : scope.map(item => item.alias),
    compile_status: compileStatus,
    compile_error: row?.compile_error ? String(row.compile_error) : undefined,
    diagnostics: Array.isArray(row?.diagnostics) ? row.diagnostics as FormulaDef['diagnostics'] : undefined,
    ast_version: row?.ast_version ? String(row.ast_version) : undefined,
    compiler_version: row?.compiler_version ? String(row.compiler_version) : undefined,
    authoritative_artifact: row?.authoritative_artifact as FormulaDef['authoritative_artifact'],
  };
}

function symbolsFromSchema(sets?: SchemaItem[], parameters?: SchemaItem[], variables?: SchemaItem[]) {
  return {
    sets: Object.fromEntries((sets || []).map(item => [item.code, item.name || item.code])),
    parameters: Object.fromEntries((parameters || []).map(item => [item.code, { label: item.name || item.code, indices: item.dimension, unit: item.unit }])),
    variables: Object.fromEntries((variables || []).map(item => [item.code, { label: item.name || item.code, indices: item.dimension, unit: item.unit }])),
  };
}

function dictionaryOptions(items?: DictionaryItem[], current?: unknown) {
  const values = new Map<string, string>();
  (items || []).filter(item => item.enabled !== false).forEach(item => values.set(item.label, item.label));
  const currentText = String(current || '').trim();
  if (currentText && !values.has(currentText)) values.set(currentText, currentText);
  return [...values.entries()].map(([value, label]) => ({ value, label }));
}

function domainCodeFromLabel(items: DictionaryItem[] | undefined, label: unknown) {
  const text = String(label || '').trim();
  return (items || []).find(item => item.label === text || item.code === text)?.code || '';
}

function FormulaList({ name, title, form, component }: { name: 'generated_constraints' | 'generated_objective_terms'; title: string; form: FormInstance<Partial<ComponentDef>>; component?: ComponentDef }) {
  const kind = name === 'generated_constraints' ? 'constraint' : 'objective';
  const watchOptions = { form, preserve: true };
  const rows = Form.useWatch(name, watchOptions) as Array<Record<string, unknown>> | undefined;
  const sets = (Form.useWatch('required_sets', watchOptions) as SchemaItem[] | undefined) || component?.required_sets;
  const parameters = (Form.useWatch('parameters', watchOptions) as SchemaItem[] | undefined) || component?.parameters;
  const variables = (Form.useWatch('variables', watchOptions) as SchemaItem[] | undefined) || component?.variables;
  const symbols = symbolsFromSchema(sets, parameters, variables);
  const compileContext = componentFormulaCompileContext(sets || [], parameters || [], variables || []);
  const [editing, setEditing] = useState<{ index: number; formula: FormulaDef }>();
  const currentRows = rows || [];
  const setRows = (next: Array<Record<string, unknown>>) => form.setFieldValue(name, next);
  const updateFormula = (index: number, formula: FormulaDef) => {
    const next = [...currentRows];
    next[index] = {
      ...(next[index] || {}),
      name: formula.name,
      constraint_id: kind === 'constraint' ? formula.formula_id : undefined,
      term_id: kind === 'objective' ? formula.formula_id : undefined,
      formula: formula.dsl_formula,
      dsl_formula: formula.dsl_formula,
      expression: formula.dsl_formula,
      display_formula: formula.display_formula,
      readable_formula: formula.display_formula,
      tokens: formula.tokens,
      foreach: formula.foreach,
      indices: formula.foreach,
      scope: formula.scope,
      solve_participation: formula.solve_participation,
      participates_in_solve: formula.solve_participation === 'solve_active',
      enabled: formula.solve_participation !== 'disabled',
      boundary_strategy: formula.boundary_strategy,
      objective_direction: formula.objective_direction,
      direction: formula.objective_direction,
      weight: formula.weight,
      priority: formula.priority,
      business_group: formula.business_group,
      referenced_sets: formula.referenced_sets,
      referenced_parameters: formula.referenced_parameters,
      referenced_variables: formula.referenced_variables,
      free_indices: formula.free_indices,
      compile_status: formula.compile_status,
      compile_error: formula.compile_error,
      diagnostics: formula.diagnostics,
      ast_version: formula.ast_version,
      compiler_version: formula.compiler_version,
      authoritative_artifact: formula.authoritative_artifact,
    };
    setRows(next);
  };
  const addFormula = () => {
    const nextIndex = currentRows.length;
    const draft = {
      ...formulaFromRow(undefined, kind),
      formula_id: `${kind === 'constraint' ? 'constraint' : 'objective'}_${nextIndex + 1}`,
    };
    setRows([...currentRows, {
      name: draft.name,
      constraint_id: draft.formula_id,
      term_id: draft.formula_id,
      solve_participation: 'solve_active',
      participates_in_solve: true,
      enabled: true,
      boundary_strategy: kind === 'constraint' ? 'strict' : undefined,
      objective_direction: draft.objective_direction,
      weight: draft.weight,
      formula: '',
      dsl_formula: '',
      display_formula: '',
      tokens: [],
      foreach: [],
      indices: [],
      compile_status: 'error',
    }]);
    setEditing({ index: nextIndex, formula: draft });
  };
  const copyFormula = (index: number) => {
    const source = currentRows[index] || {};
    const clone = {
      ...source,
      constraint_id: `${String(source.constraint_id || source.term_id || 'formula')}_copy`,
      term_id: `${String(source.term_id || source.constraint_id || 'formula')}_copy`,
      name: `${String(source.name || title)} 副本`,
    };
    setRows([...currentRows, clone]);
  };
  const removeFormula = (index: number) => setRows(currentRows.filter((_, itemIndex) => itemIndex !== index));
  const table = currentRows.length ? (
    <Table
      className="component-formula-table"
      size="small"
      pagination={false}
      tableLayout="fixed"
      scroll={{ x: 820 }}
      rowKey={row => String(row.constraint_id || row.term_id || row.name || row.formula)}
      dataSource={currentRows}
      columns={[
        { title: '名称', dataIndex: 'name', width: 140, ellipsis: true },
        { title: '编码', width: 170, ellipsis: true, render: (_, row) => String(row.constraint_id || row.term_id || '-') },
        { title: '类型', width: 82, render: () => <Tag color={kind === 'constraint' ? 'blue' : 'purple'}>{kind === 'constraint' ? '约束' : '目标'}</Tag> },
        { title: '公式', width: 210, ellipsis: true, render: (_, row) => String(row.display_formula || row.readable_formula || row.dsl_formula || row.formula || row.expression || '-') },
        {
          title: '求解',
          width: 92,
          render: (_, row) => {
            const participation = String(row.solve_participation || 'solve_active');
            return participation === 'disabled' ? '停用' : ['preview_only', 'display_only'].includes(participation) ? '仅预览' : '参与';
          },
        },
        {
          title: '状态',
          width: 86,
          render: (_, row) => {
            const hasExpression = Boolean(String(row.dsl_formula || row.formula || row.expression || '').trim());
            return <Tag color={hasExpression ? 'green' : 'orange'}>{hasExpression ? '已配置' : '待配置'}</Tag>;
          },
        },
        {
          title: '操作',
          fixed: 'right' as const,
          width: 140,
          render: (_, _row, index) => (
            <Space size={4}>
              <Button type="link" onClick={() => setEditing({ index, formula: formulaFromRow(currentRows[index], kind) })}>编辑</Button>
              <Button type="link" onClick={() => copyFormula(index)}>复制</Button>
              <Button danger type="link" onClick={() => removeFormula(index)}>删除</Button>
            </Space>
          ),
        },
      ]}
    />
  ) : (
    <div className="component-formula-empty">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无${title}`} />
    </div>
  );
  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      {table}
      <Button icon={<PlusOutlined />} onClick={addFormula}>新增{title}</Button>
      <FormulaBuilderModal
        open={!!editing}
        value={editing?.formula}
        symbols={symbols}
        compileContext={compileContext}
        lockedKind={kind}
        onApply={formula => {
          if (editing) updateFormula(editing.index, formula);
          setEditing(undefined);
        }}
        onCancel={() => setEditing(undefined)}
        onDelete={formulaId => {
          const latestRows = rowsFrom(form.getFieldValue(name));
          const nextRows = latestRows.filter((row, index) => {
            const rowId = String(row.constraint_id || row.term_id || row.name || '');
            return rowId !== formulaId && index !== editing?.index;
          });
          setRows(nextRows);
          setEditing(undefined);
        }}
      />
    </Space>
  );
}

function DependencyEditor({
  form,
  component,
  availableComponents = [],
}: {
  form: FormInstance<Partial<ComponentDef>>;
  component?: ComponentDef;
  availableComponents?: ComponentDef[];
}) {
  const watchOptions = { form, preserve: true };
  const deps = getComponentDependencyIds({
    depends_on: (Form.useWatch('depends_on', watchOptions) as string[] | undefined) || [],
  });
  const currentId = String(Form.useWatch('component_id', watchOptions) || component?.component_id || '');
  const availableIds = availableComponents.map(getComponentId);
  const normalizedAvailable = availableIds.filter(id => id !== currentId);
  const candidate = {
    ...(component || {}),
    component_id: currentId,
    type: currentId,
    enabled: true,
    depends_on: deps,
    dependencies: deps,
  };
  const { missing, unavailable, selfDependency, cycles } = analyzeComponentDependencyCandidate(candidate, availableComponents);
  const saveBlockingDescriptions = [
    ...(missing.length ? [`缺失依赖：${missing.join('、')}`] : []),
    ...(selfDependency ? ['组件不能依赖自身'] : []),
    ...cycles.map(cycle => `循环依赖：${cycle.join(' → ')}`),
  ];
  const errorDescriptions = [
    ...saveBlockingDescriptions,
    ...(unavailable.length ? [`尚未发布或已停用：${unavailable.join('、')}`] : []),
  ];
  const blocksPublish = errorDescriptions.length > 0;
  const invalidDependencies = new Set([
    ...missing,
    ...unavailable,
    ...(selfDependency ? [currentId] : []),
    ...cycles.flatMap(cycle => cycle),
  ]);
  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Form.Item
        name="depends_on"
        label="依赖组件编码"
        rules={[{
          validator: async () => {
            if (saveBlockingDescriptions.length) throw new Error(saveBlockingDescriptions.join('；'));
          },
        }]}
      >
        <Select
          mode="multiple"
          showSearch
          optionFilterProp="label"
          placeholder="选择一个或多个已登记组件"
          options={normalizedAvailable.map(id => ({ value: id, label: id }))}
        />
      </Form.Item>
      <Alert
        className={blocksPublish ? undefined : 'compact-notice component-dependency-status'}
        showIcon
        type={blocksPublish ? 'error' : 'success'}
        title={blocksPublish ? '依赖异常将阻止发布' : '依赖校验通过'}
        description={blocksPublish ? errorDescriptions.join('；') : '依赖均存在，无自依赖或循环依赖。'}
      />
      <div className="dependency-list">
        {deps.length ? deps.map(dep => (
          <div className="dependency-row" key={dep}>
            <span>{dep}</span>
            <Tag color={invalidDependencies.has(dep) ? 'red' : 'green'}>
              {invalidDependencies.has(dep) ? '异常' : '可用'}
            </Tag>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无上游组件依赖" />}
      </div>
      <Typography.Text type={blocksPublish ? 'danger' : 'secondary'}>
        发布阻断：{blocksPublish ? '是' : '否'}
      </Typography.Text>
    </Space>
  );
}

export function ComponentEditor({ component, availableComponents = [], dictionaries, onSave }: EditorProps) {
  const [form] = Form.useForm<Partial<ComponentDef>>();
  const [activeSection, setActiveSection] = useState('basic');
  const normalizedComponent = normalizeComponentForEditor(component);
  useEffect(() => {
    form.resetFields();
    if (normalizedComponent) form.setFieldsValue(normalizedComponent);
  }, [component?.component_id, component, form]);
  const watchOptions = { form, preserve: true };
  const selectedDomain = Form.useWatch('domain', watchOptions) || component?.domain;
  const selectedCategory = Form.useWatch('category', watchOptions) || component?.category;
  const selectedDomainCode = domainCodeFromLabel(dictionaries?.component_domains, selectedDomain);
  const domainOptions = dictionaryOptions(dictionaries?.component_domains, component?.domain);
  const categoryOptions = dictionaryOptions(
    selectedDomainCode
      ? (dictionaries?.component_categories || []).filter(item => !item.parent_code || item.parent_code === selectedDomainCode)
      : dictionaries?.component_categories,
    selectedCategory,
  );
  const handleSave = (value: Partial<ComponentDef>) => {
    const componentContract = { ...value };
    delete componentContract.parameter_bindings;
    delete componentContract.status;
    delete componentContract.enabled;
    delete componentContract.implemented;
    const deps = getComponentDependencyIds(componentContract as Record<string, unknown>);
    const generatedConstraints = rowsFrom(componentContract.generated_constraints).map(row => ({
      ...normalizeFormulaRowForSave(row),
      boundary_strategy: normalizeBoundaryStrategy(row.boundary_strategy),
    }));
    const generatedObjectiveTerms = rowsFrom(componentContract.generated_objective_terms).map(normalizeFormulaRowForSave);
    const currentId = String(componentContract.component_id || component?.component_id || '');
    const candidate = {
      ...componentContract,
      component_id: currentId,
      type: currentId,
      enabled: true,
      depends_on: deps,
      dependencies: deps,
    };
    const { missing, unavailable, selfDependency, cycles } = analyzeComponentDependencyCandidate(candidate, availableComponents);
    const dependencyErrors = [
      ...missing.map(dep => ({ field: 'depends_on', message: `依赖组件 ${dep} 不存在` })),
      ...unavailable.map(dep => ({ field: 'depends_on', message: `依赖组件 ${dep} 尚未发布或已停用` })),
      ...(selfDependency ? [{ field: 'depends_on', message: '组件不能依赖自身' }] : []),
      ...cycles.map(cycle => ({ field: 'depends_on', message: `组件存在循环依赖：${cycle.join(' → ')}` })),
    ];
    onSave({
      ...componentContract,
      constraints: generatedConstraints,
      generated_constraints: generatedConstraints,
      objective_terms: generatedObjectiveTerms,
      generated_objective_terms: generatedObjectiveTerms,
      depends_on: deps,
      dependencies: deps,
      validation_result: {
        valid: dependencyErrors.length === 0,
        errors: dependencyErrors,
      },
    });
  };
  const sections = [
    {
      key: 'basic',
      label: '基础信息',
      children: (
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="name" label="组件名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="display_name" label="展示名称"><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="component_id" label="组件编码" rules={[{ required: true }]}><Input disabled={!!component} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="version" label="版本"><Input /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="category" label="分类"><Select showSearch options={categoryOptions} placeholder="选择分类" /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="domain" label="领域"><Select showSearch options={domainOptions} placeholder="选择领域" onChange={() => form.setFieldValue('category', undefined)} /></Form.Item></Col>
          <Col xs={24} md={8}>
            <Form.Item
              label="生命周期状态"
              tooltip="生命周期由保存草稿、发布和停用操作自动维护，不能在编辑器中直接修改。"
            >
              <Space size={8}>
                <StatusTag status={component?.status || 'draft'} />
                <Typography.Text type="secondary">由系统维护</Typography.Text>
              </Space>
            </Form.Item>
          </Col>
           <Col span={24}><Form.Item name="description" label="组件说明"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item></Col>
        </Row>
      ),
    },
    { key: 'sets', label: '集合配置', children: <SchemaList name="required_sets" title="集合" /> },
    { key: 'params', label: '参数接口', children: <SchemaList name="parameters" title="参数接口" /> },
    { key: 'vars', label: '变量配置', children: <SchemaList name="variables" title="变量" /> },
    { key: 'constraints', label: '约束公式', children: <FormulaList form={form} component={component} name="generated_constraints" title="约束公式" /> },
    { key: 'objective', label: '目标项', children: <FormulaList form={form} component={component} name="generated_objective_terms" title="目标项" /> },
    {
      key: 'dependencies',
      label: '依赖关系',
      children: (
        <DependencyEditor
          form={form}
          component={component}
          availableComponents={availableComponents}
        />
      ),
    },
  ];
  const currentSection = sections.find(section => section.key === activeSection) || sections[0];
  return (
    <Form id="component-editor-form" form={form} layout="vertical" initialValues={normalizedComponent || { version: '1.0.0' }} onFinish={handleSave}>
      <div className="component-editor-layout">
        <nav className="component-editor-nav" aria-label="组件编辑分区">
          {sections.map(section => (
            <button
              type="button"
              key={section.key}
              className={section.key === currentSection.key ? 'active' : ''}
              onClick={() => setActiveSection(section.key)}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <section className="component-editor-body">
          <div className="component-editor-section-head">
            <Typography.Title level={5}>{currentSection.label}</Typography.Title>
          </div>
          {currentSection.children}
        </section>
      </div>
    </Form>
  );
}
