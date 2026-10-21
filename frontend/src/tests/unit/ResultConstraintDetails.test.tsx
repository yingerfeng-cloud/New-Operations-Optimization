import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ResultConstraintsPanel } from '../../features/result-center/ResultPanels';
import { resultTabKeys } from '../../pages/ResultCenter/ResultCenterPage';

test('measured constraint rows expose bounds, residuals, and violations in the result report', () => {
  const result = { constraint_checks: [
    { key: 'demand[0]', value: 10, lower: 10, upper: null, violation: 0, margin: 0, status: 'binding' },
    { key: 'cap[0]', value: 8, lower: null, upper: 5, violation: 3, margin: -3, status: 'violated' },
  ] };
  expect(resultTabKeys(result)).toContain('constraints');
  render(<ResultConstraintsPanel result={result} />);
  for (const name of ['实际值', '下界', '上界', '余量', '违反量', '检查结果']) expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
  expect(screen.getByText('demand[0]')).toBeInTheDocument();
  expect(screen.getByText('触边')).toBeInTheDocument();
  expect(screen.getByText('违反')).toBeInTheDocument();
  expect(screen.getByText('-3')).toBeInTheDocument();
});
