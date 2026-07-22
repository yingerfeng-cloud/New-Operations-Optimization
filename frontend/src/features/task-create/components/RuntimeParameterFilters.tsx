import { Segmented } from 'antd';
import type { RuntimeParameterFilter } from '../utils/runtimeParameterGroups';

export function RuntimeParameterFilters({ value, onChange }: { value: RuntimeParameterFilter; onChange: (value: RuntimeParameterFilter) => void }) {
  return <div className="runtime-parameter-filters"><span>显示字段</span><Segmented value={value} onChange={next => onChange(next as RuntimeParameterFilter)} options={[{ label: '全部', value: 'all' }, { label: '必填', value: 'required' }, { label: '存在错误', value: 'error' }, { label: '已修改', value: 'modified' }]} /></div>;
}
