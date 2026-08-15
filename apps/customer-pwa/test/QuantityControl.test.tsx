import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuantityControl } from '@/shared/components/QuantityControl';

describe('QuantityControl', () => {
  it('increments and decrements by 1 when quantityStep is 1', () => {
    const onChange = vi.fn();
    render(<QuantityControl quantity={2} quantityStep={1} available={10} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Increase quantity'));
    expect(onChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('increments and decrements by the given quantityStep, never by 1', () => {
    const onChange = vi.fn();
    render(<QuantityControl quantity={10} quantityStep={5} available={100} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Increase quantity'));
    expect(onChange).toHaveBeenCalledWith(15);

    fireEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('shows a step hint only when quantityStep is greater than 1', () => {
    const { rerender } = render(
      <QuantityControl quantity={5} quantityStep={5} available={100} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Sold in steps of 5')).toBeInTheDocument();

    rerender(<QuantityControl quantity={1} quantityStep={1} available={100} onChange={vi.fn()} />);
    expect(screen.queryByText(/Sold in steps of/)).not.toBeInTheDocument();
  });

  it('never decrements below one quantityStep', () => {
    render(<QuantityControl quantity={1} quantityStep={1} available={10} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Decrease quantity')).toBeDisabled();
  });

  it('never increments past the largest multiple of quantityStep that fits in available', () => {
    // available=12, step=5 -> the largest valid quantity is 10, not 12.
    render(<QuantityControl quantity={10} quantityStep={5} available={12} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled();
  });

  it('disables both controls and shows zero when available is less than quantityStep', () => {
    render(<QuantityControl quantity={3} quantityStep={5} available={3} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled();
    expect(screen.getByLabelText('Decrease quantity')).toBeDisabled();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('enforces no upper bound when available is unknown, matching the unresolved-cart-item fallback', () => {
    const onChange = vi.fn();
    render(<QuantityControl quantity={1} onChange={onChange} />);

    expect(screen.getByLabelText('Increase quantity')).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText('Increase quantity'));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
