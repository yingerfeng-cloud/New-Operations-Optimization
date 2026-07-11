import { render, screen } from '@testing-library/react';
import { ModelBasicPanel } from '../../features/model-center/ModelAssetPanels';

test('model asset panel displays the authoritative time-dimension contract', () => {
  render(<ModelBasicPanel model={{
    id: 'MODEL-TIME', name: '枚举时段模型', scene: '测试', version: 'v1', status: 'published', solver: 'HiGHS', problem_type: 'LP', build_mode: 'component_based', updated_at: '2026-07-10',
    ui_metadata: { time_dimension: { enabled: true, policy: 'runtime_variable', default_horizon: 96, allowed_horizons: [24, 48, 96], time_set: 'time', state_time_set: 'time_volume', interval_minutes_by_horizon: { '96': 15 }, label_set: 'time_labels', label_generation: 'auto', editable: true } },
  }} />);
  expect(screen.getByText('时间维度契约')).toBeInTheDocument();
  expect(screen.getByText('候选时段切换')).toBeInTheDocument();
  expect(screen.getByText('24、48、96')).toBeInTheDocument();
  expect(screen.getByText('15 分钟')).toBeInTheDocument();
});
