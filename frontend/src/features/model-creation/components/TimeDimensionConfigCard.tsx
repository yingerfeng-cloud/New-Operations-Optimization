import { Alert, Button, Card, Form, Input, InputNumber, Segmented, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { ModelDraft, TimeDimensionConfig } from '../stores/modelCreationStore';
import { applyTimeDimensionToDraft, findTimeSetReferences, normalizeTimeDimensionConfig, normalizeTimeDimensionForMode, timeDimensionReferences } from '../utils/timeDimensionDraft';
import { extractDimensions } from '../utils/modelDimensions';

type HorizonMode = 'fixed' | 'free' | 'choice' | 'data_derived';

function modeFrom(config: TimeDimensionConfig): HorizonMode {
  if (config.policy === 'data_derived') return 'data_derived';
  if (config.policy === 'runtime_variable') return config.allowed_horizons?.length ? 'choice' : 'free';
  return 'fixed';
}

function candidateErrors(config: TimeDimensionConfig) {
  const errors: string[] = [];
  const allowed = config.allowed_horizons || [];
  if (!allowed.length) errors.push('至少配置一个候选 horizon。');
  if (new Set(allowed).size !== allowed.length) errors.push('候选 horizon 不允许重复。');
  if (config.default_horizon && !allowed.includes(config.default_horizon)) errors.push('默认 horizon 必须属于候选值。');
  for (const horizon of allowed) {
    const interval = config.interval_minutes_by_horizon?.[String(horizon)];
    const delta = config.delta_t_by_horizon?.[String(horizon)];
    if (!interval || interval <= 0) errors.push(`${horizon} 点的时间粒度必须大于 0。`);
    if (!delta || delta <= 0) errors.push(`${horizon} 点的 delta_t 必须大于 0。`);
    if (interval && delta && Math.abs(delta - interval / 60) > 1e-8) errors.push(`${horizon} 点的 delta_t 应等于时间粒度 / 60。`);
  }
  return errors;
}

export function TimeDimensionConfigCard({ draft, onChange }: { draft: ModelDraft; onChange: (draft: ModelDraft) => void }) {
  const config = draft.time_dimension;
  const references = timeDimensionReferences(draft, config);
  const [blockedMessage, setBlockedMessage] = useState('');
  const update = (next: Partial<TimeDimensionConfig>) => {
    const normalized = normalizeTimeDimensionConfig({ ...config, ...next });
    onChange(applyTimeDimensionToDraft(draft, normalized));
  };
  const blockSetChange = (setCode: string | null | undefined, action: () => void) => {
    if (!setCode) return action();
    const refs = findTimeSetReferences(draft, setCode);
    if (!refs.length) return action();
    const parameterCount = refs.filter(item => item.type === 'parameter').length;
    const variableCount = refs.filter(item => item.type === 'variable').length;
    setBlockedMessage(`当前有 ${parameterCount} 个参数和 ${variableCount} 个变量引用 ${setCode}，请先修改这些维度。`);
  };
  const toggleEnabled = (enabled: boolean) => {
    if (!enabled && references.count) {
      setBlockedMessage(`当前有 ${references.parameters.length} 个参数、${references.variables.length} 个变量和 ${references.formulas.length} 个公式引用时间集合，请先解除这些引用。`);
      return;
    }
    setBlockedMessage('');
    update(enabled ? {
      enabled: true,
      policy: 'fixed',
      editable: false,
      default_horizon: config.default_horizon || 24,
      time_set: config.time_set || 'time',
      state_time_set: config.state_time_set === undefined ? 'time_volume' : config.state_time_set,
      interval_minutes: config.interval_minutes || 60,
    } : { enabled: false, policy: 'not_applicable', editable: false });
  };

  const mode = modeFrom(config);
  const allowed = config.allowed_horizons || [];
  const deriveOptions = draft.semantic.parameters.filter(parameter => {
    const source = parameter.sourceType || parameter.source_type || 'runtime';
    const dimensions = extractDimensions(parameter as unknown as Record<string, unknown>);
    return source === 'runtime' && dimensions.includes(config.time_set || 'time');
  }).map(parameter => ({ value: parameter.code, label: `${parameter.name || parameter.code} (${parameter.code})` }));
  const setOptions = draft.semantic.sets.map(item => ({ value: item.code, label: `${item.name || item.code} (${item.code})` }));
  const errors = mode === 'choice' ? candidateErrors(config) : [];

  const updateCandidate = (oldHorizon: number, field: 'horizon' | 'interval' | 'delta', value: number | null) => {
    if (!value || value <= 0) return;
    if (field === 'horizon' && value !== oldHorizon && allowed.includes(value)) {
      setBlockedMessage(`候选 horizon=${value} 已存在，不允许重复。`);
      return;
    }
    setBlockedMessage('');
    const nextHorizon = field === 'horizon' ? value : oldHorizon;
    const nextAllowed = allowed.map(item => item === oldHorizon ? nextHorizon : item).sort((a, b) => a - b);
    const intervals = { ...(config.interval_minutes_by_horizon || {}) };
    const deltas = { ...(config.delta_t_by_horizon || {}) };
    if (field === 'horizon') {
      intervals[String(nextHorizon)] = intervals[String(oldHorizon)];
      deltas[String(nextHorizon)] = deltas[String(oldHorizon)];
      delete intervals[String(oldHorizon)];
      delete deltas[String(oldHorizon)];
    } else if (field === 'interval') intervals[String(oldHorizon)] = value;
    else deltas[String(oldHorizon)] = value;
    update({ allowed_horizons: nextAllowed, interval_minutes_by_horizon: intervals, delta_t_by_horizon: deltas, default_horizon: config.default_horizon === oldHorizon ? nextHorizon : config.default_horizon });
  };

  return (
    <Card className="section-gap" title="时间维度配置" extra={<Space><Typography.Text type="secondary">是否启用时间维度</Typography.Text><Switch aria-label="是否启用时间维度" checked={config.enabled} onChange={toggleEnabled} /></Space>}>
      {blockedMessage && <Alert className="section-gap-tight" showIcon type="error" title={blockedMessage} />}
      {!config.enabled ? <Alert showIcon type="info" title="非时序模型" description="模型不会生成时间集合，也不会在任务中心展示 horizon。" /> : (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Form layout="vertical">
            <Space wrap align="start" size={16}>
              <Form.Item label="时间点集合" required>
                <Select mode="tags" maxCount={1} style={{ width: 220 }} value={[config.time_set || 'time']} options={setOptions} onChange={value => blockSetChange(config.time_set || 'time', () => update({ time_set: value.at(-1) || 'time' }))} />
              </Form.Item>
              <Form.Item label="使用状态时点集合">
                <Switch aria-label="使用状态时点集合" checked={Boolean(config.state_time_set)} onChange={checked => checked ? update({ state_time_set: 'time_volume' }) : blockSetChange(config.state_time_set, () => update({ state_time_set: null }))} />
              </Form.Item>
              {config.state_time_set && <Form.Item label="状态时点集合"><Select mode="tags" maxCount={1} style={{ width: 220 }} value={[config.state_time_set]} options={setOptions} onChange={value => blockSetChange(config.state_time_set, () => update({ state_time_set: value.at(-1) || null }))} /></Form.Item>}
            </Space>
            <Form.Item label="horizon 策略">
              <Segmented value={mode} onChange={value => onChange(applyTimeDimensionToDraft(draft, normalizeTimeDimensionForMode(config, value as HorizonMode)))} options={[
                { label: '固定时段', value: 'fixed' },
                { label: '运行时自由调整', value: 'free' },
                { label: '候选时段切换', value: 'choice' },
                { label: '由输入数据推导', value: 'data_derived' },
              ]} />
            </Form.Item>
            {mode === 'fixed' && <Space wrap align="start"><Form.Item label="默认 horizon" required><InputNumber min={1} value={config.default_horizon} onChange={value => update({ default_horizon: value || undefined })} /></Form.Item><Form.Item label="时间粒度（分钟）"><InputNumber min={0.0001} value={config.interval_minutes} onChange={value => update({ interval_minutes: value || undefined, delta_t: value ? value / 60 : undefined })} /></Form.Item><Form.Item label="delta_t"><InputNumber min={0.0001} value={config.delta_t} onChange={value => update({ delta_t: value || undefined })} /></Form.Item><Form.Item label="任务中心"><Tag>只读展示</Tag></Form.Item></Space>}
            {mode === 'free' && <Space wrap align="start"><Form.Item label="默认 horizon" required><InputNumber min={1} value={config.default_horizon} onChange={value => update({ default_horizon: value || undefined })} /></Form.Item><Form.Item label="最小 horizon"><InputNumber min={1} value={config.min_horizon} onChange={value => update({ min_horizon: value || undefined })} /></Form.Item><Form.Item label="最大 horizon"><InputNumber min={1} value={config.max_horizon} onChange={value => update({ max_horizon: value || undefined })} /></Form.Item><Form.Item label="步长"><InputNumber min={1} value={config.horizon_step} onChange={value => update({ horizon_step: value || undefined })} /></Form.Item><Form.Item label="默认时间粒度"><InputNumber min={0.0001} value={config.interval_minutes} onChange={value => update({ interval_minutes: value || undefined, delta_t: value ? value / 60 : undefined })} /></Form.Item><Form.Item label="delta_t"><InputNumber min={0.0001} value={config.delta_t} onChange={value => update({ delta_t: value || undefined })} /></Form.Item></Space>}
            {mode === 'choice' && <>
              <Form.Item label="默认 horizon" required><Select style={{ width: 220 }} value={config.default_horizon} options={allowed.map(item => ({ value: item, label: `${item} 点` }))} onChange={value => update({ default_horizon: value })} /></Form.Item>
              {errors.length > 0 && <Alert className="section-gap-tight" showIcon type="error" title="候选时段配置不完整" description={errors.join('；')} />}
              <Table size="small" pagination={false} rowKey="horizon" dataSource={allowed.map(horizon => ({ horizon, interval: config.interval_minutes_by_horizon?.[String(horizon)], delta: config.delta_t_by_horizon?.[String(horizon)] }))} columns={[
                { title: 'horizon', dataIndex: 'horizon', render: (value: number) => <InputNumber min={1} value={value} onChange={next => updateCandidate(value, 'horizon', next)} /> },
                { title: '时间粒度（分钟）', dataIndex: 'interval', render: (value: number, row) => <InputNumber min={0.0001} value={value} onChange={next => updateCandidate(row.horizon, 'interval', next)} /> },
                { title: 'delta_t', dataIndex: 'delta', render: (value: number, row) => <InputNumber min={0.0001} value={value} onChange={next => updateCandidate(row.horizon, 'delta', next)} /> },
                { title: '操作', render: (_: unknown, row) => <Button type="link" danger disabled={allowed.length <= 1} onClick={() => update({ allowed_horizons: allowed.filter(item => item !== row.horizon), interval_minutes_by_horizon: Object.fromEntries(Object.entries(config.interval_minutes_by_horizon || {}).filter(([key]) => key !== String(row.horizon))), delta_t_by_horizon: Object.fromEntries(Object.entries(config.delta_t_by_horizon || {}).filter(([key]) => key !== String(row.horizon))) })}>删除</Button> },
              ]} />
              <Button className="section-gap-tight" onClick={() => { const horizon = Math.max(0, ...allowed) + 24; update({ allowed_horizons: [...allowed, horizon], interval_minutes_by_horizon: { ...(config.interval_minutes_by_horizon || {}), [String(horizon)]: 60 }, delta_t_by_horizon: { ...(config.delta_t_by_horizon || {}), [String(horizon)]: 1 } }); }}>新增候选值</Button>
            </>}
            {mode === 'data_derived' && <><Form.Item label="推导来源参数" required extra="试验能力：发布时会校验参数为运行时输入且维度包含时间集合。"><Select style={{ width: 360 }} value={config.derive_from || undefined} options={deriveOptions} placeholder="选择主时间序列参数" onChange={value => update({ derive_from: value })} /></Form.Item><Space wrap><Form.Item label="时间粒度（分钟）"><InputNumber min={0.0001} value={config.interval_minutes} onChange={value => update({ interval_minutes: value || undefined, delta_t: value ? value / 60 : undefined })} /></Form.Item><Form.Item label="delta_t"><InputNumber min={0.0001} value={config.delta_t} onChange={value => update({ delta_t: value || undefined })} /></Form.Item></Space></>}
            <Space wrap align="start">
              <Form.Item label="自动生成时间标签"><Switch aria-label="自动生成时间标签" checked={config.label_generation === 'auto'} onChange={checked => update({ label_generation: checked ? 'auto' : 'none', label_set: checked ? config.label_set || 'time_labels' : null })} /></Form.Item>
              {config.label_generation === 'auto' && <><Form.Item label="标签字段" required><Input value={config.label_set || ''} onChange={event => update({ label_set: event.target.value })} /></Form.Item><Form.Item label="标签格式"><Select style={{ width: 180 }} value={config.label_format || 'HH:mm'} options={[{ value: 'HH:mm', label: 'HH:mm' }, { value: 'sequence', label: 'T1...Tn' }]} onChange={value => update({ label_format: value })} /></Form.Item></>}
            </Space>
          </Form>
        </Space>
      )}
    </Card>
  );
}
