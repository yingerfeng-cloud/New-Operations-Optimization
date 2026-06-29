import { Alert, Button, Collapse, Form, Input, Modal, Radio, Space, Tabs, Tag, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormulaDef } from '../../types/formula';
import { JsonViewer } from '../../components/JsonViewer';
import { collectReferences, renderFormulaReadable, tokensToDisplay } from './formulaDsl';
import { getFormulaSymbolDictionary } from './formulaDictionary';
import { parseFormulaDsl, type FormulaSymbols } from './formulaParser';
import { validateFormula } from './formulaValidator';

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
  };
}

function symbolExpression(item: ReturnType<typeof getFormulaSymbolDictionary>[number]) {
  if (item.type === 'set') return item.code;
  const aliases = item.indices?.length ? `[${item.indices.join(',')}]` : '';
  return `${item.code}${aliases}`;
}

export function FormulaBuilder({
  value,
  symbols = {},
  onApply,
  onCancel,
  onDelete,
}: {
  value?: FormulaDef;
  symbols?: FormulaSymbols;
  onApply?: (formula: FormulaDef) => void;
  onCancel?: () => void;
  onDelete?: (formulaId: string) => void;
}) {
  const [formula, setFormula] = useState<FormulaDef>(value || newFormula('constraint'));
  const [keyword, setKeyword] = useState('');
  const inputRef = useRef<any>(null);

  useEffect(() => {
    setFormula(value || newFormula('constraint'));
  }, [value]);

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

  const commit = (next: FormulaDef) => {
    setFormula(mergeFormula(next, next.dsl_formula, symbols));
  };

  const updateDsl = (dsl: string) => {
    setFormula(current => mergeFormula(current, dsl, symbols));
  };

  const insertText = (text: string) => {
    const input = inputRef.current?.resizableTextArea?.textArea || inputRef.current;
    const source = formula.dsl_formula;
    const start = input?.selectionStart ?? source.length;
    const end = input?.selectionEnd ?? source.length;
    const spacerLeft = start > 0 && !/\s$/.test(source.slice(0, start)) ? ' ' : '';
    const spacerRight = end < source.length && !/^\s/.test(source.slice(end)) ? ' ' : '';
    const next = `${source.slice(0, start)}${spacerLeft}${text}${spacerRight}${source.slice(end)}`;
    updateDsl(next);
    window.requestAnimationFrame(() => {
      const cursor = start + spacerLeft.length + text.length;
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
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

  const canApply = check.valid && Boolean(formula.dsl_formula.trim());

  return (
    <div className="formula-builder">
      <div className="formula-builder-head">
        <Space wrap>
          <Form.Item label="公式名称" style={{ margin: 0 }}>
            <Input value={formula.name} onChange={event => commit({ ...formula, name: event.target.value })} />
          </Form.Item>
          <Radio.Group
            value={formula.kind}
            onChange={event => commit({ ...formula, kind: event.target.value })}
            options={[{ value: 'constraint', label: '约束' }, { value: 'objective', label: '目标函数' }]}
          />
          <Radio.Group
            value={formula.solve_participation || 'solve_active'}
            onChange={event => commit({ ...formula, solve_participation: event.target.value })}
            options={[{ value: 'solve_active', label: '参与求解' }, { value: 'preview_only', label: '仅预览' }]}
          />
        </Space>
        <Tag color={check.valid ? 'green' : 'red'}>{check.valid ? '校验通过' : '需要修正'}</Tag>
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
            <Input.TextArea
              ref={inputRef}
              aria-label="公式表达式"
              rows={7}
              value={formula.dsl_formula}
              onChange={event => updateDsl(event.target.value)}
              placeholder="sum(unit_output[u,t] for u in unit) >= load_forecast[t]"
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
          {check.warnings.length > 0 && (
            <Alert
              className="section-gap"
              type="warning"
              showIcon
              title="公式风险提示"
              description={<ul className="compact-list">{check.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
            />
          )}
          <Collapse
            className="section-gap"
            items={[
              {
                key: 'advanced',
                label: '高级调试',
                children: <JsonViewer value={{ dsl_formula: formula.dsl_formula, tokens: formula.tokens, references: {
                  sets: formula.referenced_sets,
                  parameters: formula.referenced_parameters,
                  variables: formula.referenced_variables,
                  free_indices: formula.free_indices,
                } }} />,
              },
            ]}
          />
        </main>
      </div>

      <div className="formula-builder-actions">
        <Button danger disabled={!value} onClick={() => onDelete?.(formula.formula_id)}>删除公式</Button>
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" disabled={!canApply} onClick={() => onApply?.(formula)}>应用公式</Button>
        </Space>
      </div>
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
}: {
  open: boolean;
  value?: FormulaDef;
  symbols?: FormulaSymbols;
  onApply: (formula: FormulaDef) => void;
  onCancel: () => void;
  onDelete?: (formulaId: string) => void;
}) {
  return (
    <Modal
      width={1120}
      open={open}
      footer={null}
      destroyOnHidden
      title="Formula Builder"
      onCancel={onCancel}
    >
      {open && <FormulaBuilder value={value} symbols={symbols} onApply={onApply} onCancel={onCancel} onDelete={onDelete} />}
    </Modal>
  );
}
