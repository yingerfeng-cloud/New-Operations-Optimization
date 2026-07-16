import { render, screen } from '@testing-library/react';
import { AgentWorkflowPanel } from '../../features/agent-workbench/AgentPanels';


test('shows ranked candidates, confidence, reason and clarification', () => {
  render(<AgentWorkflowPanel response={{
    response_type: 'clarification_required',
    intent: 'optimization_run',
    route_confidence: 0.68,
    selection_reason: '业务域与语义样例匹配',
    needs_clarification: true,
    clarification_question: '请选择日前或日内调度。',
    candidate_skills: [
      { agent_skill_name: 'day_ahead', display_name: '光储日前调度', final_score: 0.68, reason: '日前语义匹配' },
      { agent_skill_name: 'intraday', display_name: '光储日内调度', final_score: 0.64, reason: '日内语义接近' },
    ],
  }} />);
  expect(screen.getByText('68%')).toBeInTheDocument();
  expect(screen.getByText('候选 Skill Top 3')).toBeInTheDocument();
  expect(screen.getByText('光储日前调度')).toBeInTheDocument();
  expect(screen.getByText('请选择日前或日内调度。')).toBeInTheDocument();
});
