import { Alert, Button, Card, Input, Modal, Progress, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useMemo, useState } from 'react';
import type { FormulaDef, FormulaVersionSnapshot } from '../../types/formula';
import type { FormulaSymbols } from './formulaParser';
import { dependencyAnalysis, filterFormulas, formulaSnapshot, moveFormula } from './formulaManagement';
import { compileFormulaAuthoritatively, type AuthoritativeCompileContext } from './authoritativeCompilation';
import { markFormulaCompiled, markFormulaSaved, withCurrentFormulaVersion } from './formulaVersioning';

function versionRows(saved: FormulaVersionSnapshot | undefined, current: FormulaVersionSnapshot) {
  return [
    ['修订号', saved?.revision || '-', current.revision],
    ['表达式 Hash', saved?.expression_hash || '无历史版本', current.expression_hash],
    ['表达式', saved?.expression || '无历史版本', current.expression],
    ['作用域', JSON.stringify(saved?.scope || []), JSON.stringify(current.scope)],
    ['参与状态', saved?.participation || '无', current.participation],
    ['目标方向', saved?.direction || '无', current.direction || '无'],
    ['目标权重', saved?.weight ?? '无', current.weight ?? '无'],
    ['编译状态', saved?.compile_status || '无', current.compile_status],
  ].filter(([, before, after]) => before !== after);
}

