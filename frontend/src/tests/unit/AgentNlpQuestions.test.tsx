import { render } from '@testing-library/react';
import { screen } from '@testing-library/react';
import { AgentWorkflowPanel } from '../../features/agent-workbench/AgentPanels';

test('agent workflow panel can display NLP demo answer', () => {
  render(<AgentWorkflowPanel response={{ message: 'NLP / Ipopt 已支持真实求解；结果不承诺全局最优；MINLP_RESERVED 不作为生产级能力开放。' }} />);
  expect(screen.getByText('Agent 回复')).toBeInTheDocument();
  expect(screen.getByText(/MINLP_RESERVED/)).toBeInTheDocument();
});
