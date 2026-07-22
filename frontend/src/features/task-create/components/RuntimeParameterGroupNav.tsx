import { Select } from 'antd';
import type { RuntimeParameterGroup } from '../utils/runtimeParameterGroups';
import { runtimeGroupStats } from '../utils/runtimeParameterGroups';

export function RuntimeParameterGroupNav({ groups, activeKey, values, errors, defaults, onChange }: {
  groups: RuntimeParameterGroup[]; activeKey: string; values: Record<string, unknown>; errors: Record<string, string>; defaults: Record<string, unknown>; onChange: (key: string) => void;
}) {
  const options = groups.map(group => {
    const stats = runtimeGroupStats(group, values, errors, defaults);
    const suffix = `${stats.completed}/${stats.required}${stats.errors ? ` · ${stats.errors} 错误` : ''}`;
    return { value: group.key, label: `${group.label}  ${suffix}`, stats };
  });
  return <nav className="runtime-group-nav" aria-label="参数分组导航">
    <Select className="runtime-group-nav-select" aria-label="选择参数组" value={activeKey} onChange={onChange} options={options.map(({ value, label }) => ({ value, label }))} />
    <div className="runtime-group-nav-scroll">
      {groups.map((group, index) => {
        const option = options[index];
        return <button key={group.key} type="button" className={group.key === activeKey ? 'active' : ''} onClick={() => onChange(group.key)}>
          <span>{group.label}</span><small>{option.stats.completed}/{option.stats.required}{option.stats.errors ? ` · ${option.stats.errors} 错误` : ''}</small>
        </button>;
      })}
    </div>
  </nav>;
}
