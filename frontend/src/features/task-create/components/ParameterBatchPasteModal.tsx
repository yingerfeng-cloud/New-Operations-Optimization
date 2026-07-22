import { Alert, Descriptions, Input, Modal } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { parseRuntimeGrid, validateRuntimeGrid } from '../utils/runtimeParameterImport';

export function ParameterBatchPasteModal({ open, title, mode, expectedRows, expectedColumns, onCancel, onImport }: {
  open: boolean; title: string; mode: 'sequence' | 'matrix'; expectedRows?: number; expectedColumns?: number; onCancel: () => void; onImport: (value: unknown) => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => { if (!open) setText(''); }, [open]);
  const parsed = useMemo(() => parseRuntimeGrid(text), [text]);
  const sequenceCount = parsed.rows.flat().length;
  const errors = mode === 'sequence'
    ? [...parsed.errors, ...(expectedRows !== undefined && sequenceCount !== expectedRows ? [`期望 ${expectedRows} 个值，识别到 ${sequenceCount} 个`] : []), ...(parsed.rows.flat().some(value => value !== '' && typeof value !== 'number') ? ['包含非数字单元格'] : [])]
    : validateRuntimeGrid(parsed, expectedRows, expectedColumns);
  return <Modal title={`批量粘贴 · ${title}`} open={open} onCancel={onCancel} okText="确认导入" cancelText="取消" okButtonProps={{ disabled: !text.trim() || errors.length > 0 }} onOk={() => onImport(mode === 'sequence' ? parsed.rows.flat() : parsed.rows)}>
    <Input.TextArea autoFocus aria-label={`${title}批量输入`} rows={9} value={text} onChange={event => setText(event.target.value)} placeholder={mode === 'sequence' ? '每行一个值，或从 Excel 复制单列/多行数据' : '从 Excel 复制矩形区域，支持 Tab 或逗号分隔'} />
    <Descriptions className="section-gap-tight" size="small" column={2} items={[{ key: 'rows', label: '识别行数', children: parsed.rowCount }, { key: 'columns', label: '识别列数', children: parsed.columnCount }, { key: 'expected', label: '预期规模', children: mode === 'sequence' ? `${expectedRows ?? '不限'} 个值` : `${expectedRows ?? '不限'} × ${expectedColumns ?? '不限'}` }, { key: 'actual', label: '实际规模', children: mode === 'sequence' ? `${sequenceCount} 个值` : `${parsed.rowCount} × ${parsed.columnCount}` }]} />
    {errors.length > 0 && <Alert type="error" showIcon title="数据暂不能导入" description={errors.join('；')} />}
    {!errors.length && text.trim() && <Alert type="success" showIcon title="格式校验通过" />}
  </Modal>;
}
