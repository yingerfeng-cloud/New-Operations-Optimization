import { render } from '@testing-library/react';
import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ResultNlpPanel } from '../../features/result-center/ResultPanels';

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="mock-chart">chart</div> }));

test('NLP result panel explains Ipopt local optimum boundary', () => {
  render(
    <ResultNlpPanel
      result={{
        status: 'SUCCESS',
        solver: 'Ipopt',
        problem_type: 'NLP',
        termination_condition: 'locallyOptimal',
        objective_value: 12,
        variable_values: { flow: [10, 20] },
        local_optimum_warning: true,
        constraint_violation_summary: { max_violation: 0 },
      }}
    />,
  );
  expect(screen.getByText('该结果来自 Ipopt 原生非线性求解')).toBeInTheDocument();
  expect(document.body.textContent).toContain('不承诺全局最优');
});
