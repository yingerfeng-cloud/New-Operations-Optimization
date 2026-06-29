import { Input } from 'antd';

export function DslDebugPanel({
  value,
  onChange,
  label = '公式表达式',
  placeholder = '例如：sum(unit_output[u,t] for u in unit) >= load_forecast[t]',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
}) {
  return <Input.TextArea aria-label={label} value={value} onChange={e => onChange(e.target.value)} rows={5} placeholder={placeholder} />;
}
