import { Alert, Button, Card, List, Modal, Space } from 'antd';
import { useState } from 'react';
import type { FormulaDef } from '../../../types/formula';
import type { ModelDraft } from '../stores/modelCreationStore';
import { FormulaEditor } from '../../formula-editor/FormulaEditor';
import { compileFormulaToGenericSpec } from '../utils/compileFormulaToGenericSpec';

const newFormula = (): FormulaDef => ({ formula_id: crypto.randomUUID(), name: '新约束', kind: 'constraint', display_formula: '', dsl_formula: '', tokens: [], foreach: [], referenced_sets: [], referenced_parameters: [], referenced_variables: [], free_indices: [], compile_status: 'error' });
export function Step3MathExpansion({ draft, onChange }: { draft: ModelDraft; onChange: (d: ModelDraft) => void }) {
  const [editing, setEditing] = useState<FormulaDef>();
  const symbols = { sets: Object.fromEntries(draft.semantic.sets.map(x => [x.code, x.name || x.code])), parameters: Object.fromEntries(draft.semantic.parameters.map(x => [x.code, { label: x.name || x.code, indices: x.dimension }])), variables: Object.fromEntries(draft.semantic.variables.map(x => [x.code, { label: x.name || x.code, indices: x.dimension }])) };
  const compile = () => { try { const spec = compileFormulaToGenericSpec(draft.formulas, draft.semantic); onChange({ ...draft, advanced: { ...draft.advanced, generic_spec: spec } }); Modal.success({ title: 'generic_spec 编译成功', content: '所有公式已编译为后端线性结构' }); } catch (error) { Modal.error({ title: '编译失败，已阻止发布', content: String(error) }); } };
  if (draft.basic_info.builder_mode !== 'generic_linear') return <><Alert type="info" message="组件化数学展开" description="约束和目标项由已选组件生成；自定义公式仍通过统一公式编辑器维护。"/><Card title="组件生成内容"><pre>{JSON.stringify(draft.components, null, 2)}</pre></Card></>;
  return <><Space><Button type="primary" onClick={() => setEditing(newFormula())}>新增统一公式</Button><Button onClick={compile}>编译 generic_spec</Button></Space><List className="section-gap" dataSource={draft.formulas} locale={{ emptyText: '尚未维护公式' }} renderItem={f => <List.Item actions={[<Button onClick={() => setEditing(f)}>编辑</Button>]}><List.Item.Meta title={`${f.kind === 'objective' ? '目标' : '约束'} · ${f.name}`} description={`${f.display_formula} · ${f.compile_status}`}/></List.Item>}/><Modal width={1000} open={!!editing} footer={null} destroyOnHidden onCancel={() => setEditing(undefined)} title="公式维护">{editing && <FormulaEditor value={editing} symbols={symbols} onChange={f => { const exists = draft.formulas.some(x => x.formula_id === f.formula_id); onChange({ ...draft, formulas: exists ? draft.formulas.map(x => x.formula_id === f.formula_id ? f : x) : [...draft.formulas, f] }); setEditing(f); }}/>}</Modal></>;
}
