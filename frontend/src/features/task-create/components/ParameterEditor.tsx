import { Alert, Button, Checkbox, Input, InputNumber, Select, Table, Tag } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeField } from '../../time-dimension';
import { TimeSeriesPreview } from './TimeSeriesPreview';
import { ParameterBatchPasteModal } from './ParameterBatchPasteModal';
import { ParameterToolbar } from './ParameterToolbar';
import { FullscreenMatrixEditor } from './FullscreenMatrixEditor';
import { parseRuntimeGrid, runtimeGridStrategy } from '../utils/runtimeParameterImport';

const displayValue = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
const objectMapped = (field: RuntimeField) => ['object', 'map', 'record', 'dictionary'].some(item => String(field.type || '').toLowerCase().includes(item));
const isObjectMap = (value: unknown) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function getArrayDepth(value: unknown): number { if (!Array.isArray(value)) return 0; return value.length ? 1 + Math.max(...value.map(getArrayDepth)) : 1; }
function irregularArrayWarning(value: unknown): string | undefined { if (!Array.isArray(value) || value.length < 2) return undefined; if (new Set(value.map(item => Array.isArray(item) ? item.length : -1)).size > 1) return '当前数组各分支长度不一致，请确认非规则结构符合模型契约。'; return value.map(irregularArrayWarning).find(Boolean); }

export type ParameterEditorKind = 'scalar' | 'sequence' | 'keyvalue' | 'matrix' | 'structured';
export function parameterEditorKind(field: RuntimeField, value?: unknown): ParameterEditorKind {
  if (field.editorHint === 'time_series') return 'sequence';
  if (field.dimension.length === 1 && (objectMapped(field) || isObjectMap(value) || isObjectMap(field.defaultValue) || isObjectMap(field.exampleValue))) return 'keyvalue';
  if (field.dimension.length === 1) return 'sequence';
  if (field.dimension.length === 2) return 'matrix';
  if (field.dimension.length > 2) return 'structured';
  return 'scalar';
}

interface EditorBase { field: RuntimeField; value: unknown; originalValue?: unknown; onChange: (value: unknown, source?: ParameterChangeSource) => void; onValidityChange?: (error?: string) => void }
export type ParameterChangeSource = 'manual' | 'batch' | 'file' | 'restore-default';
interface Props extends EditorBase { expectedLength?: number; timeSet?: string; stateTimeSet?: string | null; intervalMinutes?: number; labelFormat?: string; labelSet?: string; timeLabels?: string[] }

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(cell => String(cell ?? '')).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function StructuredEditor({ field, value, onChange, onValidityChange }: EditorBase) {
  const [text, setText] = useState(() => displayValue(value)); const [warning, setWarning] = useState<string>();
  const committed = useRef(displayValue(value)); const lastField = useRef(field);
  useEffect(() => { const external = displayValue(value); if (lastField.current !== field || external !== committed.current) { setText(external); committed.current = external; setWarning(irregularArrayWarning(value)); onValidityChange?.(); } lastField.current = field; }, [field, value]);
  const update = (next: string) => { setText(next); try { const parsed = JSON.parse(next); const depth = getArrayDepth(parsed); const error = field.dimension.length > 2 && !objectMapped(field) && depth !== field.dimension.length ? `参数 ${field.code} 声明为${field.dimension.length}维结构 [${field.dimension.join(', ')}]，当前输入的嵌套深度为 ${depth}，预期为 ${field.dimension.length}。` : undefined; onValidityChange?.(error); if (!error) { committed.current = displayValue(parsed); setWarning(irregularArrayWarning(parsed)); onChange(parsed); } } catch { onValidityChange?.('请输入有效 JSON'); } };
  return <div className="parameter-structured-editor"><Alert showIcon type="info" title={`维度 [${field.dimension.join(', ')}]，请保持原始${field.dimension.length}维结构。`} /><Input.TextArea className="section-gap-tight" aria-label={`${field.name}高级结构化编辑`} rows={8} value={text} onChange={event => update(event.target.value)} placeholder={field.exampleValue !== undefined ? JSON.stringify(field.exampleValue, null, 2) : '请输入 JSON 结构'} />{warning && <Alert className="section-gap-tight" showIcon type="warning" title={warning} />}</div>;
}

