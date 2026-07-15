import { Alert, Button, Checkbox, Input, InputNumber, Select, Space, Table, Tag } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeField } from '../../time-dimension';
import { TimeSeriesPreview } from './TimeSeriesPreview';

const parseCell = (value: string) => { const text = value.trim(); if (!text) return ''; const number = Number(text); return Number.isFinite(number) ? number : text; };
const parseGrid = (text: string) => text.trim().split(/\r?\n/).filter(Boolean).map(row => row.split(/\t|,/).map(parseCell));
const displayValue = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
const objectMapped = (field: RuntimeField) => ['object', 'map', 'record', 'dictionary'].some(item => String(field.type || '').toLowerCase().includes(item));

export function getArrayDepth(value: unknown): number { if (!Array.isArray(value)) return 0; return value.length ? 1 + Math.max(...value.map(getArrayDepth)) : 1; }
function irregularArrayWarning(value: unknown): string | undefined { if (!Array.isArray(value) || value.length < 2) return undefined; if (new Set(value.map(item => Array.isArray(item) ? item.length : -1)).size > 1) return '当前数组各分支长度不一致，请确认非规则结构符合模型契约。'; return value.map(irregularArrayWarning).find(Boolean); }

export type ParameterEditorKind = 'scalar' | 'sequence' | 'keyvalue' | 'matrix' | 'structured';
export function parameterEditorKind(field: RuntimeField): ParameterEditorKind {
  if (field.dimension.length === 1 && objectMapped(field)) return 'keyvalue';
  if (field.dimension.length === 1) return 'sequence';
  if (field.dimension.length === 2) return 'matrix';
  if (field.dimension.length > 2) return 'structured';
  return 'scalar';
}

function StructuredEditor({ field, value, onChange, onValidityChange }: EditorBase) {
  const [text, setText] = useState(() => displayValue(value)); const [warning, setWarning] = useState<string>();
  const committed = useRef(displayValue(value)); const lastField = useRef(field);
  useEffect(() => { const external = displayValue(value); if (lastField.current !== field || external !== committed.current) { setText(external); committed.current = external; setWarning(irregularArrayWarning(value)); onValidityChange?.(); } lastField.current = field; }, [field, value]);
  const update = (next: string) => { setText(next); try { const parsed = JSON.parse(next); const depth = getArrayDepth(parsed); const error = field.dimension.length > 2 && !objectMapped(field) && depth !== field.dimension.length ? `参数 ${field.code} 声明为${field.dimension.length}维结构 [${field.dimension.join(', ')}]，当前输入的嵌套深度为 ${depth}，预期为 ${field.dimension.length}。` : undefined; onValidityChange?.(error); if (!error) { committed.current = displayValue(parsed); setWarning(irregularArrayWarning(parsed)); onChange(parsed); } } catch { onValidityChange?.('请输入有效 JSON'); } };
  return <div className="parameter-structured-editor"><Alert showIcon type="info" title={`维度 [${field.dimension.join(', ')}]，请保持原始${field.dimension.length}维结构。`} /><Input.TextArea className="section-gap-tight" aria-label={`${field.name}高级结构化编辑`} rows={8} value={text} onChange={event => update(event.target.value)} placeholder={field.exampleValue !== undefined ? JSON.stringify(field.exampleValue, null, 2) : '请输入 JSON 结构'} />{warning && <Alert className="section-gap-tight" showIcon type="warning" title={warning} />}</div>;
}

interface EditorBase { field: RuntimeField; value: unknown; onChange: (value: unknown) => void; onValidityChange?: (error?: string) => void }
interface Props extends EditorBase { expectedLength?: number; timeSet?: string; stateTimeSet?: string | null; intervalMinutes?: number; labelFormat?: string }

