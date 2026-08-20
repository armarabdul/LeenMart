import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../src/components/EmptyState.js';
import { Button } from '../src/components/Button.js';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No orders yet" />);
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });

  it('renders an optional description and action', () => {
    render(
      <EmptyState
        title="Your cart is empty"
        description="Add something from the catalogue to get started."
        action={<Button>Browse catalogue</Button>}
      />,
    );
    expect(
      screen.getByText('Add something from the catalogue to get started.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse catalogue' })).toBeInTheDocument();
  });

  it('omits the description paragraph entirely when none is given', () => {
    const { container } = render(<EmptyState title="No reviews yet" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});
