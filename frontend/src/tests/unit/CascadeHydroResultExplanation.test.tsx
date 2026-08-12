import { render } from '@testing-library/react';
import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ResultBusinessOutputPanel } from '../../features/result-center/ResultPanels';

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="mock-chart">chart</div> }));

test('hydro output uses the same model-neutral business output renderer', () => {
  render(
    <ResultBusinessOutputPanel
      result={{
        status: 'SUCCESS',
        solver: 'HiGHS',
        problem_type: 'MILP',
        objective_value: 100,
        metrics: { total_generation_MWh: 500, total_spill_million_m3: 0, total_abs_load_deviation_MW: 1 },
        business_output: {
          storage_curve: [{ time: 0, reservoir: 'R1', storage: 1 }],
          water_balance_check: [{ time: 0, reservoir: 'R1', balance_error: 0 }],
          function_asset_interpolation: [{ time: 0, reservoir: 'R1', power_surface: { selected_triangle: [0, 1, 2], lambda: [0.2, 0.3, 0.5] } }],
        },
      }}
    />,
  );
  expect(screen.getByText('storage_curve')).toBeInTheDocument();
  expect(screen.getByText('water_balance_check')).toBeInTheDocument();
  expect(screen.getByText('function_asset_interpolation')).toBeInTheDocument();
});
