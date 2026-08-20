import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../src/components/Select.js';

const OPTIONS = [
  { value: 'pickup', label: 'Pickup' },
  { value: 'delivery', label: 'Delivery' },
];

describe('Select', () => {
  it('associates its label and lists every option', () => {
    render(<Select label="Fulfilment mode" options={OPTIONS} />);
    const select = screen.getByLabelText('Fulfilment mode');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pickup' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Delivery' })).toBeInTheDocument();
  });

  it('renders a disabled placeholder option when given one', () => {
    render(<Select label="Fulfilment mode" options={OPTIONS} placeholder="Choose one" />);
    expect(screen.getByRole('option', { name: 'Choose one' })).toBeDisabled();
  });

  it('changes value on selection', async () => {
    render(<Select label="Fulfilment mode" options={OPTIONS} />);
    const select = screen.getByLabelText('Fulfilment mode');
    await userEvent.selectOptions(select, 'delivery');
    expect(select).toHaveValue('delivery');
  });

  it('surfaces a validation error', () => {
    render(<Select label="Fulfilment mode" options={OPTIONS} error="Choose a fulfilment mode" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a fulfilment mode');
    expect(screen.getByLabelText('Fulfilment mode')).toHaveAttribute('aria-invalid', 'true');
  });
});