function labelsFor(field: RuntimeField, dimension: string, count: number, props: Pick<Props, 'timeSet' | 'stateTimeSet' | 'intervalMinutes' | 'labelFormat'>) {
  const declared = field.dimensionValues?.[dimension]; if (declared?.length) return declared;
  if (dimension === props.stateTimeSet) return Array.from({ length: count }, (_, index) => index === 0 ? '初始状态' : `时段 ${index} 后`);
  if (dimension === props.timeSet && props.labelFormat === 'HH:mm' && props.intervalMinutes) return Array.from({ length: count }, (_, index) => { const minutes = index * props.intervalMinutes!; return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; });
  return Array.from({ length: count }, (_, index) => dimension === props.timeSet ? `T${index + 1}` : `${dimension} ${index + 1}`);
}

function SequenceEditor(props: Props) {
  const { field, value, onChange, expectedLength } = props; const values = Array.isArray(value) ? value : [];
  const count = Math.max(values.length, expectedLength || 0); const labels = labelsFor(field, field.dimension[0], count, props);
  const setValue = (index: number, next: unknown) => { const copy = Array.from({ length: count }, (_, i) => values[i] ?? ''); copy[index] = next; onChange(copy); };
  const numeric = values.map(Number).filter(Number.isFinite); const min = numeric.length ? Math.min(...numeric) : undefined; const max = numeric.length ? Math.max(...numeric) : undefined;
  return <div className="parameter-sequence-editor"><Space wrap><Button size="small" onClick={() => onChange([])}>清空</Button><Button size="small" onClick={() => onChange(Array(count).fill(field.defaultValue ?? 0))}>填充默认值</Button><Input.TextArea aria-label={`${field.name}批量输入`} rows={2} placeholder="粘贴 Excel 单列或多行数据" onChange={event => { const grid = parseGrid(event.target.value); onChange(grid.flat()); }} /></Space>
    <Table size="small" pagination={count > 48 ? { pageSize: 24 } : false} rowKey="key" dataSource={Array.from({ length: count }, (_, index) => ({ key: `${field.code}-${index}`, index, label: labels[index], value: values[index] }))} columns={[{ title: '序号', dataIndex: 'index', width: 72, render: value => Number(value) + 1 }, { title: '时间标签', dataIndex: 'label' }, { title: `参数值${field.unit ? ` (${field.unit})` : ''}`, render: (_value, row) => <InputNumber aria-label={`${field.name} ${row.label}`} value={typeof row.value === 'number' ? row.value : row.value === '' ? undefined : Number(row.value)} min={field.min} max={field.max} onChange={next => setValue(row.index, next ?? '')} style={{ width: '100%' }} /> }]} />
    <TimeSeriesPreview name={field.name} unit={field.unit} labels={labels.slice(0, values.length)} values={values} />
    <div className="parameter-editor-meta"><span>当前 {values.length} 点{expectedLength ? ` / 应为 ${expectedLength} 点` : ''}</span>{min !== undefined && <span>最小 {min} · 最大 {max}</span>}<Tag>{field.dimension[0]}</Tag></div>{expectedLength && values.length !== expectedLength && <Alert showIcon type="warning" title={`长度应为 ${expectedLength}，当前为 ${values.length}`} />}</div>;
}

function KeyValueEditor({ field, value, onChange, onValidityChange }: Props) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const declared = field.dimensionValues?.[field.dimension[0]] || []; const rows = Object.entries(source).map(([key, item]) => ({ id: key, key, value: item }));
  const update = (oldKey: string, key: string, item: unknown) => { const next = { ...source }; delete next[oldKey]; if (!key.trim()) return onValidityChange?.('键不能为空'); if (key !== oldKey && Object.prototype.hasOwnProperty.call(source, key)) return onValidityChange?.(`键 ${key} 重复`); next[key] = item; onValidityChange?.(); onChange(next); };
  return <div><Space wrap><Button size="small" onClick={() => { const key = declared.find(item => !(item in source)) || `key_${rows.length + 1}`; onChange({ ...source, [key]: 0 }); }}>新增</Button><Button size="small" onClick={() => onChange({})}>清空</Button></Space><Table size="small" pagination={false} rowKey="id" dataSource={rows} columns={[{ title: '键', render: (_v, row) => <Input value={row.key} list={`${field.code}-keys`} onChange={event => update(row.key, event.target.value, row.value)} /> }, { title: '值', render: (_v, row) => <InputNumber value={typeof row.value === 'number' ? row.value : Number(row.value)} onChange={next => update(row.key, row.key, next)} /> }, { title: '操作', width: 80, render: (_v, row) => <Button type="link" danger onClick={() => { const next = { ...source }; delete next[row.key]; onChange(next); }}>删除</Button> }]} /><datalist id={`${field.code}-keys`}>{declared.map(key => <option key={key}>{key}</option>)}</datalist></div>;
}