function generatedLabels(dimension: string, count: number, props: Pick<Props, 'timeSet' | 'stateTimeSet' | 'intervalMinutes' | 'labelFormat'>) {
  if (dimension === props.stateTimeSet) return Array.from({ length: count }, (_, index) => index === 0 ? '初始状态' : `时段 ${index} 后`);
  if (dimension === props.timeSet && props.labelFormat === 'HH:mm' && props.intervalMinutes) return Array.from({ length: count }, (_, index) => { const minutes = index * props.intervalMinutes!; return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; });
  return Array.from({ length: count }, (_, index) => dimension === props.timeSet ? `T${index + 1}` : `${dimension} ${index + 1}`);
}

function labelsFor(field: RuntimeField, dimension: string, count: number, props: Pick<Props, 'timeSet' | 'stateTimeSet' | 'intervalMinutes' | 'labelFormat' | 'labelSet' | 'timeLabels'>) {
  const canonicalTimeLabels = field.code !== props.labelSet && dimension === props.timeSet ? props.timeLabels || [] : [];
  if (canonicalTimeLabels.length >= count) return canonicalTimeLabels.slice(0, count);
  const declared = field.dimensionValues?.[dimension] || [];
  if (declared.length >= count) return declared.slice(0, count);
  const generated = generatedLabels(dimension, count, props);
  const isZeroBasedSequence = declared.every((label, index) => label === String(index));
  if ((dimension === props.timeSet || dimension === props.stateTimeSet) && declared.length && isZeroBasedSequence) return Array.from({ length: count }, (_, index) => String(index));
  return [...declared, ...generated.slice(declared.length)];
}

function SequenceEditor(props: Props) {
  const { field, value, originalValue, onChange, expectedLength } = props; const values = Array.isArray(value) ? value : [];
  const [pasteOpen, setPasteOpen] = useState(false);
  const dimension = field.dimension[0];
  const count = Math.max(values.length, expectedLength || 0); const labels = labelsFor(field, dimension, count, props);
  const setValue = (index: number, next: unknown) => { const copy = Array.from({ length: count }, (_, i) => values[i] ?? ''); copy[index] = next; onChange(copy); };
  const type = String(field.type || '').toLowerCase();
  const valueSamples = [values, originalValue, field.defaultValue, field.exampleValue]
    .flatMap(candidate => Array.isArray(candidate) ? candidate : [])
    .filter(candidate => candidate !== undefined && candidate !== null && candidate !== '');
  const usesNumericInput = type.includes('number') || type.includes('float') || type.includes('int') || (valueSamples.length > 0 && valueSamples.every(candidate => typeof candidate === 'number'));
  const numeric = usesNumericInput ? values.map(Number).filter(Number.isFinite) : []; const min = numeric.length ? Math.min(...numeric) : undefined; const max = numeric.length ? Math.max(...numeric) : undefined;
  const importText = (text: string) => onChange(parseRuntimeGrid(text).rows.flat(), 'file');
  const defaultSequence = Array.isArray(field.defaultValue) ? field.defaultValue : Array.isArray(originalValue) ? originalValue : Array(count).fill(field.defaultValue ?? 0);
  const isDimensionSet = field.code === dimension;
  const isTimeLabelSet = Boolean(props.labelSet && field.code === props.labelSet && dimension === props.timeSet);
  const readOnly = field.editable === false;
  const labelTitle = dimension === props.timeSet ? (isTimeLabelSet ? '时段索引' : '时间标签') : dimension === props.stateTimeSet ? '状态时点' : `${dimension} 成员`;
  const valueTitle = isDimensionSet ? `集合成员${readOnly ? '（只读）' : ''}` : isTimeLabelSet ? '时间标签' : `参数值${field.unit ? ` (${field.unit})` : ''}`;
  const sequenceColumns = [
    { title: '序号', dataIndex: 'index', width: 72, render: (item: unknown) => Number(item) + 1 },
    ...(!isDimensionSet ? [{ title: labelTitle, dataIndex: 'label' }] : []),
    { title: valueTitle, render: (_value: unknown, row: { index: number; label: string; value: unknown }) => readOnly
      ? <span>{row.value == null || row.value === '' ? '—' : String(row.value)}</span>
      : usesNumericInput ? <InputNumber aria-label={`${field.name} ${row.label}`} value={typeof row.value === 'number' ? row.value : row.value === '' ? undefined : Number(row.value)} min={field.min} max={field.max} onChange={next => setValue(row.index, next ?? '')} style={{ width: '100%' }} /> : <Input aria-label={`${field.name} ${row.label}`} value={row.value == null ? '' : String(row.value)} onChange={event => setValue(row.index, event.target.value)} style={{ width: '100%' }} /> },
  ];
  return <div className="parameter-sequence-editor">
    {readOnly && isDimensionSet && <Alert className="section-gap-tight" showIcon type="info" title="集合成员由模型契约提供" description={`该集合用于确定关联参数的维度${field.sourceSystem ? `，来源为 ${field.sourceSystem}` : ''}，当前任务中不可修改。`} />}
    {!readOnly && <ParameterToolbar kind="sequence" onBatchPaste={() => setPasteOpen(true)} onCsvImport={importText} onDownload={() => downloadCsv(`${field.code}.csv`, Array.from({ length: expectedLength || values.length || 1 }, () => ['']))} onClear={() => onChange([])} onFillDefault={() => onChange(defaultSequence)} onRestore={originalValue !== undefined ? () => onChange(originalValue, 'restore-default') : undefined} />}
    <Table size="small" pagination={count > 48 ? { pageSize: 24 } : false} rowKey="key" dataSource={Array.from({ length: count }, (_, index) => ({ key: `${field.code}-${index}`, index, label: labels[index], value: values[index] }))} columns={sequenceColumns} />
    {usesNumericInput && <TimeSeriesPreview name={field.name} unit={field.unit} labels={labels.slice(0, values.length)} values={values} />}
    <div className="parameter-editor-meta"><span>当前 {values.length} 点{expectedLength ? ` / 应为 ${expectedLength} 点` : ''}</span>{min !== undefined && <span>最小 {min} · 最大 {max}</span>}<Tag>{field.dimension[0]}</Tag></div>{expectedLength && values.length !== expectedLength && <Alert showIcon type="warning" title={`长度应为 ${expectedLength}，当前为 ${values.length}`} />}
    {!readOnly && pasteOpen && <ParameterBatchPasteModal open title={field.name} mode="sequence" expectedRows={expectedLength} onCancel={() => setPasteOpen(false)} onImport={next => { onChange(next, 'batch'); setPasteOpen(false); }} />}
  </div>;
}

