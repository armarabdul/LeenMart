import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PublicProductVariant } from '@leen-mart/contracts';
import { VariantSelector } from '@/features/product/components/VariantSelector';

const variant = (overrides: Partial<PublicProductVariant> = {}): PublicProductVariant => ({
  id: 'variant-1',
  name: '500 g pack',
  price: { amount: '9900', currency: 'INR' },
  unitOfMeasure: 'g',
  quantityStep: 1,
  available: 10,
  ...overrides,
});

describe('VariantSelector', () => {
  it('renders nothing for a single-variant product', () => {
    const { container } = render(
      <VariantSelector variants={[variant()]} selectedVariantId="variant-1" onSelect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every variant when there is more than one', () => {
    const variants = [variant({ id: 'a', name: '500 g' }), variant({ id: 'b', name: '1 kg' })];
    render(<VariantSelector variants={variants} selectedVariantId="a" onSelect={vi.fn()} />);

    expect(screen.getByText('500 g')).toBeInTheDocument();
    expect(screen.getByText('1 kg')).toBeInTheDocument();
  });

  it('calls onSelect with the clicked variant id', () => {
    const onSelect = vi.fn();
    const variants = [variant({ id: 'a', name: '500 g' }), variant({ id: 'b', name: '1 kg' })];
    render(<VariantSelector variants={variants} selectedVariantId="a" onSelect={onSelect} />);

    fireEvent.click(screen.getByText('1 kg'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('disables an out-of-stock variant rather than hiding it', () => {
    const variants = [
      variant({ id: 'a', name: 'Small pack', available: 5 }),
      variant({ id: 'b', name: 'Large pack', available: 0 }),
    ];
    render(<VariantSelector variants={variants} selectedVariantId="a" onSelect={vi.fn()} />);

    const unavailableButton = screen.getByRole('button', { name: /Large pack/ });
    expect(unavailableButton).toBeDisabled();
    expect(unavailableButton).toHaveTextContent('Out of stock');
    expect(screen.getByRole('button', { name: /Small pack/ })).not.toBeDisabled();
  });
});
