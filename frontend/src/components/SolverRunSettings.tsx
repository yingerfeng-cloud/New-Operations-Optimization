import { Collapse, Input, InputNumber, Space, Typography } from 'antd';

export function SolverRunSettings({ value = {}, onChange, disabled }: { value?: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void; disabled?: boolean }) {
  const update = (key: string, item: unknown) => {
    const next = { ...value };
    if (item === null || item === undefined || item === '') delete next[key]; else next[key] = item;
    onChange(next);
  };
  return <Collapse items={[{ key: 'solver-options', label: '求解运行设置', children: <Space orientation="vertical" style={{ width: '100%' }}>
    <Typography.Text type="secondary">设置随本次任务保存。初值可以是变量名对应的标量（应用到所有索引），或索引到数值的映射；越界初值会明确拒绝。</Typography.Text>
    <Space wrap>
      <label>时限（秒）<InputNumber aria-label="求解时限（秒）" disabled={disabled} min={.001} value={value.time_limit as number | undefined} placeholder="300" onChange={next => update('time_limit', next)} /></label>
      <label>最大迭代<InputNumber aria-label="最大迭代" disabled={disabled} min={1} precision={0} value={value.max_iter as number | undefined} onChange={next => update('max_iter', next)} /></label>
      <label>NLP 容差<InputNumber aria-label="NLP 容差" disabled={disabled} min={1e-12} value={value.nlp_tolerance as number | undefined} onChange={next => update('nlp_tolerance', next)} /></label>
    </Space>
    <label style={{ width: '100%' }}>变量初值（JSON）<Input.TextArea aria-label="变量初值（JSON）" disabled={disabled} rows={3} defaultValue={JSON.stringify(value.initial_values || {}, null, 2)} placeholder={'{"flow":2.5,"head":5}'} onChange={event => update('initial_values', event.target.value)} onBlur={event => {
      try { const parsed: unknown = JSON.parse(event.target.value || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { update('initial_values', parsed); event.target.setCustomValidity(''); } else throw new Error(); }
      catch { event.target.setCustomValidity('初值必须为合法 JSON 对象'); event.target.reportValidity(); }
    }} /></label>
  </Space> }]} />;
}
