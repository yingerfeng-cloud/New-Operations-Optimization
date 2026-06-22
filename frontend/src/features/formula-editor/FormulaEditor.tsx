import { Card, Col, Collapse, Form, Input, Radio, Row, Space } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { FormulaDef, FormulaToken } from '../../types/formula';
import { collectReferences, tokensToDisplay, tokensToDsl } from './formulaDsl';
import { parseFormulaDsl, type FormulaSymbols } from './formulaParser';
import { validateFormula } from './formulaValidator';
import { FormulaToolbar } from './FormulaToolbar';
import { TokenCanvas } from './TokenCanvas';
import { FormulaPreview } from './FormulaPreview';
import { FormulaValidationPanel } from './FormulaValidationPanel';
import { DslDebugPanel } from './DslDebugPanel';
import { JsonViewer } from '../../components/JsonViewer';

const blank = (kind: 'constraint' | 'objective'): FormulaDef => ({ formula_id: crypto.randomUUID(), name: kind === 'constraint' ? '新约束' : '目标函数', kind, display_formula: '', dsl_formula: '', tokens: [], foreach: [], referenced_sets: [], referenced_parameters: [], referenced_variables: [], free_indices: [], compile_status: 'error' });
export function FormulaEditor({ value, onChange, symbols = {} }: { value?: FormulaDef; onChange?: (f: FormulaDef) => void; symbols?: FormulaSymbols }) {
  const [formula, setFormula] = useState(value || blank('constraint'));
  useEffect(() => { if (value) setFormula(value); }, [value]);
  const commit = (next: FormulaDef) => { const refs = collectReferences(next.tokens); const check = validateFormula(next.dsl_formula, next.kind, next.tokens); const merged = { ...next, ...refs, foreach: next.foreach.length ? next.foreach : refs.free_indices, compile_status: check.valid ? 'ready' : 'error', compile_error: check.errors.join('；') || undefined } as FormulaDef; setFormula(merged); onChange?.(merged); };
  const withTokens = (tokens: FormulaToken[]) => commit({ ...formula, tokens, dsl_formula: tokensToDsl(tokens), display_formula: tokensToDisplay(tokens) });
  const check = useMemo(() => validateFormula(formula.dsl_formula, formula.kind, formula.tokens), [formula]);
  return <Card title="统一公式编辑器"><Row gutter={[16, 16]}><Col span={24}><Space><Form.Item label="公式名称" style={{ margin: 0 }}><Input value={formula.name} onChange={e => commit({ ...formula, name: e.target.value })}/></Form.Item><Radio.Group value={formula.kind} onChange={e => commit({ ...formula, kind: e.target.value })} options={[{ label: '约束', value: 'constraint' }, { label: '目标', value: 'objective' }]}/></Space></Col><Col span={24}><FormulaToolbar symbols={symbols} onInsert={t => withTokens([...formula.tokens, t])}/></Col><Col span={24}><TokenCanvas tokens={formula.tokens} onRemove={i => withTokens(formula.tokens.filter((_, x) => x !== i))}/></Col><Col xs={24} lg={14}><FormulaPreview formula={formula}/></Col><Col xs={24} lg={10}><FormulaValidationPanel result={check}/></Col><Col span={24}><Collapse items={[{ key: 'dsl', label: 'DSL 调试面板', children: <DslDebugPanel value={formula.dsl_formula} onChange={dsl => { const tokens = parseFormulaDsl(dsl, symbols); commit({ ...formula, dsl_formula: dsl, display_formula: tokensToDisplay(tokens), tokens }); }}/> }, { key: 'json', label: 'JSON 调试面板', children: <JsonViewer value={formula}/> }]}/></Col></Row></Card>;
}
