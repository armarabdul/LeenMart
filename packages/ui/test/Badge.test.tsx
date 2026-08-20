import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../src/components/Badge.js';
import { StatusBadge } from '../src/components/StatusBadge.js';

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge tone="primary">3</Badge>);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('renders the label and a decorative, hidden dot', () => {
    render(<StatusBadge tone="success" label="Delivered" />);
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    // The dot carries no information of its own — the label already says
    // it, so it must not be exposed a second time to assistive tech.
    const badge = screen.getByText('Delivered').closest('span');
    const dot = badge?.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
  });

  it.each(['neutral', 'success', 'warning', 'danger', 'info'] as const)(
    'renders the %s tone without throwing',
    (tone) => {
      render(<StatusBadge tone={tone} label="Status" />);
      expect(screen.getByText('Status')).toBeInTheDocument();
    },
  );
});
