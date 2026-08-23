import { Alert, Button, Collapse, Empty, Form, Input, InputNumber, Modal, Radio, Select, Space, Tabs, Tag, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormulaCompileResult, FormulaDef } from '../../types/formula';
import { JsonViewer } from '../../components/JsonViewer';
import { collectReferences, renderFormulaReadable, tokensToDisplay } from './formulaDsl';
import { getFormulaSymbolDictionary } from './formulaDictionary';
import { parseFormulaDsl, type FormulaSymbols } from './formulaParser';
import { validateFormula } from './formulaValidator';
import { analyzeFormulaText } from '../model-creation/utils/nonlinearDiagnostics';
import { FormulaCodeEditor, type FormulaCodeEditorHandle } from './FormulaCodeEditor';
import { artifactFromResult, authoritativeArtifactState, compileFormulaAuthoritatively, isAuthoritativeArtifactCurrent, type AuthoritativeCompileContext } from './authoritativeCompilation';
import { markFormulaCompiled, withCurrentFormulaVersion } from './formulaVersioning';

const now = () => new Date().toISOString();

const operatorTokens = ['+', '-', '×', '÷', '>=', '<=', '==', '(', ')', '[', ']', ','];
const operatorInsertText: Record<string, string> = { '×': '*', '÷': '/' };
const functionTemplates = [
  { name: '求和', syntax: 'sum(value for i in set)', selection: { start: 4, end: 9 } },
  { name: '最小值', syntax: 'min(value for i in set)', selection: { start: 4, end: 9 } },
  { name: '最大值', syntax: 'max(value for i in set)', selection: { start: 4, end: 9 } },
  { name: '绝对值', syntax: 'abs(value)', selection: { start: 4, end: 9 } },
  { name: '自然对数（非线性）', syntax: 'log(value)', selection: { start: 4, end: 9 } },
  { name: '指数（非线性）', syntax: 'exp(value)', selection: { start: 4, end: 9 } },
  { name: '平方根（非线性）', syntax: 'sqrt(value)', selection: { start: 5, end: 10 } },
  { name: '分段函数', syntax: 'piecewise(x, curve_id)', selection: { start: 10, end: 11 } },
];

const newFormula = (kind: 'constraint' | 'objective'): FormulaDef => ({
  formula_id: crypto.randomUUID(),
  name: kind === 'constraint' ? '新约束' : '目标函数',
  kind,
  solve_participation: 'solve_active',
  boundary_strategy: kind === 'constraint' ? 'strict' : undefined,
  objective_direction: kind === 'objective' ? 'minimize' : undefined,
  weight: kind === 'objective' ? 1 : undefined,
  display_formula: '',
  dsl_formula: '',
  tokens: [],
  foreach: [],
  referenced_sets: [],
  referenced_parameters: [],
  referenced_variables: [],
  free_indices: [],
  compile_status: 'error',
  created_at: now(),
  updated_at: now(),
});

function mergeFormula(base: FormulaDef, dsl: string, symbols: FormulaSymbols): FormulaDef {
  const tokens = parseFormulaDsl(dsl, symbols);
  const refs = collectReferences(tokens);
  const foreach = base.foreach.length ? base.foreach : refs.free_indices;
  const check = validateFormula(dsl, base.kind, tokens, symbols, foreach);
  return {
    ...base,
    dsl_formula: dsl,
    display_formula: tokensToDisplay(tokens) || dsl,
    tokens,
    foreach,
    referenced_sets: refs.referenced_sets,
    referenced_parameters: refs.referenced_parameters,
    referenced_variables: refs.referenced_variables,
    free_indices: refs.free_indices,
    compile_status: check.valid ? 'ready' : 'error',
    compile_error: check.errors.join('；') || undefined,
    updated_at: now(),
  };
}

function hydrateFormula(base: FormulaDef, symbols: FormulaSymbols, lockedKind?: FormulaDef['kind']) {
  const legacyBoundary = base.boundary_strategy as string | undefined;
  const boundary_strategy = legacyBoundary === 'normal'
    ? 'strict'
    : legacyBoundary === 'use_initial_value'
      ? 'skip_first'
      : legacyBoundary === 'use_terminal_value'
        ? 'skip_last'
        : base.boundary_strategy || ((lockedKind || base.kind) === 'constraint' ? 'strict' : undefined);
  const hydrated = mergeFormula({ ...base, boundary_strategy, kind: lockedKind || base.kind }, base.dsl_formula, symbols);
  return {
    ...hydrated,
    compile_status: base.compile_status,
    compile_error: base.compile_error,
    authoritative_artifact: base.authoritative_artifact,
    compiler_version: base.compiler_version,
    ast_version: base.ast_version,
    diagnostics: base.diagnostics,
  };
}

