import { render, screen } from '@testing-library/react';
import { AgentResultPanel } from '../../features/agent-workbench/AgentPanels';


test('renders layered grounded explanation and evidence entry', () => {
  render(<AgentResultPanel response={{
    conversation_id: 'C1',
    invocation_id: 'I1',
    result: {
      explanation_structured: {
        facts: ['求解状态为 success。'],
        inferences: ['储能在高价时段放电。'],
        recommendations: ['复核电价预测。'],
        risk_notes: ['SOC 达到边界。'],
        manual_review_points: ['复核末端 SOC。'],
        limitations: ['仅基于当前输入。'],
      },
      evidence_package: { solver: { status: 'success' } },
    },
  }} />);
  expect(screen.getByText('事实')).toBeInTheDocument();
  expect(screen.getByText('推断')).toBeInTheDocument();
  expect(screen.getByText('建议')).toBeInTheDocument();
  expect(screen.getByText('风险提示')).toBeInTheDocument();
  expect(screen.getByText('人工复核点')).toBeInTheDocument();
  expect(screen.getByText('解释限制')).toBeInTheDocument();
  expect(screen.getByText('查看原始 evidence package')).toBeInTheDocument();
});