function KeyValueEditor({ field, value, originalValue, onChange, onValidityChange }: Props) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const declared = field.dimensionValues?.[field.dimension[0]] || [];
  const keys = [...declared, ...Object.keys(source).filter(key => !declared.includes(key))];
  const rows = keys.map(key => ({ id: key, key, value: source[key] }));
  const update = (oldKey: string, key: string, item: unknown) => { const next = { ...source }; delete next[oldKey]; if (!key.trim()) return onValidityChange?.('键不能为空'); if (key !== oldKey && Object.prototype.hasOwnProperty.call(source, key)) return onValidityChange?.(`键 ${key} 重复`); next[key] = item; onValidityChange?.(); onChange(next); };
  return <div><div className="parameter-keyvalue-actions"><ParameterToolbar kind="keyvalue" onClear={() => onChange({})} onRestore={originalValue !== undefined ? () => onChange(originalValue, 'restore-default') : undefined} /><Button size="small" onClick={() => { const key = declared.find(item => !(item in source)) || `key_${rows.length + 1}`; onChange({ ...source, [key]: 0 }); }}>新增</Button></div><Table size="small" pagination={false} rowKey="id" dataSource={rows} columns={[{ title: '键', render: (_v, row) => <Input value={row.key} list={`${field.code}-keys`} onChange={event => update(row.key, event.target.value, row.value)} /> }, { title: '值', render: (_v, row) => { const numeric = typeof row.value === 'number' ? row.value : row.value === '' || row.value == null ? undefined : Number(row.value); return <InputNumber value={typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : undefined} min={field.min} max={field.max} onChange={next => update(row.key, row.key, next)} />; } }, { title: '操作', width: 80, render: (_v, row) => <Button type="link" danger onClick={() => { const next = { ...source }; delete next[row.key]; onChange(next); }}>删除</Button> }]} /><datalist id={`${field.code}-keys`}>{declared.map(key => <option key={key}>{key}</option>)}</datalist></div>;
}

