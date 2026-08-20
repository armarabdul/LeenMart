import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../src/components/Button.js';

describe('Button', () => {
  it('renders its label and responds to a click', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Add to cart</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled while loading, and stays disabled even without an explicit disabled prop', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Submit review
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Submit review' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('respects an explicit disabled prop independent of loading', () => {
    render(<Button disabled>Checkout</Button>);
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
  });

  it('is reachable and activatable by keyboard alone', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Log in</Button>);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Log in' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('defaults to type="button" so it never submits an enclosing form by accident', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'renders the %s variant without throwing',
    (variant) => {
      render(<Button variant={variant}>Action</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('renders the %s size without throwing', (size) => {
    render(<Button size={size}>Action</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
