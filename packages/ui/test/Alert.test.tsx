import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from '../src/components/Alert.js';

describe('Alert', () => {
  it.each(['danger', 'warning'] as const)('%s is announced immediately (role="alert")', (tone) => {
    render(<Alert tone={tone}>Something needs attention</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something needs attention');
  });

  it.each(['success', 'info'] as const)(
    '%s is announced politely (role="status"), not as an interrupting alert',
    (tone) => {
      render(<Alert tone={tone}>All good</Alert>);
      expect(screen.getByRole('status')).toHaveTextContent('All good');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('renders an optional title above the body', () => {
    render(
      <Alert tone="danger" title="Payment failed">
        Please try a different payment method.
      </Alert>,
    );
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
    expect(screen.getByText('Please try a different payment method.')).toBeInTheDocument();
  });
});
