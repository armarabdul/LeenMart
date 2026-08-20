import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from '../src/components/Card.js';

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>Farm Fresh Vegetables</Card>);
    expect(screen.getByText('Farm Fresh Vegetables')).toBeInTheDocument();
  });

  it('merges a caller className without dropping the base styling', () => {
    render(<Card className="mt-4">content</Card>);
    const card = screen.getByText('content');
    expect(card.className).toContain('mt-4');
    expect(card.className).toContain('rounded-card');
  });
});