export function FormulaManagementPanel({
  formulas,
  semantic,
  symbols,
  onChange,
  onEdit,
  compileContext,
}: {
  formulas: FormulaDef[];
  semantic: { sets: Array<{ code: string }>; parameters: Array<{ code: string }>; variables: Array<{ code: string }> };
  symbols: FormulaSymbols;
  onChange: (formulas: FormulaDef[]) => void;
  onEdit: (formula: FormulaDef) => void;
  compileContext?: AuthoritativeCompileContext;
}) {
  const [keyword, setKeyword] = useState('');
  const [kind, setKind] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [group, setGroup] = useState<string>('all');
  const [compiling, setCompiling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [diffFormula, setDiffFormula] = useState<FormulaDef>();
  const [diffBaseline, setDiffBaseline] = useState<'saved' | 'compiled' | 'applied' | 'published'>('saved');
  const groups = useMemo(() => [...new Set(formulas.map(item => item.business_group || '未分组'))], [formulas]);
  const filtered = useMemo(() => filterFormulas(formulas, { keyword, kind: kind as FormulaDef['kind'] | 'all', status, group }), [formulas, group, keyword, kind, status]);
  const dependencies = useMemo(() => dependencyAnalysis(formulas, semantic), [formulas, semantic]);
  const effectiveCompileContext = compileContext || {
    symbols: {
      sets: Object.fromEntries(semantic.sets.map(item => [item.code, { values: [] }])),
      parameters: semantic.parameters,
      variables: semantic.variables,
    },
  };

  const duplicate = (formula: FormulaDef) => {
    const now = new Date().toISOString();
    const copy: FormulaDef = {
      ...formula,
      formula_id: crypto.randomUUID(),
      name: `${formula.name}（副本）`,
      created_at: now,
      updated_at: now,
      compile_status: 'draft',
      diagnostics: [],
      compiler_version: undefined,
      authoritative_artifact: undefined,
      version_state: undefined,
      last_saved_version: undefined,
      last_compiled_version: undefined,
      applied_version: undefined,
      published_version: undefined,
    };
    onChange([...formulas, markFormulaSaved(copy, now)]);
  };

  const toggle = (formula: FormulaDef) => {
    const disabled = formula.solve_participation === 'disabled';
    onChange(formulas.map(item => item.formula_id === formula.formula_id ? withCurrentFormulaVersion({
      ...item,
      solve_participation: disabled ? 'solve_active' : 'disabled',
      compile_status: disabled ? 'draft' : 'disabled',
      compiler_version: undefined,
      authoritative_artifact: undefined,
      updated_at: new Date().toISOString(),
    }) : item));
  };

  const bulkCompile = async () => {
    const targets = filtered.filter(item => item.solve_participation !== 'disabled');
    if (!targets.length) return;
    setCompiling(true);
    setProgress(0);
    let next = [...formulas];
    let failed = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const formula = targets[index];
      try {
        const { result, artifact } = await compileFormulaAuthoritatively(formula, effectiveCompileContext);
        const updated = markFormulaCompiled({
          ...formula,
          scope: result.scope,
          diagnostics: result.diagnostics,
          ast_version: result.ast_version,
          compiler_version: result.compiler_version,
          authoritative_artifact: artifact,
          compile_status: result.status,
          compile_error: result.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('；') || undefined,
          updated_at: new Date().toISOString(),
        }, artifact);
        if (!result.success) failed += 1;
        next = next.map(item => item.formula_id === formula.formula_id ? updated : item);
      } catch (error) {
        failed += 1;
        next = next.map(item => item.formula_id === formula.formula_id ? { ...item, compile_status: 'compile_failed', compile_error: error instanceof Error ? error.message : '权威编译失败' } : item);
      }
      setProgress(Math.round(((index + 1) / targets.length) * 100));
      onChange(next);
    }
    setCompiling(false);
    if (failed) message.error(`批量编译完成，${failed} 条未通过`);
    else message.success(`批量编译完成，${targets.length} 条全部通过`);
  };

  const diffSnapshot = diffFormula ? ({ saved: diffFormula.last_saved_version, compiled: diffFormula.last_compiled_version, applied: diffFormula.applied_version, published: diffFormula.published_version }[diffBaseline]) : undefined;
  const diffRows = diffFormula ? versionRows(diffSnapshot, formulaSnapshot(diffFormula)) : [];
  return (
    <Card className="section-gap" title="公式管理工作台">
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search aria-label="搜索公式" allowClear placeholder="名称、表达式、变量或参数" value={keyword} onChange={event => setKeyword(event.target.value)} style={{ width: 280 }} />
        <Select aria-label="公式类型筛选" value={kind} onChange={setKind} style={{ width: 130 }} options={[{ value: 'all', label: '全部类型' }, { value: 'objective', label: '目标函数' }, { value: 'constraint', label: '约束' }]} />
        <Select aria-label="公式状态筛选" value={status} onChange={setStatus} style={{ width: 150 }} options={[{ value: 'all', label: '全部状态' }, { value: 'compile_valid', label: '编译通过' }, { value: 'compile_failed', label: '编译失败' }, { value: 'preview_only', label: '仅预览' }, { value: 'disabled', label: '已停用' }]} />
        <Select aria-label="公式分组筛选" value={group} onChange={setGroup} style={{ width: 150 }} options={[{ value: 'all', label: '全部分组' }, ...groups.map(value => ({ value, label: value }))]} />
        <Button type="primary" loading={compiling} onClick={() => { void bulkCompile(); }}>批量权威编译（{filtered.filter(item => item.solve_participation !== 'disabled').length}）</Button>
      </Space>
      {compiling && <Progress percent={progress} size="small" />}
      <Table
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: false }}
        rowKey="formula_id"
        dataSource={filtered}
        columns={[
          { title: '名称', render: (_, row) => <div><Typography.Text strong>{row.name}</Typography.Text><div><Tag>{row.business_group || '未分组'}</Tag></div></div> },
          { title: '类型', width: 90, render: (_, row) => row.kind === 'objective' ? '目标' : '约束' },
          { title: '参与状态', width: 100, render: (_, row) => <Tag color={row.solve_participation === 'disabled' ? 'default' : row.solve_participation === 'preview_only' ? 'blue' : 'green'}>{row.solve_participation || 'solve_active'}</Tag> },
          { title: '编译状态', width: 110, render: (_, row) => <Tag color={row.compile_status === 'compile_valid' || row.compile_status === 'ready' ? 'green' : row.compile_status === 'compile_failed' || row.compile_status === 'error' ? 'red' : 'orange'}>{row.compile_status}</Tag> },
          { title: '表达式', ellipsis: true, render: (_, row) => <Typography.Text code>{row.dsl_formula || '—'}</Typography.Text> },
          { title: '操作', width: 330, render: (_, row) => <Space wrap size={4}>
            <Button size="small" onClick={() => onEdit(row)}>编辑</Button>
            <Button size="small" onClick={() => duplicate(row)}>复制</Button>
            <Button size="small" onClick={() => toggle(row)}>{row.solve_participation === 'disabled' ? '启用' : '停用'}</Button>
            <Button size="small" onClick={() => onChange(moveFormula(formulas, row.formula_id, -1))}>上移</Button>
            <Button size="small" onClick={() => onChange(moveFormula(formulas, row.formula_id, 1))}>下移</Button>
            <Button size="small" onClick={() => setDiffFormula(row)}>差异</Button>
          </Space> },
        ]}
      />
      <Alert
        className="section-gap"
        type={dependencies.duplicateConstraintGroups.length ? 'warning' : 'info'}
        showIcon
        title="依赖分析"
        description={<Space orientation="vertical" size={4}>
          <span>孤立变量：{dependencies.unusedVariables.join('、') || '无'}</span>
          <span>冗余参数：{dependencies.unusedParameters.join('、') || '无'}</span>
          <span>未使用集合：{dependencies.unusedSets.join('、') || '无'}</span>
          <span>未参与目标的变量：{dependencies.variablesOutsideObjective.join('、') || '无'}</span>
          <span>重复约束组：{dependencies.duplicateConstraintGroups.length}</span>
        </Space>}
      />
      <Modal open={Boolean(diffFormula)} title="公式版本差异" footer={<Button onClick={() => setDiffFormula(undefined)}>关闭</Button>} onCancel={() => setDiffFormula(undefined)}>
        <Select aria-label="差异基线" value={diffBaseline} onChange={setDiffBaseline} style={{ width: '100%', marginBottom: 12 }} options={[
          { value: 'saved', label: '当前编辑 vs 最近保存' },
          { value: 'compiled', label: '当前编辑 vs 最近编译' },
          { value: 'applied', label: '当前编辑 vs 当前模型采用' },
          { value: 'published', label: '当前编辑 vs 已发布' },
        ]} />
        {diffRows.length ? diffRows.map(([field, before, after]) => <Card size="small" key={field} title={field} style={{ marginBottom: 8 }}><Typography.Text delete>{before}</Typography.Text><br /><Typography.Text type="success">{after}</Typography.Text></Card>) : <Alert type="success" showIcon title="当前内容与所选版本基线一致" />}
        {diffFormula?.version_state && <Typography.Paragraph type="secondary">当前 r{diffFormula.version_state.current_revision} · 保存 r{diffFormula.version_state.last_saved_revision || '-'} · 编译 r{diffFormula.version_state.last_compiled_revision || '-'} · 采用 r{diffFormula.version_state.applied_revision || '-'} · 发布 r{diffFormula.version_state.published_revision || '-'}</Typography.Paragraph>}
        {diffFormula?.last_compiled_version && <Typography.Paragraph type="secondary">最近编译成功：{diffFormula.last_compiled_version.saved_at} · 编译器 {diffFormula.compiler_version || '未知'}</Typography.Paragraph>}
      </Modal>
    </Card>
  );
}
