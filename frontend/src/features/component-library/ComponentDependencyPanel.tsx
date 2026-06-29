import { Alert, Empty, Tag } from 'antd';
import type { ComponentDef } from '../../types/component';

export function ComponentDependencyPanel({ component, available = [] }: { component: ComponentDef; available?: string[] }) {
  const deps = [...new Set([...(component.depends_on || []), ...(component.dependencies || [])])];
  const missing = deps.filter(dep => !available.includes(dep));
  return (
    <>
      <Alert
        type={missing.length ? 'error' : 'success'}
        showIcon
        title={missing.length ? '缺失依赖将阻止发布' : '组件依赖完整'}
        description={missing.length ? missing.join('、') : '所有依赖均在组件库中'}
      />
      <div className="dependency-list section-gap">
        {deps.length ? deps.map(dep => (
          <div className="dependency-row" key={dep}>
            <span>{dep}</span>
            <Tag color={missing.includes(dep) ? 'red' : 'green'}>{missing.includes(dep) ? '缺失' : '可用'}</Tag>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无组件依赖" />}
      </div>
    </>
  );
}
