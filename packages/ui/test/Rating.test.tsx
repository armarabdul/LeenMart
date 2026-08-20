import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Rating } from '../src/components/Rating.js';

describe('Rating', () => {
  it('read-only: exposes the rating as one accessible name, not five separate stars', () => {
    render(<Rating value={4} />);
    expect(screen.getByLabelText('4 out of 5 stars')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('interactive: renders a radiogroup of five stars, checked up to the current value', () => {
    render(<Rating value={3} onChange={() => undefined} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios[2]).toHaveAttribute('aria-checked', 'true');
    expect(radios[3]).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the clicked star', async () => {
    const onChange = vi.fn();
    render(<Rating value={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('singularises "1 star"', () => {
    render(<Rating value={1} onChange={() => undefined} />);
    expect(screen.getByRole('radio', { name: '1 star' })).toBeInTheDocument();
  });
});
