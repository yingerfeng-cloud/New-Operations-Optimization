import { Alert, Button, Collapse, Form, Input, InputNumber, Modal, Radio, Space, Tabs, Tag, Typography } from 'antd';
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

const newFormula = (kind: 'constraint' | 'objective'): FormulaDef => ({
  formula_id: crypto.randomUUID(),
  name: kind === 'constraint' ? '新约束' : '目标函数',
  kind,
  solve_participation: 'solve_active',
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

function symbolExpression(item: ReturnType<typeof getFormulaSymbolDictionary>[number]) {
  if (item.type === 'set') return item.code;
  const aliases = item.indices?.length ? `[${item.indices.join(',')}]` : '';
  return `${item.code}${aliases}`;
}

function editableSnapshot(formula: FormulaDef) {
  return JSON.stringify({
    name: formula.name,
    kind: formula.kind,
    expression: formula.dsl_formula,
    participation: formula.solve_participation,
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
}: {
  value?: FormulaDef;
  symbols?: FormulaSymbols;
  onApply?: (formula: FormulaDef) => void;
  onCancel?: () => void;
  onDelete?: (formulaId: string) => void;
  compileContext?: AuthoritativeCompileContext;
}) {
  const initialRef = useRef<FormulaDef | null>(null);
  if (!initialRef.current) initialRef.current = value || newFormula('constraint');
  const [formula, setFormula] = useState<FormulaDef>(initialRef.current);
  const [savedFormula, setSavedFormula] = useState<FormulaDef>(initialRef.current);
  const [baseline, setBaseline] = useState(() => editableSnapshot(initialRef.current!));
  const [keyword, setKeyword] = useState('');
  const [authoritative, setAuthoritative] = useState<FormulaCompileResult>();
  const [compiling, setCompiling] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [closeIntent, setCloseIntent] = useState<'cancel' | 'focus'>();
  const inputRef = useRef<FormulaCodeEditorHandle>(null);
  const effectiveCompileContext: AuthoritativeCompileContext = compileContext || {
    symbols: {
      sets: Object.fromEntries(Object.keys(symbols.sets || {}).map(code => [code, { values: [] }])),
      parameters: Object.entries(symbols.parameters || {}).map(([code, meta]) => ({ code, ...meta, dimension: meta.indices || [] })),
      variables: Object.entries(symbols.variables || {}).map(([code, meta]) => ({ code, ...meta, dimension: meta.indices || [] })),
    },
  };

  useEffect(() => {
    const next = value || newFormula('constraint');
    setFormula(next);
    setSavedFormula(next);
    setBaseline(editableSnapshot(next));
  }, [value]);

  const dirty = editableSnapshot(formula) !== baseline;

  const dictionary = useMemo(() => getFormulaSymbolDictionary({ symbols }), [symbols]);
  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) return dictionary;
    return dictionary.filter(item => `${item.code} ${item.name} ${item.typeLabel}`.toLowerCase().includes(text));
  }, [dictionary, keyword]);
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

  const symbolList = (type: 'set' | 'variable' | 'parameter') => (
    <div className="formula-object-list">
      {filtered.filter(item => item.type === type).map(item => (
        <button type="button" key={`${item.type}-${item.code}`} onClick={() => insertText(symbolExpression(item))}>
          <span>
            <strong>{item.name}</strong>
            <small>{item.code}{item.unit ? ` · ${item.unit}` : ''}</small>
          </span>
          <Tag>{item.typeLabel}</Tag>
        </button>
      ))}
    </div>
  );

  const participation = formula.solve_participation || 'solve_active';
  const authoritativeCurrent = isAuthoritativeArtifactCurrent(formula, effectiveCompileContext);
  const canApply = check.valid && Boolean(formula.dsl_formula.trim()) && (participation !== 'solve_active' || authoritativeCurrent);

  const finishClose = (discard: boolean) => {
    if (closeIntent === 'focus') {
      if (discard) setFormula(savedFormula);
      setFocusMode(false);
    } else {
      onCancel?.();
    }
    setCloseIntent(undefined);
  };

  const requestClose = (intent: 'cancel' | 'focus') => {
    if (!dirty) {
      if (intent === 'focus') setFocusMode(false);
      else onCancel?.();
      return;
    }
    setCloseIntent(intent);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose(focusMode ? 'focus' : 'cancel');
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
        <Space wrap>
          <Form.Item label="公式名称" style={{ margin: 0 }}>
            <Input value={formula.name} onChange={event => commit({ ...formula, name: event.target.value })} />
          </Form.Item>
          <Form.Item label="业务分组" style={{ margin: 0 }}>
            <Input aria-label="业务分组" placeholder="例如：状态递推" value={formula.business_group} onChange={event => commit({ ...formula, business_group: event.target.value })} />
          </Form.Item>
          <Radio.Group
            value={formula.kind}
            onChange={event => commit({ ...formula, kind: event.target.value })}
            options={[{ value: 'constraint', label: '约束' }, { value: 'objective', label: '目标函数' }]}
          />
          {formula.kind === 'objective' && (
            <>
              <Radio.Group
                value={formula.objective_direction}
                onChange={event => commit({ ...formula, objective_direction: event.target.value })}
                options={[{ value: 'minimize', label: '最小化' }, { value: 'maximize', label: '最大化' }]}
              />
              <Form.Item label="权重" style={{ margin: 0 }}>
                <InputNumber aria-label="目标权重" value={formula.weight} onChange={value => commit({ ...formula, weight: value === null ? undefined : value })} />
              </Form.Item>
              <Form.Item label="优先级" style={{ margin: 0 }}>
                <InputNumber aria-label="目标优先级" min={1} precision={0} value={formula.priority} onChange={value => commit({ ...formula, priority: value === null ? undefined : value })} />
              </Form.Item>
            </>
          )}
          <Radio.Group
            value={formula.solve_participation || 'solve_active'}
            onChange={event => commit({ ...formula, solve_participation: event.target.value })}
            options={[{ value: 'solve_active', label: '参与求解' }, { value: 'preview_only', label: '仅预览' }, { value: 'disabled', label: '停用' }]}
          />
        </Space>
        <Space>
          <Button onClick={() => focusMode ? requestClose('focus') : setFocusMode(true)}>{focusMode ? '退出全屏' : '全屏聚焦'}</Button>
          <Tag color={check.valid ? 'green' : 'red'}>{check.valid ? '校验通过' : '需要修正'}</Tag>
        </Space>
      </div>

      <div className="formula-builder-grid">
        <aside className="formula-object-panel">
          <Input.Search allowClear placeholder="搜索集合、变量、参数、函数" value={keyword} onChange={event => setKeyword(event.target.value)} />
          <Tabs
            className="section-gap"
            items={[
              { key: 'sets', label: '集合', children: symbolList('set') },
              { key: 'variables', label: '变量', children: symbolList('variable') },
              { key: 'parameters', label: '参数', children: symbolList('parameter') },
              {
                key: 'operators',
                label: '运算符',
                children: <div className="formula-object-list compact">{['+', '-', '*', '/', '>=', '<=', '=='].map(op => <button type="button" key={op} onClick={() => insertText(op)}>{op}</button>)}</div>,
              },
              {
                key: 'functions',
                label: '函数',
                children: <div className="formula-object-list compact">{['sum( for i in set)', 'min( for i in set)', 'max( for i in set)', 'piecewise(x, curve_id)'].map(fn => <button type="button" key={fn} onClick={() => insertText(fn)}>{fn}</button>)}</div>,
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
        <Button danger disabled={!value} onClick={() => onDelete?.(formula.formula_id)}>删除公式</Button>
        <Space>
          <Button onClick={() => requestClose('cancel')}>取消</Button>
          <Button loading={compiling} disabled={!check.valid || !formula.dsl_formula.trim()} onClick={runAuthoritativeCompile}>后端编译与展开</Button>
          <Button type="primary" disabled={!canApply} onClick={() => onApply?.(formula)}>应用公式</Button>
        </Space>
      </div>
      <Modal
        open={Boolean(closeIntent)}
        title="存在未保存的公式修改"
        closable={false}
        footer={[
          <Button key="continue" onClick={() => setCloseIntent(undefined)}>继续编辑</Button>,
          <Button key="discard" danger onClick={() => finishClose(true)}>放弃修改</Button>,
          <Button key="save" type="primary" disabled={!canApply} onClick={() => { onApply?.(formula); finishClose(false); }}>保存并退出</Button>,
        ]}
      >
        关闭后未保存的表达式、作用域和参与状态将丢失，请选择处理方式。
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
}: {
  open: boolean;
  value?: FormulaDef;
  symbols?: FormulaSymbols;
  onApply: (formula: FormulaDef) => void;
  onCancel: () => void;
  onDelete?: (formulaId: string) => void;
  compileContext?: AuthoritativeCompileContext;
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
      {open && <FormulaBuilder value={value} symbols={symbols} compileContext={compileContext} onApply={onApply} onCancel={onCancel} onDelete={onDelete} />}
    </Modal>
  );
}