function MatrixEditor(props: Props) {
  const { field, value, originalValue, onChange, expectedLength, timeSet, stateTimeSet } = props;
  const [pasteOpen, setPasteOpen] = useState(false); const [focusOpen, setFocusOpen] = useState(false);
  const recordValue = isObjectMap(value) ? value as Record<string, unknown> : undefined;
  const sourceValues = recordValue ? Object.values(recordValue) : Array.isArray(value) ? value : [];
  const nestedObjectRows = Boolean(recordValue && sourceValues.some(isObjectMap));
  const sourceRowLengths = sourceValues.map(row => Array.isArray(row) ? row.length : isObjectMap(row) ? Object.keys(row as Record<string, unknown>).length : 0);
  const nestedColumnLabels = recordValue ? [...new Set(sourceValues.flatMap(row => isObjectMap(row) ? Object.keys(row as Record<string, unknown>) : []))] : [];
  const declaredColumns = field.dimensionValues?.[field.dimension[1]] || [];
  const mappedColumns = [...new Set([...declaredColumns, ...nestedColumnLabels])];
  const timeAxis = field.dimension.findIndex(dimension => dimension === timeSet || dimension === stateTimeSet);
  const expectedRows = timeAxis === 0 ? expectedLength || 0 : 0; const expectedColumns = timeAxis === 1 ? expectedLength || 0 : 0;
  const rowCount = expectedRows || Math.max(sourceValues.length, field.dimensionValues?.[field.dimension[0]]?.length || 0);
  const columnCount = expectedColumns || Math.max(1, ...sourceRowLengths, mappedColumns.length);
  const baseRowLabels = labelsFor(field, field.dimension[0], rowCount, props);
  const mappedRowLabels = recordValue ? [...new Set([...(field.dimensionValues?.[field.dimension[0]] || []), ...Object.keys(recordValue)])] : [];
  const rowLabels = recordValue ? Array.from({ length: rowCount }, (_, index) => mappedRowLabels[index] || baseRowLabels[index]) : baseRowLabels;
  const columns = nestedColumnLabels.length
    ? mappedColumns.slice(0, columnCount)
    : labelsFor(field, field.dimension[1], columnCount, props);
  const matrix = Array.from({ length: rowCount }, (_, row) => {
    const source = recordValue ? recordValue[rowLabels[row]] : sourceValues[row];
    return Array.from({ length: columnCount }, (_, column) => Array.isArray(source)
      ? source[column] ?? ''
      : isObjectMap(source) ? (source as Record<string, unknown>)[columns[column]] ?? '' : '');
  });
  const actualTimeLength = timeAxis === 0 ? sourceValues.length : timeAxis === 1 ? Math.max(0, ...sourceRowLengths) : undefined;
  const timeLengthMismatch = expectedLength !== undefined && actualTimeLength !== undefined && actualTimeLength !== expectedLength;
  const strategy = runtimeGridStrategy(rowCount * columnCount);
  const serialize = (next: unknown[][]) => recordValue
    ? Object.fromEntries(next.map((row, index) => [rowLabels[index], nestedObjectRows ? Object.fromEntries(row.map((item, column) => [columns[column], item])) : row]))
    : next;
  const update = (r: number, c: number, next: unknown) => { const copy = matrix.map(row => [...row]); copy[r][c] = next; onChange(serialize(copy)); };
  const importText = (text: string) => onChange(serialize(parseRuntimeGrid(text).rows), 'file');
  const defaultCell = typeof field.defaultValue === 'number' ? field.defaultValue : 0;
  const structuralDefault = field.defaultValue !== undefined ? field.defaultValue : originalValue;
  const fillDefault = () => structuralDefault && typeof structuralDefault === 'object'
    ? onChange(structuralDefault)
    : onChange(serialize(Array.from({ length: rowCount }, () => Array(columnCount).fill(defaultCell))));
  return <div className="parameter-matrix-editor">
    <ParameterToolbar kind="matrix" onBatchPaste={() => setPasteOpen(true)} onCsvImport={importText} onDownload={() => downloadCsv(`${field.code}.csv`, Array.from({ length: rowCount || 1 }, () => Array(columnCount).fill('')))} onClear={() => onChange(serialize(Array.from({ length: rowCount }, () => [])))} onFillDefault={fillDefault} onRestore={originalValue !== undefined ? () => onChange(originalValue, 'restore-default') : undefined} onCopyPreviousRow={rowCount > 1 ? () => onChange(serialize(matrix.map((row, index) => index === rowCount - 1 ? [...matrix[index - 1]] : row))) : undefined} onFocus={() => setFocusOpen(true)} />
    <div className="parameter-editor-meta"><span>{rowCount} 行 × {columnCount} 列</span><Tag>行：{field.dimension[0]}</Tag><Tag>列：{field.dimension[1]}</Tag>{strategy === 'focus' && <span className="parameter-scale-note">中型矩阵，建议使用聚焦编辑</span>}{strategy === 'import' && <span className="parameter-scale-note warning">超过 5,000 单元格，优先使用 CSV 导入</span>}</div>
    {timeLengthMismatch && <Alert className="section-gap-tight" type="warning" showIcon title={actualTimeLength! < expectedLength! ? `当前 ${field.dimension[timeAxis]} 维度为 ${actualTimeLength}，应为 ${expectedLength}；新增时段已显示，请补充相应数值。` : `当前 ${field.dimension[timeAxis]} 维度为 ${actualTimeLength}，应为 ${expectedLength}；请先确认是否需要截断尾部时段数据。`} />}
    {strategy !== 'import' ? <Table className="parameter-matrix-table" size="small" pagination={rowCount > 30 ? { pageSize: 20 } : false} scroll={{ x: Math.max(520, columnCount * 110) }} rowKey="key" dataSource={Array.from({ length: rowCount }, (_, index) => ({ key: `${field.code}-${index}`, index, label: rowLabels[index] }))} columns={[{ title: field.dimension[0], dataIndex: 'label', width: 130 }, ...columns.map((label, column) => ({ title: label, width: 110, render: (_v: unknown, row: { index: number }) => <InputNumber aria-label={`${field.name} ${rowLabels[row.index]} ${label}`} value={typeof matrix[row.index]?.[column] === 'number' ? matrix[row.index][column] : undefined} onChange={next => update(row.index, column, next ?? '')} /> }))]} /> : <Alert type="info" showIcon title="大矩阵已关闭内嵌完整渲染" description="请使用 CSV 导入、批量粘贴或高级 JSON；聚焦编辑仍可按需打开。" />}
    {pasteOpen && <ParameterBatchPasteModal open title={field.name} mode="matrix" expectedRows={rowCount || undefined} expectedColumns={columnCount || undefined} onCancel={() => setPasteOpen(false)} onImport={next => { onChange(serialize(next as unknown[][]), 'batch'); setPasteOpen(false); }} />}
    {focusOpen && <FullscreenMatrixEditor open field={field} value={matrix} rowLabels={rowLabels} columnLabels={columns} onCancel={() => setFocusOpen(false)} onSave={next => { onChange(serialize(next)); setFocusOpen(false); }} />}
  </div>;
}