function MatrixEditor(props: Props) {
  const { field, value, onChange } = props; const matrix = Array.isArray(value) ? value.map(row => Array.isArray(row) ? row : []) : [];
  const rowCount = Math.max(matrix.length, field.dimensionValues?.[field.dimension[0]]?.length || 0); const columnCount = Math.max(1, ...matrix.map(row => row.length), field.dimensionValues?.[field.dimension[1]]?.length || 0);
  const rowLabels = labelsFor(field, field.dimension[0], rowCount, props); const columns = labelsFor(field, field.dimension[1], columnCount, props);
  const update = (r: number, c: number, next: unknown) => { const copy = Array.from({ length: rowCount }, (_, i) => Array.from({ length: columnCount }, (_x, j) => matrix[i]?.[j] ?? '')); copy[r][c] = next; onChange(copy); };
  return <div className="parameter-matrix-editor"><Input.TextArea aria-label={`${field.name}矩阵粘贴`} rows={2} placeholder="从 Excel 粘贴矩形区域" onChange={event => onChange(parseGrid(event.target.value))} /><div className="parameter-editor-meta"><span>{rowCount} 行 × {columnCount} 列</span><Tag>行：{field.dimension[0]}</Tag><Tag>列：{field.dimension[1]}</Tag>{rowCount * columnCount > 1000 && <Tag color="orange">大矩阵，可使用高级 JSON</Tag>}</div><Table size="small" sticky pagination={rowCount > 30 ? { pageSize: 20 } : false} scroll={{ x: Math.max(520, columnCount * 110) }} rowKey="key" dataSource={Array.from({ length: rowCount }, (_, index) => ({ key: `${field.code}-${index}`, index, label: rowLabels[index] }))} columns={[{ title: field.dimension[0], dataIndex: 'label', fixed: 'left', width: 130 }, ...columns.map((label, column) => ({ title: label, width: 110, render: (_v: unknown, row: { index: number }) => <InputNumber aria-label={`${field.name} ${rowLabels[row.index]} ${label}`} value={typeof matrix[row.index]?.[column] === 'number' ? matrix[row.index][column] : undefined} onChange={next => update(row.index, column, next ?? '')} /> }))]} /></div>;
}

export function ParameterEditor(props: Props) {
  const { field, value, onChange, onValidityChange } = props; const kind = parameterEditorKind(field); const type = String(field.type || '').toLowerCase();
  useEffect(() => onValidityChange?.(), [field.code]);
  if (field.enumValues?.length) return <Select aria-label={field.name} value={value} onChange={onChange} options={field.enumValues.map(item => ({ value: item, label: String(item) }))} />;
  if (type.includes('bool') || typeof field.defaultValue === 'boolean') return <Checkbox checked={Boolean(value)} onChange={event => onChange(event.target.checked)}>启用</Checkbox>;
  if (kind === 'scalar' && (type.includes('number') || type.includes('float') || type.includes('int') || typeof field.defaultValue === 'number')) return <InputNumber aria-label={field.name} value={typeof value === 'number' ? value : undefined} min={field.min} max={field.max} onChange={onChange} style={{ width: '100%' }} />;
  if (kind === 'sequence') return <SequenceEditor {...props} />;
  if (kind === 'keyvalue') return <KeyValueEditor {...props} />;
  if (kind === 'matrix') return <MatrixEditor {...props} />;
  if (kind === 'structured' || type.includes('object') || type.includes('json') || (value !== null && typeof value === 'object')) return <StructuredEditor {...props} />;
  return <Input aria-label={field.name} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value)} />;
}
