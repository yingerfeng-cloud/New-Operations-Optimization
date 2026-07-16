import { render, screen } from '@testing-library/react';
import { AgentSkillPanel } from '../../features/agent-workbench/AgentPanels';


test('shows Agent Skill v2 validation state without enabling drafts', () => {
  render(<AgentSkillPanel skills={[{
    name: 'storage_dispatch',
    display_name: '储能调度',
    schema_version: '2.0',
    state: 'draft',
    enabled: false,
    required_parameters: ['electricity_price', 'storage_capacity'],
    validation: { status: 'valid' },
  }]} />);
  expect(screen.getAllByText('储能调度').length).toBeGreaterThan(0);
  expect(screen.getByText('electricity_price, storage_capacity')).toBeInTheDocument();
  expect(screen.getByText('valid')).toBeInTheDocument();
});
