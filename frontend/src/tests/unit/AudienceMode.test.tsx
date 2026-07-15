import { fireEvent, render, screen } from '@testing-library/react';
import { AudienceProvider, useAudience } from '../../app/audience';

function Probe() { const { audience, setAudience } = useAudience(); return <><span data-testid="audience">{audience}</span><button onClick={() => setAudience('expert')}>expert</button></>; }

test('platform audience defaults to business and persists expert selection', () => {
  localStorage.removeItem('copt.platform.audience'); const first = render(<AudienceProvider><Probe /></AudienceProvider>);
  expect(screen.getByTestId('audience')).toHaveTextContent('business'); fireEvent.click(screen.getByRole('button', { name: 'expert' }));
  expect(localStorage.getItem('copt.platform.audience')).toBe('expert'); first.unmount();
  render(<AudienceProvider><Probe /></AudienceProvider>); expect(screen.getByTestId('audience')).toHaveTextContent('expert');
});
