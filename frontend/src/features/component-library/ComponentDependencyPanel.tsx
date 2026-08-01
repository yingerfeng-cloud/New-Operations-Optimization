import { Alert, Empty, Tag } from 'antd';
import type { ComponentDef } from '../../types/component';
import {
  analyzeComponentDependencyCandidate,
  getComponentDependencyIds,
  getComponentId,
} from '../../utils/componentDependencies';

export function ComponentDependencyPanel({
  component,
  available = [],
}: {
  component: ComponentDef;
  available?: ComponentDef[];
}) {
  const deps = getComponentDependencyIds(component);
  const currentId = getComponentId(component);
  const { missing, unavailable, selfDependency, cycles } = analyzeComponentDependencyCandidate(component, available);
  const errors = [
    ...(missing.length ? [`缺失依赖：${missing.join('、')}`] : []),
    ...(unavailable.length ? [`尚未发布或已停用：${unavailable.join('、')}`] : []),
    ...(selfDependency ? ['组件不能依赖自身'] : []),
    ...cycles.map(cycle => `循环依赖：${cycle.join(' → ')}`),
  ];
  const invalidDependencies = new Set([
    ...missing,
    ...unavailable,
    ...(selfDependency ? [currentId] : []),
    ...cycles.flatMap(cycle => cycle),
  ]);
  return (
    <>
      <Alert
        type={errors.length ? 'error' : 'success'}
        showIcon
        title={errors.length ? '依赖异常将阻止发布' : '组件依赖完整'}
        description={errors.length ? errors.join('；') : '所有依赖均可用，且没有自依赖或循环依赖'}
      />
      <div className="dependency-list section-gap">
        {deps.length ? deps.map(dep => (
          <div className="dependency-row" key={dep}>
            <span>{dep}</span>
            <Tag color={invalidDependencies.has(dep) ? 'red' : 'green'}>
              {invalidDependencies.has(dep) ? '异常' : '可用'}
            </Tag>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无组件依赖" />}
      </div>
    </>
  );
}
