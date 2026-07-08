import { render } from '@testing-library/react';
import { screen } from '@testing-library/react';
import { AgentWorkflowPanel } from '../../features/agent-workbench/AgentPanels';

test('agent workflow panel can display cascade hydro demo answer', () => {
  render(<AgentWorkflowPanel response={{ message: '水电 PWL 标杆模型是 MILP，因为 2D PWL 使用 triangulated_milp_exact 并由 HiGHS 求解。' }} />);
  expect(screen.getByText('Agent 回复')).toBeInTheDocument();
  expect(screen.getByText(/triangulated_milp_exact/)).toBeInTheDocument();
});
