import { Input, Select, Space, Tag } from 'antd';
import type { AggregateToken, FormulaToken } from '../../types/formula';
import type { FormulaSymbols } from './formulaParser';
import { FormulaToolbar } from './FormulaToolbar';
import { TokenCanvas } from './TokenCanvas';

export function AggregateBlock({
  token,
  symbols = {},
  onChange,
  onSelect,
}: {
  token: AggregateToken;
  symbols?: FormulaSymbols;
  onChange?: (token: AggregateToken) => void;
  onSelect?: () => void;
}) {
  const setOptions = Object.entries(symbols.sets || {}).map(([value, label]) => ({ value, label: `${label} ${value}` }));
  const updateBody = (bodyTokens: FormulaToken[]) => onChange?.({ ...token, bodyTokens });
  const insertBodyToken = (bodyToken: FormulaToken) => updateBody([...token.bodyTokens, bodyToken]);
  return (
    <div className="aggregate-token" onClick={onSelect}>
      <Space wrap>
        <Tag color="green">{token.fn === 'sum' ? 'Σ' : token.fn}</Tag>
        <Select
          size="small"
          style={{ width: 180 }}
          aria-label="聚合集合"
          value={token.setCode}
          options={setOptions}
          onChange={setCode => onChange?.({ ...token, setCode })}
        />
        <Input
          size="small"
          aria-label="聚合别名"
          style={{ width: 72 }}
          value={token.alias}
          onChange={event => onChange?.({ ...token, alias: event.target.value })}
        />
      </Space>
      <TokenCanvas
        tokens={token.bodyTokens}
        symbols={symbols}
        onRemove={index => updateBody(token.bodyTokens.filter((_, itemIndex) => itemIndex !== index))}
        onMove={(from, to) => {
          const next = [...token.bodyTokens];
          [next[from], next[to]] = [next[to], next[from]];
          updateBody(next);
        }}
        onUpdate={(index, nextToken) => updateBody(token.bodyTokens.map((item, itemIndex) => itemIndex === index ? nextToken : item))}
      />
      <FormulaToolbar symbols={symbols} compact onInsert={insertBodyToken} />
    </div>
  );
}
