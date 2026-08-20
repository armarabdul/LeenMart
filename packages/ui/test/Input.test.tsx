import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../src/components/Input.js';

describe('Input', () => {
  it('associates its label with the field', () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows the hint when there is no error', () => {
    render(<Input label="Password" hint="At least 8 characters" />);
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
  });

  it('shows the error instead of the hint, and marks the field invalid', () => {
    render(
      <Input
        label="Password"
        hint="At least 8 characters"
        error="String must contain at least 10 character(s)"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'String must contain at least 10 character(s)',
    );
    expect(screen.queryByText('At least 8 characters')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('accepts typed input', async () => {
    render(<Input label="Email" />);
    const field = screen.getByLabelText('Email');
    await userEvent.type(field, 'vendor@example.com');
    expect(field).toHaveValue('vendor@example.com');
  });

  it('cannot be typed into while disabled', () => {
    render(<Input label="Email" disabled />);
    expect(screen.getByLabelText('Email')).toBeDisabled();
  });
});
