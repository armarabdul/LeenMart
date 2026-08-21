import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from '../src/components/Textarea.js';

describe('Textarea', () => {
  it('associates its label with the field', () => {
    render(<Textarea label="Review" />);
    expect(screen.getByLabelText('Review')).toBeInTheDocument();
  });

  it('shows the hint when there is no error', () => {
    render(<Textarea label="Review" hint="Up to 2000 characters" />);
    expect(screen.getByText('Up to 2000 characters')).toBeInTheDocument();
  });

  it('shows the error instead of the hint, and marks the field invalid', () => {
    render(
      <Textarea
        label="Review"
        hint="Up to 2000 characters"
        error="Write a few words about your experience."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Write a few words about your experience.');
    expect(screen.queryByText('Up to 2000 characters')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Review')).toHaveAttribute('aria-invalid', 'true');
  });

  it('accepts typed input', async () => {
    render(<Textarea label="Review" />);
    const field = screen.getByLabelText('Review');
    await userEvent.type(field, 'Great product');
    expect(field).toHaveValue('Great product');
  });

  it('cannot be typed into while disabled', () => {
    render(<Textarea label="Review" disabled />);
    expect(screen.getByLabelText('Review')).toBeDisabled();
  });
});
