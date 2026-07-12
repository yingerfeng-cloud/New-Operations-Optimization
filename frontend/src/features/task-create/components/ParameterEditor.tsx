import { Alert, Checkbox, Input, InputNumber, Select, Table, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { RuntimeField } from '../../time-dimension';

const parseCell = (value: string) => {
  const text = value.trim();
  if (text === '') return '';
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
};
const parseGrid = (text: string) => text.trim().split(/\r?\n/).filter(Boolean).map(row => row.split(/\t|,/).map(parseCell));
const displayValue = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);

export type ParameterEditorKind = 'scalar' | 'sequence' | 'matrix' | 'structured';
export function parameterEditorKind(field: RuntimeField): ParameterEditorKind {
  if (field.dimension.length === 1) return 'sequence';
  if (field.dimension.length === 2) return 'matrix';
  if (field.dimension.length > 2) return 'structured';
  return 'scalar';
}

function StructuredEditor({ field, value, onChange, onValidityChange }: { field: RuntimeField; value: unknown; onChange: (value: unknown) => void; onValidityChange?: (error?: string) => void }) {
  const [text, setText] = useState(() => displayValue(value));
  useEffect(() => setText(displayValue(value)), [field.code]);
  const update = (next: string) => {
    setText(next);
    try {
      const parsed = JSON.parse(next);
      const error = field.dimension.length > 2 && !Array.isArray(parsed) ? '多维参数必须使用嵌套数组结构' : undefined;
      onValidityChange?.(error);
      if (!error) onChange(parsed);
    } catch {
      onValidityChange?.('请输入有效 JSON');
    }
  };
  return <div className="parameter-structured-editor">
    {field.dimension.length > 2 && <Alert showIcon type="info" message={`参数 ${field.code} 的维度为 [${field.dimension.join(', ')}]，当前为 ${field.dimension.length} 维参数，请使用高级结构化编辑。`} />}
    <Input.TextArea className="section-gap-tight" aria-label={`${field.name}高级结构化编辑`} rows={8} value={text} onChange={event => update(event.target.value)} placeholder={field.exampleValue !== undefined ? JSON.stringify(field.exampleValue, null, 2) : '请输入保持原始维度的 JSON 结构'} />
  </div>;
}

export function ParameterEditor({ field, value, onChange, expectedLength, onValidityChange }: { field: RuntimeField; value: unknown; onChange: (value: unknown) => void; expectedLength?: number; onValidityChange?: (error?: string) => void }) {
  const kind = parameterEditorKind(field);
  const type = (field.type || '').toLowerCase();
  const rows = useMemo(() => Array.isArray(value) ? value : [], [value]);
  useEffect(() => onValidityChange?.(undefined), [field.code]);

  if (field.enumValues?.length) return <Select aria-label={field.name} value={value} onChange={onChange} options={field.enumValues.map(item => ({ value: item, label: String(item) }))} />;
  if (type.includes('bool') || typeof field.defaultValue === 'boolean') return <Checkbox checked={Boolean(value)} onChange={event => onChange(event.target.checked)}>启用</Checkbox>;
  if (kind === 'scalar' && (type.includes('number') || type.includes('float') || type.includes('int') || typeof field.defaultValue === 'number')) return <InputNumber aria-label={field.name} value={typeof value === 'number' ? value : undefined} onChange={onChange} style={{ width: '100%' }} />;

  if (kind === 'sequence') {
    const values = Array.isArray(value) ? value : [];
    return <div className="parameter-sequence-editor">
      <Input.TextArea aria-label={`${field.name}批量输入`} rows={4} value={values.join('\t')} placeholder="粘贴一行或一列数据；支持 Excel 复制" onChange={event => { const grid = parseGrid(event.target.value); onChange(grid.length === 1 ? grid[0] : grid.flat()); }} />
      <div className="parameter-editor-meta"><span>当前 {values.length} 点{expectedLength ? ` / 应为 ${expectedLength} 点` : ''}</span>{field.dimension.map(item => <Tag key={item}>{item}</Tag>)}</div>
      {expectedLength && values.length !== expectedLength && <Alert showIcon type="warning" message={`长度应为 ${expectedLength}，当前为 ${values.length}`} />}
    </div>;
  }

  if (kind === 'matrix') {
    const matrix = rows.map(row => Array.isArray(row) ? row : []);
    const columnCount = Math.max(1, ...matrix.map(row => row.length));
    return <div className="parameter-matrix-editor">
      <Input.TextArea aria-label={`${field.name}矩阵粘贴`} rows={4} placeholder="从 Excel 粘贴二维区域（Tab 分列、换行分行）" onChange={event => onChange(parseGrid(event.target.value))} />
      <div className="parameter-editor-meta"><span>{matrix.length} 行 × {columnCount} 列</span>{field.dimension.map(item => <Tag key={item}>{item}</Tag>)}</div>
      {matrix.length > 0 && <Table size="small" pagination={false} scroll={{ x: Math.max(420, columnCount * 96) }} rowKey={(_, index) => String(index)} dataSource={matrix.map((row, index) => ({ key: index, row }))} columns={Array.from({ length: columnCount }, (_, column) => ({ title: String(column + 1), width: 96, render: (_: unknown, record: { row: unknown[] }, rowIndex: number) => <Input value={String(record.row[column] ?? '')} aria-label={`${field.name} 第${rowIndex + 1}行第${column + 1}列`} onChange={event => { const next = matrix.map(item => [...item]); while (next[rowIndex].length <= column) next[rowIndex].push(''); next[rowIndex][column] = parseCell(event.target.value); onChange(next); }} /> }))} />}
    </div>;
  }

  if (kind === 'structured' || type.includes('object') || type.includes('json') || (value !== null && typeof value === 'object')) return <StructuredEditor field={field} value={value} onChange={onChange} onValidityChange={onValidityChange} />;
  return <Input aria-label={field.name} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value)} />;
}
