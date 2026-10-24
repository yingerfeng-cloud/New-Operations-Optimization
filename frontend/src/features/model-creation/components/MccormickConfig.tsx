import { ContextNote } from '../../../components/ContextNote';
import { Button, Card, Input, InputNumber, Space, Typography } from 'antd';
import type { ModelDraft } from '../stores/modelCreationStore';

export function MccormickConfig({ draft, index, onChange }: { draft: ModelDraft; index: number; onChange: (draft: ModelDraft) => void }) {
  const component = draft.components[index];
  const config = { ...((component.config || {}) as Record<string, unknown>), ...component };
  const update = (patch: Record<string, unknown>) => onChange({ ...draft, components: draft.components.map((row, position) => position === index ? { ...row, ...patch, config: { ...((row.config || {}) as Record<string, unknown>), ...patch } } : row) });
  const useBounds = () => {
    const patch: Record<string, unknown> = {};
    for (const axis of ['x', 'y']) {
      const name = String(config[axis] || '').split('[')[0];
      const variable = draft.semantic.variables.find(item => item.code === name);
      if (variable?.lowerBound !== undefined && variable.lowerBound !== '') patch[`${axis}_lower`] = Number(variable.lowerBound);
      if (variable?.upperBound !== undefined && variable.upperBound !== '') patch[`${axis}_upper`] = Number(variable.upperBound);
    }
    update(patch);
  };
  return <Card size="small" title="McCormick 配置" className="section-gap">
    <ContextNote title="为已有变量生成凸包松弛约束" description="填写 x、y、w 表达式与 x/y 有限边界。此组件是松弛，不是乘积的精确等价表达。" />
    <Space orientation="vertical" style={{ width: '100%' }}>
      {['x', 'y', 'w'].map(field => <label key={field}>{field} 表达式<Input aria-label={`McCormick ${field} 表达式`} value={String(config[field] || '')} placeholder={field === 'w' ? 'product[t]' : `${field === 'x' ? 'flow' : 'head'}[t]`} onChange={event => update({ [field]: event.target.value })} /></label>)}
      <label>索引集合<Input aria-label="McCormick 索引集合" value={(Array.isArray(config.indices) ? config.indices : []).map(item => typeof item === 'string' ? item : (item as Record<string, unknown>).set).join(',')} placeholder="time（标量留空）" onChange={event => update({ indices: event.target.value.split(',').map(item => item.trim()).filter(Boolean).map(set => ({ set, alias: set === 'time' ? 't' : set })) })} /></label>
      <Space wrap>{['x_lower', 'x_upper', 'y_lower', 'y_upper'].map(field => <label key={field}>{field}<InputNumber aria-label={`McCormick ${field}`} value={config[field] as number | undefined} onChange={value => update({ [field]: value })} /></label>)}</Space>
      <Button onClick={useBounds}>使用变量边界</Button>
      <Typography.Text type="secondary">变量本身的边界也需在变量表配置；保存与测试会检查这些输入。</Typography.Text>
    </Space>
  </Card>;
}
