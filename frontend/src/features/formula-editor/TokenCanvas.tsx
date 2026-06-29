import { Button, Space } from 'antd';
import type { FormulaToken } from '../../types/formula';
import type { FormulaSymbols } from './formulaParser';
import { tokenToDisplay } from './formulaDsl';
import { AggregateBlock } from './AggregateBlock';

export function TokenCanvas({
  tokens,
  selectedIndex,
  symbols = {},
  onSelect,
  onRemove,
  onMove,
  onUpdate,
}: {
  tokens: FormulaToken[];
  selectedIndex?: number;
  symbols?: FormulaSymbols;
  onSelect?: (i: number) => void;
  onRemove?: (i: number) => void;
  onMove?: (from: number, to: number) => void;
  onUpdate?: (i: number, token: FormulaToken) => void;
}) {
  return (
    <div className="token-canvas" data-testid="token-canvas">
      {tokens.length === 0 && <span style={{ color: '#8c8c8c' }}>从工具栏插入变量、参数、集合、聚合块或运算符</span>}
      {tokens.map((t, i) => (
        <div className={`formula-token-wrap ${selectedIndex === i ? 'selected' : ''}`} key={i}>
          {selectedIndex === i && <span className="formula-insert-cursor" aria-label="当前插入位置" />}
          {t.type === 'aggregate' ? (
            <AggregateBlock token={t} symbols={symbols} onChange={token => onUpdate?.(i, token)} onSelect={() => onSelect?.(i)} />
          ) : (
            <button type="button" className="formula-token" onClick={() => onSelect?.(i)}>{tokenToDisplay(t)}</button>
          )}
          <Space size={4}>
            <Button size="small" disabled={i === 0} onClick={() => onMove?.(i, i - 1)}>上移</Button>
            <Button size="small" disabled={i === tokens.length - 1} onClick={() => onMove?.(i, i + 1)}>下移</Button>
            <Button size="small" danger onClick={() => onRemove?.(i)}>删除</Button>
          </Space>
        </div>
      ))}
    </div>
  );
}