function symbolExpression(item: ReturnType<typeof getFormulaSymbolDictionary>[number]) {
  if (item.type === 'set') return item.code;
  const aliases = item.indices?.length ? `[${item.indices.join(',')}]` : '';
  return `${item.code}${aliases}`;
}

function editableSnapshot(formula: FormulaDef) {
  return JSON.stringify({
    formula_id: formula.formula_id,
    name: formula.name,
    kind: formula.kind,
    expression: formula.dsl_formula,
    participation: formula.solve_participation,
    boundary_strategy: formula.boundary_strategy,
    direction: formula.objective_direction,
    weight: formula.weight,
    priority: formula.priority,
    group: formula.business_group,
    scope: formula.scope,
  });
}

export function FormulaBuilder({
  value,
  symbols = {},
  onApply,
  onCancel,
  onDelete,
  compileContext,
  lockedKind,
}: {
  value?: FormulaDef;
  symbols?: FormulaSymbols;
  onApply?: (formula: FormulaDef) => void;
  onCancel?: () => void;
  onDelete?: (formulaId: string) => void;
  compileContext?: AuthoritativeCompileContext;
  lockedKind?: FormulaDef['kind'];
}) {
  const initialRef = useRef<FormulaDef | null>(null);
  if (!initialRef.current) {
    const initial = value || newFormula(lockedKind || 'constraint');
    initialRef.current = hydrateFormula(initial, symbols, lockedKind);
  }
  const [formula, setFormula] = useState<FormulaDef>(initialRef.current);
  const [baseline, setBaseline] = useState(() => editableSnapshot(initialRef.current!));
  const [keyword, setKeyword] = useState('');
  const [authoritative, setAuthoritative] = useState<FormulaCompileResult>();
  const [compiling, setCompiling] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [closeIntent, setCloseIntent] = useState(false);
  const [deleteIntent, setDeleteIntent] = useState(false);
  const inputRef = useRef<FormulaCodeEditorHandle>(null);
  const baseCompileContext: AuthoritativeCompileContext = compileContext || {
    symbols: {
      sets: Object.fromEntries(Object.keys(symbols.sets || {}).map(code => [code, { values: [] }])),
      parameters: Object.entries(symbols.parameters || {}).map(([code, meta]) => ({ code, ...meta, dimension: meta.indices || [] })),
      variables: Object.entries(symbols.variables || {}).map(([code, meta]) => ({ code, ...meta, dimension: meta.indices || [] })),
    },
  };
  const effectiveCompileContext: AuthoritativeCompileContext = {
    ...baseCompileContext,
    model_context: {
      ...(baseCompileContext.model_context || {}),
      boundary_strategy: formula.boundary_strategy || 'strict',
    },
  };

  useEffect(() => {
    const seed = value || newFormula(lockedKind || 'constraint');
    const next = hydrateFormula(seed, symbols, lockedKind);
    setFormula(next);
    setBaseline(editableSnapshot(next));
  }, [value, lockedKind]);

  const dirty = editableSnapshot(formula) !== baseline;

  const dictionary = useMemo(() => getFormulaSymbolDictionary({ symbols }), [symbols]);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedKeyword) return dictionary;
    return dictionary.filter(item => `${item.code} ${item.name} ${item.typeLabel}`.toLowerCase().includes(normalizedKeyword));
  }, [dictionary, normalizedKeyword]);
  const filteredFunctions = useMemo(
    () => normalizedKeyword
      ? functionTemplates.filter(item => `${item.name} ${item.syntax}`.toLowerCase().includes(normalizedKeyword))
      : functionTemplates,
    [normalizedKeyword],
  );
  const filteredOperators = normalizedKeyword
    ? operatorTokens.filter(item => item.includes(normalizedKeyword))
    : operatorTokens;
  const check = useMemo(
    () => validateFormula(formula.dsl_formula, formula.kind, formula.tokens, symbols, formula.foreach),
    [formula, symbols],
  );
  const nonlinearDiagnostics = useMemo(
    () => analyzeFormulaText(formula.dsl_formula, Object.keys(symbols.variables || {}), 'formula_builder'),
    [formula.dsl_formula, symbols],
  );

  const commit = (next: FormulaDef) => {
    setAuthoritative(undefined);
    const merged = mergeFormula(next, next.dsl_formula, symbols);
    const participation = merged.solve_participation || 'solve_active';
    setFormula(withCurrentFormulaVersion({
      ...merged,
      compile_status: participation === 'solve_active' ? (formula.authoritative_artifact ? 'stale' : 'draft') : participation,
      authoritative_artifact: undefined,
      compiler_version: undefined,
    }));
  };

  const updateDsl = (dsl: string) => {
    setAuthoritative(undefined);
    setFormula(current => {
      const merged = mergeFormula(current, dsl, symbols);
      const participation = merged.solve_participation || 'solve_active';
      return withCurrentFormulaVersion({
        ...merged,
        compile_status: participation === 'solve_active' ? (current.authoritative_artifact ? 'stale' : 'draft') : participation,
        authoritative_artifact: undefined,
        compiler_version: undefined,
      });
    });
  };

  const runAuthoritativeCompile = async () => {
    setCompiling(true);
    try {
      const { result } = await compileFormulaAuthoritatively(formula, effectiveCompileContext);
      setAuthoritative(result);
      setFormula(current => {
        const compiled = { ...current, scope: result.scope };
        const artifact = artifactFromResult(compiled, effectiveCompileContext, result);
        return markFormulaCompiled({
          ...compiled,
          ast_version: result.ast_version,
          compiler_version: result.compiler_version,
          diagnostics: result.diagnostics,
          compile_status: result.status,
          compile_error: result.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('；') || undefined,
          authoritative_artifact: artifact,
        }, artifact);
      });
    } catch (error) {
      setAuthoritative({
        success: false,
        ast_version: '1.0',
        normalized_expression: formula.dsl_formula,
        expression_class: 'unsupported',
        diagnostics: [{ code: 'FORMULA_BACKEND_UNAVAILABLE', severity: 'error', stage: 'compile', message: error instanceof Error ? error.message : '后端权威编译服务不可用', start: 0, end: formula.dsl_formula.length, fixHint: '确认后端服务已启动后重试。' }],
        references: [], scope: formula.scope || [], participation: formula.solve_participation === 'disabled' ? 'preview_only' : formula.solve_participation || 'solve_active', estimated_expansion: { constraint_count: 0, term_count: 0, exact: false }, status: 'compile_failed', checks: { syntax: 'not_run', symbol_dimension_unit: 'not_run', classification: 'unsupported', compile: 'failed' },
      });
    } finally {
      setCompiling(false);
    }
  };

  const insertText = (text: string) => {
    inputRef.current?.insert(text);
  };

  const symbolList = (type: 'set' | 'variable' | 'parameter') => {
    const items = filtered.filter(item => item.type === type);
    if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配项" />;
    return (
      <div className="formula-tag-cloud">
        {items.map(item => (
        <button
          type="button"
          className={`formula-insert-tag is-${item.type}`}
          key={`${item.type}-${item.code}`}
          title={`插入 ${item.name}（${symbolExpression(item)}）`}
          onClick={() => insertText(symbolExpression(item))}
        >
          <span className="formula-insert-tag-name">{item.name}</span>
          <code>{symbolExpression(item)}</code>
          {item.unit && <span className="formula-insert-tag-unit">{item.unit}</span>}
        </button>
        ))}
      </div>
    );
  };

  const participation = formula.solve_participation || 'solve_active';
  const authoritativeCurrent = isAuthoritativeArtifactCurrent(formula, effectiveCompileContext);
  const formulaCode = formula.formula_id.trim();
  const formulaName = formula.name.trim();
  const formulaCodeValid = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(formulaCode);
  const canApply = Boolean(formulaName) && formulaCodeValid && check.valid && Boolean(formula.dsl_formula.trim()) && (participation !== 'solve_active' || authoritativeCurrent);

  const requestClose = () => {
    if (!dirty) {
      onCancel?.();
      return;
    }
    setCloseIntent(true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (focusMode) setFocusMode(false);
      else requestClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <div className={`formula-builder${focusMode ? ' is-focus-mode' : ''}`}>
      <div className="formula-builder-head">
        <div className="formula-builder-details">
          <div className="formula-builder-meta-grid">
            <Form.Item label="公式名称" required validateStatus={formulaName ? undefined : 'error'} help={formulaName ? undefined : '请输入便于业务理解的公式名称'}>
              <Input value={formula.name} onChange={event => commit({ ...formula, name: event.target.value })} />
            </Form.Item>
            <Form.Item
              label="公式编码"
              required
              validateStatus={formulaCodeValid ? undefined : 'error'}
              help={formulaCodeValid ? '新建时自动生成，可按需修改' : '请输入由字母、数字、下划线、点或连字符组成的唯一编码'}
            >
              <Input aria-label="公式编码" value={formula.formula_id} onChange={event => commit({ ...formula, formula_id: event.target.value })} />
            </Form.Item>
            <Form.Item label="业务分组">
              <Input aria-label="业务分组" placeholder="例如：状态递推" value={formula.business_group} onChange={event => commit({ ...formula, business_group: event.target.value })} />
            </Form.Item>
          </div>

          <div className="formula-builder-config-row">
            <div className="formula-builder-config-item">
              <Typography.Text type="secondary">公式类型</Typography.Text>
              {lockedKind ? (
                <Tag color={lockedKind === 'constraint' ? 'blue' : 'purple'}>
                  {lockedKind === 'constraint' ? '约束' : '目标函数'}
                </Tag>
              ) : (
                <Radio.Group
                  value={formula.kind}
                  onChange={event => commit({ ...formula, kind: event.target.value })}
                  options={[{ value: 'constraint', label: '约束' }, { value: 'objective', label: '目标函数' }]}
                />
              )}
            </div>
            {formula.kind === 'objective' && (
              <>
                <div className="formula-builder-config-item">
                  <Typography.Text type="secondary">优化方向</Typography.Text>
                  <Radio.Group
                    value={formula.objective_direction}
                    onChange={event => commit({ ...formula, objective_direction: event.target.value })}
                    options={[{ value: 'minimize', label: '最小化' }, { value: 'maximize', label: '最大化' }]}
                  />
                </div>
                <div className="formula-builder-config-item">
                  <Typography.Text type="secondary">权重</Typography.Text>
                  <InputNumber aria-label="目标权重" value={formula.weight} onChange={value => commit({ ...formula, weight: value === null ? undefined : value })} />
                </div>
                <div className="formula-builder-config-item">
                  <Typography.Text type="secondary">优先级</Typography.Text>
                  <InputNumber aria-label="目标优先级" min={1} precision={0} value={formula.priority} onChange={value => commit({ ...formula, priority: value === null ? undefined : value })} />
                </div>
              </>
            )}
            {formula.kind === 'constraint' && (
              <div className="formula-builder-config-item">
                <Typography.Text type="secondary">边界策略</Typography.Text>
                <Select
                  aria-label="边界策略"
                  style={{ width: 180 }}
                  value={formula.boundary_strategy || 'strict'}
                  onChange={boundary_strategy => commit({ ...formula, boundary_strategy })}
                  options={[
                    { value: 'strict', label: '严格校验（默认）' },
                    { value: 'skip_first', label: '跳过首时点' },
                    { value: 'skip_last', label: '跳过末时点' },
                    { value: 'skip_out_of_range', label: '越界时跳过（兼容）' },
                    { value: 'explicit_subset', label: '显式子集' },
                  ]}
                />
              </div>
            )}
          </div>
        </div>

        <div className="formula-builder-controls">
          <div className="formula-builder-control-section">
            <Typography.Text type="secondary">求解状态</Typography.Text>
            <Radio.Group
              value={formula.solve_participation || 'solve_active'}
              onChange={event => commit({ ...formula, solve_participation: event.target.value })}
              options={[{ value: 'solve_active', label: '参与求解' }, { value: 'preview_only', label: '仅预览' }, { value: 'disabled', label: '停用' }]}
            />
          </div>
          <div className="formula-builder-control-actions">
            <Button onClick={() => setFocusMode(current => !current)}>{focusMode ? '退出全屏' : '全屏聚焦'}</Button>
            <Tag color={check.valid ? 'green' : 'red'}>{check.valid ? '校验通过' : '需要修正'}</Tag>
          </div>
        </div>
      </div>

      <div className="formula-builder-grid">
        <aside className="formula-object-panel">
          <Input.Search aria-label="搜索集合、变量、参数、函数" allowClear placeholder="搜索集合、变量、参数、函数" value={keyword} onChange={event => setKeyword(event.target.value)} />
          <Typography.Text className="formula-insert-help" type="secondary">
            点击标签即可插入；函数模板会选中首个占位符，可继续用标签替换并组合嵌套公式。
          </Typography.Text>
          <Tabs
            className="section-gap"
            items={[
              { key: 'sets', label: '集合', children: symbolList('set') },
              { key: 'variables', label: '变量', children: symbolList('variable') },
              { key: 'parameters', label: '参数', children: symbolList('parameter') },
              {
                key: 'operators',
                label: '运算符',
                children: (
                  <div className="formula-tag-cloud is-compact">
                    {filteredOperators.map(op => (
                      <button
                        type="button"
                        className="formula-insert-tag is-operator"
                        key={op}
                        aria-label={`插入运算符 ${op}`}
                        onClick={() => insertText(operatorInsertText[op] || op)}
                      >
                        <code>{op}</code>
                      </button>
                    ))}
                    {!filteredOperators.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配项" />}
                  </div>
                ),
              },
              {
                key: 'functions',
                label: '函数',
                children: (
                  <div className="formula-tag-cloud">
                    {filteredFunctions.map(template => (
                      <button
                        type="button"
                        className="formula-insert-tag is-function"
                        key={template.name}
                        aria-label={`插入函数 ${template.name}，语法 ${template.syntax}`}
                        onClick={() => inputRef.current?.insert(template.syntax, template.selection)}
                      >
                        <span className="formula-insert-tag-name">{template.name}</span>
                        <code>{template.syntax}</code>
                      </button>
                    ))}
                    {!filteredFunctions.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配项" />}
                  </div>
                ),
              },
            ]}
          />
        </aside>

        <main className="formula-expression-panel">
          <Form.Item label="公式表达式" required validateStatus={check.valid ? 'success' : 'error'}>
            <FormulaCodeEditor
              ref={inputRef}
              value={formula.dsl_formula}
              symbols={symbols}
              diagnostics={authoritative?.diagnostics}
              onChange={updateDsl}
              onCompile={() => { void runAuthoritativeCompile(); }}
            />
          </Form.Item>
          <div className="formula-preview-box">
            <Typography.Text strong>可读预览</Typography.Text>
            <Typography.Paragraph>{renderFormulaReadable(formula.dsl_formula, symbols) || '输入公式后显示预览'}</Typography.Paragraph>
          </div>
          {!check.valid && (
            <Alert
              className="section-gap"
              type="error"
              showIcon
              title="公式暂不能应用"
              description={<ul className="compact-list">{check.errors.map(error => <li key={error}>{error}</li>)}</ul>}
            />
          )}
          {check.valid && participation === 'solve_active' && !authoritativeCurrent && (
            <Alert
              className="section-gap"
              type="warning"
              showIcon
              title="请先执行权威编译"
              description="当前公式尚未编译，或公式、作用域、符号和时间契约变化后编译产物已过期。"
            />
          )}
          {check.warnings.length > 0 && (
            <Alert
              className="section-gap"
              type="warning"
              showIcon
              title="公式风险提示"
              description={<ul className="compact-list">{check.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
            />
          )}
          {nonlinearDiagnostics.length > 0 && (
            <Alert
              className="section-gap"
              type={nonlinearDiagnostics.some(item => item.blocking) ? 'error' : 'warning'}
              showIcon
              title="非线性转换建议"
              description={<ul className="compact-list">{nonlinearDiagnostics.map(item => <li key={`${item.nonlinear_type}-${item.involved_variables.join('-')}`}>{item.message}</li>)}</ul>}
            />
          )}
          {authoritative && (
            <Alert
              className="section-gap"
              type={authoritative.success ? 'success' : 'error'}
              showIcon
              title={formula.solve_participation === 'disabled' ? '公式已停用，仅完成安全分析' : authoritative.participation === 'preview_only' ? '仅预览，不进入求解' : authoritative.status === 'compile_valid' ? '后端权威编译通过，可参与求解' : '后端权威编译未通过'}
              description={
                <div>
                  <div>语法：{authoritative.checks.syntax}；符号/维度/单位：{authoritative.checks.symbol_dimension_unit}；类型：{authoritative.expression_class}；编译：{authoritative.checks.compile}</div>
                  <div>预计展开：{authoritative.estimated_expansion.constraint_count} 条约束 / {authoritative.estimated_expansion.term_count} 个项；编译器：{authoritative.compiler_version || '未知'}</div>
                  {authoritative.diagnostics.length > 0 && <ul className="compact-list">{authoritative.diagnostics.map(item => <li key={`${item.code}-${item.start}-${item.end}`}><button type="button" className="formula-diagnostic-link" onClick={() => inputRef.current?.focusRange(item.start, item.end)}>{item.message}{item.fixHint ? `（${item.fixHint}）` : ''}</button></li>)}</ul>}
                </div>
              }
            />
          )}
          <Collapse
            className="section-gap"
            items={[
              {
                key: 'advanced',
                label: '高级调试',
                children: <JsonViewer value={{ formula_id: formula.formula_id, name: formula.name, dsl_formula: formula.dsl_formula, tokens: formula.tokens, references: {
                  sets: formula.referenced_sets,
                  parameters: formula.referenced_parameters,
                  variables: formula.referenced_variables,
                  free_indices: formula.free_indices,
                }, ast: authoritative?.ast, scope: authoritative?.scope, compiled_fragment: authoritative?.compiled_fragment, authoritative_artifact_state: authoritativeArtifactState(formula, effectiveCompileContext), estimated_expansion: authoritative?.estimated_expansion }} />,
              },
            ]}
          />
        </main>
      </div>

      <div className="formula-builder-actions">
        <Button danger disabled={!value || !onDelete} onClick={() => setDeleteIntent(true)}>删除公式</Button>
        <Space>
          <Button onClick={requestClose}>取消</Button>
          <Button loading={compiling} disabled={!check.valid || !formula.dsl_formula.trim()} onClick={runAuthoritativeCompile}>后端编译与展开</Button>
          <Button type="primary" disabled={!canApply} onClick={() => onApply?.(formula)}>应用公式</Button>
        </Space>
      </div>
      <Modal
        open={closeIntent}
        title="存在未保存的公式修改"
        closable={false}
        footer={[
          <Button key="continue" onClick={() => setCloseIntent(false)}>继续编辑</Button>,
          <Button key="discard" danger onClick={() => { setCloseIntent(false); onCancel?.(); }}>放弃修改</Button>,
          <Button key="save" type="primary" disabled={!canApply} onClick={() => { onApply?.(formula); setCloseIntent(false); onCancel?.(); }}>保存并退出</Button>,
        ]}
      >
        关闭后未保存的表达式、作用域和参与状态将丢失，请选择处理方式。
      </Modal>
      <Modal
        open={deleteIntent}
        title="确认删除这条公式？"
        okText="删除公式"
        cancelText="保留公式"
        okButtonProps={{ danger: true }}
        onCancel={() => setDeleteIntent(false)}
        onOk={() => {
          onDelete?.(formula.formula_id);
          setDeleteIntent(false);
        }}
      >
        删除后该公式会从当前编辑草稿中移除；只有保存组件或模型后才会正式生效。
      </Modal>
    </div>
  );
}

export function FormulaBuilderModal({
  open,
  value,
  symbols,
  onApply,
  onCancel,
  onDelete,
  compileContext,
  lockedKind,
}: {
  open: boolean;
  value?: FormulaDef;
  symbols?: FormulaSymbols;
  onApply: (formula: FormulaDef) => void;
  onCancel: () => void;
  onDelete?: (formulaId: string) => void;
  compileContext?: AuthoritativeCompileContext;
  lockedKind?: FormulaDef['kind'];
}) {
  return (
    <Modal
      width={1120}
      open={open}
      footer={null}
      destroyOnHidden
      title="公式编辑器"
      closable={false}
      keyboard={false}
    >
      {open && <FormulaBuilder value={value} symbols={symbols} compileContext={compileContext} lockedKind={lockedKind} onApply={onApply} onCancel={onCancel} onDelete={onDelete} />}
    </Modal>
  );
}
