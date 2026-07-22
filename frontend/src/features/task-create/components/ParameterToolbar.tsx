import { Button, Space, message } from 'antd';
import { DownloadOutlined, FullscreenOutlined, UploadOutlined } from '@ant-design/icons';
import { useRef } from 'react';

export function ParameterToolbar({ kind, onBatchPaste, onCsvImport, onDownload, onClear, onFillDefault, onRestore, onFocus, onCopyPreviousRow, onAdvanced }: {
  kind: 'sequence' | 'matrix' | 'keyvalue'; onBatchPaste?: () => void; onCsvImport?: (text: string) => void; onDownload?: () => void; onClear?: () => void;
  onFillDefault?: () => void; onRestore?: () => void; onFocus?: () => void; onCopyPreviousRow?: () => void; onAdvanced?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <Space className="parameter-toolbar" size={4} wrap>
    {kind === 'keyvalue' && <span className="parameter-toolbar-label">参数操作</span>}
    {onBatchPaste && <Button size="small" onClick={onBatchPaste}>批量粘贴</Button>}
    {onCsvImport && <><Button size="small" icon={<UploadOutlined />} onClick={() => input.current?.click()}>CSV 导入</Button><input ref={input} hidden type="file" accept=".csv,text/csv" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { onCsvImport(await file.text()); } catch { message.error('CSV 文件读取失败'); } event.target.value = ''; }} /></>}
    {onDownload && <Button size="small" icon={<DownloadOutlined />} onClick={onDownload}>下载模板</Button>}
    {onClear && <Button size="small" onClick={onClear}>清空</Button>}
    {onFillDefault && <Button size="small" onClick={onFillDefault}>填充默认值</Button>}
    {onRestore && <Button size="small" onClick={onRestore}>恢复原值</Button>}
    {onCopyPreviousRow && <Button size="small" onClick={onCopyPreviousRow}>复制上一行</Button>}
    {onFocus && <Button size="small" icon={<FullscreenOutlined />} onClick={onFocus}>聚焦编辑</Button>}
    {onAdvanced && <Button size="small" onClick={onAdvanced}>高级 JSON</Button>}
  </Space>;
}
