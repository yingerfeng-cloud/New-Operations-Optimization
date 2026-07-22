import { Alert, Button, InputNumber, Modal, Select, Space, Table } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { RuntimeField } from '../../time-dimension';
import { ParameterBatchPasteModal } from './ParameterBatchPasteModal';

export function FullscreenMatrixEditor({ open, field, value, rowLabels, columnLabels, onCancel, onSave }: {
  open: boolean; field: RuntimeField; value: unknown; rowLabels: string[]; columnLabels: string[]; onCancel: () => void; onSave: (value: unknown[][]) => void;
}) {
  const normalize = () => Array.from({ length: rowLabels.length }, (_, row) => Array.from({ length: columnLabels.length }, (_, column) => Array.isArray(value) && Array.isArray(value[row]) ? value[row][column] ?? '' : ''));
  const [draft, setDraft] = useState<unknown[][]>(normalize);
  const [selectedRow, setSelectedRow] = useState(0); const [selectedColumn, setSelectedColumn] = useState(0); const [pasteOpen, setPasteOpen] = useState(false);
  useEffect(() => { if (open) setDraft(normalize()); }, [open, value, rowLabels.length, columnLabels.length]);
  const missing = useMemo(() => draft.flat().filter(cell => cell === '' || cell === null || cell === undefined).length, [draft]);
  const update = (row: number, column: number, next: unknown) => setDraft(current => current.map((items, r) => r === row ? items.map((item, c) => c === column ? next : item) : items));
  const rowData = rowLabels.map((label, index) => ({ key: index, index, label }));
  return <>
    <Modal className="fullscreen-matrix-modal" title={`${field.name} · 聚焦矩阵编辑`} open={open} width="calc(100vw - 32px)" style={{ top: 16 }} onCancel={onCancel} footer={<><Button onClick={onCancel}>取消并放弃</Button><Button type="primary" onClick={() => onSave(draft)}>保存并返回</Button></>}>
      <div className="fullscreen-editor-header"><div><strong>{rowLabels.length} 行 × {columnLabels.length} 列</strong><span>行：{field.dimension[0]} · 列：{field.dimension[1]} · 缺失 {missing}</span></div><Space wrap>
        <Button onClick={() => setPasteOpen(true)}>粘贴矩形数据</Button>
        <Select value={selectedRow} onChange={setSelectedRow} options={rowLabels.map((label, value) => ({ value, label }))} />
        <Button disabled={selectedRow === 0} onClick={() => setDraft(current => current.map((row, index) => index === selectedRow ? [...current[selectedRow - 1]] : row))}>复制上一行</Button>
        <Button onClick={() => setDraft(current => current.map((row, index) => index === selectedRow ? row.map(() => '') : row))}>清空行</Button>
        <Select value={selectedColumn} onChange={setSelectedColumn} options={columnLabels.map((label, value) => ({ value, label }))} />
        <Button onClick={() => setDraft(current => current.map(row => row.map((cell, column) => column === selectedColumn ? '' : cell)))}>清空列</Button>
      </Space></div>
      {missing > 0 && <Alert className="section-gap-tight" type="warning" showIcon title={`有 ${missing} 个缺失值，已在表格中高亮`} />}
      <Table className="fullscreen-matrix-table" size="small" sticky pagination={rowLabels.length > 50 ? { pageSize: 50, showSizeChanger: false } : false} scroll={{ x: Math.max(720, columnLabels.length * 116), y: 'calc(100vh - 300px)' }} dataSource={rowData} columns={[{ title: field.dimension[0], dataIndex: 'label', fixed: 'left', width: 140 }, ...columnLabels.map((label, column) => ({ title: label, width: 116, render: (_: unknown, row: { index: number }) => { const cell = draft[row.index]?.[column]; return <div className={cell === '' || cell == null ? 'matrix-cell-missing' : ''}><InputNumber aria-label={`${field.name} ${rowLabels[row.index]} ${label}`} value={typeof cell === 'number' ? cell : undefined} onChange={next => update(row.index, column, next ?? '')} /></div>; } }))]} />
    </Modal>
    {pasteOpen && <ParameterBatchPasteModal open title={field.name} mode="matrix" expectedRows={rowLabels.length} expectedColumns={columnLabels.length} onCancel={() => setPasteOpen(false)} onImport={next => { setDraft(next as unknown[][]); setPasteOpen(false); }} />}
  </>;
}