export function ParameterEditor(props: Props) {
  const { field, value, onChange, onValidityChange } = props; const kind = parameterEditorKind(field, value); const type = String(field.type || '').toLowerCase();
  useEffect(() => onValidityChange?.(), [field.code]);
  if (field.enumValues?.length) return <Select aria-label={field.name} value={value} onChange={next => onChange(next)} options={field.enumValues.map(item => ({ value: item, label: String(item) }))} />;
  if (type.includes('bool') || typeof field.defaultValue === 'boolean') return <Checkbox checked={Boolean(value)} onChange={event => onChange(event.target.checked)}>启用</Checkbox>;
  if (kind === 'scalar' && (type.includes('number') || type.includes('float') || type.includes('int') || typeof field.defaultValue === 'number')) return <InputNumber aria-label={field.name} value={typeof value === 'number' ? value : undefined} min={field.min} max={field.max} onChange={next => onChange(next)} style={{ width: '100%' }} />;
  if (kind === 'sequence') return <SequenceEditor {...props} />;
  if (kind === 'keyvalue') return <KeyValueEditor {...props} />;
  if (kind === 'matrix') return <MatrixEditor {...props} />;
  if (kind === 'structured' || type.includes('object') || type.includes('json') || (value !== null && typeof value === 'object')) return <StructuredEditor {...props} />;
  return <Input aria-label={field.name} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value)} />;
}
