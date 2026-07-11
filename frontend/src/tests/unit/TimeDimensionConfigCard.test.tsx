import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { TimeDimensionConfigCard } from '../../features/model-creation/components/TimeDimensionConfigCard';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';
import { applyTimeDimensionToDraft } from '../../features/model-creation/utils/timeDimensionDraft';

function Harness({ initial = createInitialDraft() }: { initial?: ModelDraft }) {
  const [draft, setDraft] = useState(initial);
  return <><TimeDimensionConfigCard draft={draft} onChange={setDraft} /><pre data-testid="draft-state">{JSON.stringify(draft)}</pre></>;
}

test('configures fixed, free, choice and optional state/labels', () => {
  render(<Harness />);
  expect(screen.getByText('非时序模型')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: '是否启用时间维度' }));
  expect(screen.getByText('固定时段')).toBeInTheDocument();
  expect(screen.getByTestId('draft-state').textContent).toContain('"policy":"fixed"');

  fireEvent.click(screen.getByText('运行时自由调整'));
  expect(screen.getByText('最小 horizon')).toBeInTheDocument();
  fireEvent.click(screen.getByText('候选时段切换'));
  expect(screen.getAllByText('delta_t').length).toBeGreaterThan(0);
  expect(screen.getByTestId('draft-state').textContent).toContain('"allowed_horizons":[24,48,96]');

  fireEvent.click(screen.getByRole('switch', { name: '使用状态时点集合' }));
  expect(screen.getByTestId('draft-state').textContent).toContain('"state_time_set":null');
  fireEvent.click(screen.getByRole('switch', { name: '自动生成时间标签' }));
  expect(screen.getByText('标签字段')).toBeInTheDocument();
});

test('offers only time-dimensional runtime parameters for data_derived', () => {
  const initial = applyTimeDimensionToDraft(createInitialDraft(), { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 3, time_set: 'time', state_time_set: null, editable: false });
  initial.semantic.parameters = [
    { code: 'load_forecast', name: '负荷', dimension: ['time'], sourceType: 'runtime' },
    { code: 'capacity', name: '容量', dimension: [], sourceType: 'runtime' },
  ];
  render(<Harness initial={initial} />);
  fireEvent.click(screen.getByText('由输入数据推导'));
  fireEvent.mouseDown(screen.getByText('选择主时间序列参数'));
  expect(screen.getByRole('option', { name: /load_forecast/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /capacity/ })).not.toBeInTheDocument();
});

test('offers dimensions alias parameters for data_derived and stores scalar granularity', () => {
  const initial = applyTimeDimensionToDraft(createInitialDraft(), { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 3, time_set: 'time', state_time_set: null, editable: false });
  initial.semantic.parameters = [{ code: 'load_forecast', name: '负荷', dimensions: ['time'], sourceType: 'runtime' }];
  render(<Harness initial={initial} />);
  fireEvent.click(screen.getByText('由输入数据推导'));
  fireEvent.mouseDown(screen.getByText('选择主时间序列参数'));
  expect(screen.getByRole('option', { name: /load_forecast/ })).toBeInTheDocument();
  expect(screen.getByText('时间粒度（分钟）')).toBeInTheDocument();
  expect(screen.getByText('delta_t')).toBeInTheDocument();
});

test('blocks disabling while time dimensions are referenced', () => {
  const initial = applyTimeDimensionToDraft(createInitialDraft(), { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 3, time_set: 'time', state_time_set: null, editable: false });
  initial.semantic.parameters = [{ code: 'load', name: '负荷', dimension: ['time'], sourceType: 'runtime' }];
  render(<Harness initial={initial} />);
  fireEvent.click(screen.getByRole('switch', { name: '是否启用时间维度' }));
  expect(screen.getByText(/当前有 1 个参数/)).toBeInTheDocument();
  expect(screen.getByTestId('draft-state').textContent).toContain('"enabled":true');
});

test('blocks disabling the state set while it is referenced', () => {
  const initial = applyTimeDimensionToDraft(createInitialDraft(), { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 3, time_set: 'time', state_time_set: 'time_volume', editable: false });
  initial.semantic.parameters = [{ code: 'soc', name: '库存', dimension: ['time_volume'], sourceType: 'runtime' }];
  render(<Harness initial={initial} />);
  fireEvent.click(screen.getByRole('switch', { name: '使用状态时点集合' }));
  expect(screen.getByText(/当前有 1 个参数和 0 个变量引用 time_volume/)).toBeInTheDocument();
  expect(screen.getByTestId('draft-state').textContent).toContain('"state_time_set":"time_volume"');
});
