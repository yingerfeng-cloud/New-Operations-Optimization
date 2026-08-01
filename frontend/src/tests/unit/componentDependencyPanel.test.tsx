import { render, screen } from '@testing-library/react';
import { ComponentDependencyPanel } from '../../features/component-library/ComponentDependencyPanel';

test('missing dependency blocks publish visibly', () => {
  render(
    <ComponentDependencyPanel
      component={{ component_id: 'a', name: 'A', status: 'draft', enabled: true, implemented: false, version: '1', depends_on: ['b'] }}
      available={[]}
    />,
  );
  expect(screen.getByText('依赖异常将阻止发布')).toBeInTheDocument();
  expect(screen.getByText('异常')).toBeInTheDocument();
});

test('cyclic dependency blocks publish visibly', () => {
  const componentA = { component_id: 'a', name: 'A', status: 'draft', enabled: true, implemented: false, version: '1', depends_on: ['b'] };
  const componentB = { component_id: 'b', name: 'B', status: 'published', enabled: true, implemented: true, version: '1', depends_on: ['a'] };
  render(<ComponentDependencyPanel component={componentA} available={[componentA, componentB]} />);
  expect(screen.getByText('依赖异常将阻止发布')).toBeInTheDocument();
  expect(screen.getByText(/循环依赖：a → b → a/)).toBeInTheDocument();
});
