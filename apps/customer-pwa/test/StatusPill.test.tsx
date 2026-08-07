import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '@/components/StatusPill';

describe('StatusPill', () => {
  it('renders an up state', () => {
    render(<StatusPill status="up" />);
    expect(screen.getByText('Up')).toBeInTheDocument();
  });

  it('renders a down state', () => {
    render(<StatusPill status="down" />);
    expect(screen.getByText('Down')).toBeInTheDocument();
  });

  it('does not rely on colour alone to convey status', () => {
    // Accessibility: the state must be readable by a screen reader and by a
    // user who cannot distinguish the red/green pill (WCAG 1.4.1).
    const { rerender } = render(<StatusPill status="up" />);
    expect(screen.getByText('Up')).toBeVisible();
    rerender(<StatusPill status="down" />);
    expect(screen.getByText('Down')).toBeVisible();
  });
});
