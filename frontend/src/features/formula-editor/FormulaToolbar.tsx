import { Button, Input, InputNumber, Select, Space, Tabs, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { FormulaToken, SymbolKind } from '../../types/formula';
import type { FormulaSymbols } from './formulaParser';
import { getFormulaSymbolDictionary, symbolItemToToken } from './formulaDictionary';

function aliasForSet(setCode: string) {
  if (setCode === 'unit') return 'u';
  if (setCode === 'storage') return 's';
  if (setCode === 'hydro_station') return 'h';
  return 't';
}

export function FormulaToolbar({
  symbols,
  onInsert,
  compact = false,
}: {
  symbols: FormulaSymbols;
  onInsert: (t: FormulaToken) => void;
  compact?: boolean;
}) {
  const [num, setNum] = useState(1);
  const [keyword, setKeyword] = useState('');
  const dictionary = useMemo(() => getFormulaSymbolDictionary({ symbols }), [symbols]);
  const matches = (item: { code: string; name: string; description?: string }) => `${item.name} ${item.code} ${item.description || ''}`.toLowerCase().includes(keyword.toLowerCase());
  const optionOf = (type: SymbolKind) => dictionary
    .filter(item => item.type === type && matches(item))
    .map(item => ({
      value: item.code,
      label: `${item.name} ${item.code}${item.indices?.length ? ` [${item.indices.join(',')}]` : ''}${item.unit ? ` ${item.unit}` : ''}`,
      searchText: `${item.name} ${item.code} ${item.description || ''}`,
    }));
  const itemsOf = (type: SymbolKind) => dictionary.filter(item => item.type === type && matches(item)).slice(0, 8);
  const insertSymbol = (type: SymbolKind, code: string) => {
    const item = dictionary.find(entry => entry.type === type && entry.code === code);
    if (item) onInsert(symbolItemToToken(item));
  };
  const setCode = Object.keys(symbols.sets || {})[0] || 'time';

  return (
    <Space orientation="vertical" size={compact ? 8 : 12} style={{ width: '100%' }}>
      {!compact && <Typography.Text type="secondary">点击对象后插入到当前光标位置；未选择位置时追加到末尾。</Typography.Text>}
      <Input allowClear placeholder="搜索对象编码或中文名" value={keyword} onChange={event => setKeyword(event.target.value)} />
      <Tabs
        size="small"
        items={[
          {
            key: 'sets',
            label: '集合',
            children: <SymbolPicker type="set" options={optionOf('set')} items={itemsOf('set')} onInsert={insertSymbol} onToken={onInsert} />,
          },
          {
            key: 'variables',
            label: '变量',
            children: <SymbolPicker type="variable" options={optionOf('variable')} items={itemsOf('variable')} onInsert={insertSymbol} onToken={onInsert} />,
          },
          {
            key: 'parameters',
            label: '参数',
            children: <SymbolPicker type="parameter" options={optionOf('parameter')} items={itemsOf('parameter')} onInsert={insertSymbol} onToken={onInsert} />,
          },
          {
            key: 'operators',
            label: '运算符',
            children: (
              <Space wrap>
                {['+', '-', '*', '/', '>=', '<=', '==', '!='].map(op => <Button key={op} onClick={() => onInsert({ type: 'operator', code: op, label: op })}>{op}</Button>)}
                <InputNumber value={num} onChange={x => setNum(x || 0)} style={{ width: 76 }} />
                <Button onClick={() => onInsert({ type: 'number', value: num })}>常量</Button>
                <Button onClick={() => onInsert({ type: 'parameter', code: 'M', label: 'Big-M' })}>Big-M</Button>
              </Space>
            ),
          },
          {
            key: 'functions',
            label: '函数',
            children: (
              <Space wrap>
                {(['sum', 'min', 'max'] as const).map(fn => (
                  <Button key={fn} onClick={() => onInsert({ type: 'aggregate', fn, setCode, alias: aliasForSet(setCode), bodyTokens: [] })}>{fn} 聚合块</Button>
                ))}
                {(['abs', 'piecewise'] as const).map(fn => <Button key={fn} onClick={() => onInsert({ type: 'function', fn, bodyTokens: [] })}>{fn}</Button>)}
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}

function SymbolPicker({
  type,
  options,
  items,
  onInsert,
  onToken,
}: {
  type: SymbolKind;
  options: Array<{ value: string; label: string; searchText: string }>;
  items: ReturnType<typeof getFormulaSymbolDictionary>;
  onInsert: (type: SymbolKind, code: string) => void;
  onToken: (token: FormulaToken) => void;
}) {
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Select showSearch optionFilterProp="searchText" style={{ width: '100%' }} placeholder="选择对象" options={options} onChange={code => onInsert(type, code)} />
      <Space wrap>{items.map(item => <Button size="small" key={item.code} onClick={() => onToken(symbolItemToToken(item))}>{item.name} {item.code}</Button>)}</Space>
    </Space>
  );
}
