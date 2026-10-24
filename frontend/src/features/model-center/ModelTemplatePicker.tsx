import { useState } from 'react';
import { Input, Select, Tag } from 'antd';
import { CheckCircleFilled, FileTextOutlined, InfoCircleFilled, SearchOutlined } from '@ant-design/icons';
import { capabilityOrFallback } from '../demo/demoCapabilities';
import type { ModelTemplate } from '../../types/template';

export function ModelTemplatePicker({ templates, value, onChange, loading }: {
  templates: ModelTemplate[];
  value?: string;
  onChange: (code: string) => void;
  loading?: boolean;
}) {
  const [search, setSearch] = useState('');
  const keyword = search.trim().toLowerCase();
  const options = templates.filter(item => `${item.name} ${item.code}`.toLowerCase().includes(keyword));
  const selected = templates.find(item => item.code === value);
  const capability = selected && capabilityOrFallback(selected);
  const deprecated = Boolean(selected?.deprecated);
  const replacementCode = String(selected?.replacement_model_code || '');

  return <div className="template-picker">
    <Input
      className="template-picker-search"
      aria-label="搜索模板名称或编码"
      placeholder="搜索模板名称或编码"
      prefix={<SearchOutlined />}
      value={search}
      onChange={event => setSearch(event.target.value)}
      allowClear
    />
    <Select
      className="template-picker-select"
      aria-label="选择内置模板"
      placeholder="请选择内置模板"
      value={value}
      onChange={onChange}
      loading={loading}
      options={options.map(item => ({ value: item.code, label: `${item.name} (${item.code})` }))}
      labelRender={({ value: code }) => templates.find(item => item.code === code)?.name || code}
      notFoundContent={loading ? '正在加载模板…' : '没有匹配的模板'}
    />
    {selected && capability ? <div className="template-picker-card" role="group" aria-label={`已选模板：${selected.name}`}>
      <div className="template-picker-main">
        <FileTextOutlined className="template-picker-icon" />
        <div className="template-picker-identity">
          <div className="template-picker-name">{selected.name}{deprecated && <Tag color="warning">已弃用</Tag>}</div>
          <div className="template-picker-code">{selected.code}</div>
        </div>
        <CheckCircleFilled className="template-picker-checked" />
      </div>
      <div className="template-picker-meta">
        <span>模型类型 <Tag color="purple">{capability.problemType}</Tag></span>
        <span>求解器 <Tag color="blue">{capability.solver}</Tag></span>
        <span className="template-picker-scene">适用场景 <b>{capability.useCase}</b></span>
      </div>
      <div className="template-picker-assets"><span>函数资产</span><b>{capability.functionAssets}</b></div>
      {deprecated && replacementCode && <div className="template-picker-replacement">替代模型：{replacementCode}</div>}
    </div> : <p className="template-picker-empty">{loading ? '正在加载内置模板…' : '选择模板后查看模型信息。'}</p>}
    <div className="template-picker-note"><InfoCircleFilled /><span>克隆后会生成真实模型资产，可继续进入模型详情或模型创建流程完善。</span></div>
  </div>;
}
