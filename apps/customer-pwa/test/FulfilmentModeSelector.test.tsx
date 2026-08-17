import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CartItemResponse } from '@leen-mart/contracts';
import { FulfilmentModeSelector } from '@/features/checkout/components/FulfilmentModeSelector';
import {
  groupCartByVendor,
  type CartVendorGroup,
} from '@/features/checkout/lib/group-cart-by-vendor';

const cartItem = (overrides: Partial<CartItemResponse>): CartItemResponse =>
  ({
    id: 'item-1',
    variantId: 'variant-1',
    quantity: 1,
    vendorId: 'vendor-a',
    vendorShopName: 'Pickup Shop A',
    supportsPickup: true,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  }) as CartItemResponse;

const vendor = (overrides: Partial<CartVendorGroup>): CartVendorGroup => ({
  vendorId: 'vendor-a',
  vendorShopName: 'Pickup Shop A',
  supportsPickup: true,
  ...overrides,
});

const renderSelector = (
  vendors: readonly CartVendorGroup[],
  pickupVendorIds: readonly string[] = [],
): { onToggle: ReturnType<typeof vi.fn> } => {
  const onToggle = vi.fn();
  render(
    <FulfilmentModeSelector
      vendors={vendors}
      pickupVendorIds={pickupVendorIds}
      onToggle={onToggle}
    />,
  );
  return { onToggle };
};

describe('groupCartByVendor', () => {
  it('collapses several lines from one vendor into a single choice', () => {
    const groups = groupCartByVendor([
      cartItem({ id: 'item-1', variantId: 'variant-1' }),
      cartItem({ id: 'item-2', variantId: 'variant-2' }),
    ]);

    expect(groups).toEqual([
      { vendorId: 'vendor-a', vendorShopName: 'Pickup Shop A', supportsPickup: true },
    ]);
  });

  it('keeps each vendor in a multi-vendor cart distinct, with its own capability', () => {
    const groups = groupCartByVendor([
      cartItem({ id: 'item-1' }),
      cartItem({
        id: 'item-2',
        variantId: 'variant-2',
        vendorId: 'vendor-b',
        vendorShopName: 'Delivery Shop B',
        supportsPickup: false,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[1]).toEqual({
      vendorId: 'vendor-b',
      vendorShopName: 'Delivery Shop B',
      supportsPickup: false,
    });
  });

  it('returns nothing for an empty cart', () => {
    expect(groupCartByVendor([])).toEqual([]);
  });
});

describe('FulfilmentModeSelector', () => {
  it('renders nothing when no vendor in the cart supports pickup', () => {
    const { container } = render(
      <FulfilmentModeSelector
        vendors={[vendor({ supportsPickup: false })]}
        pickupVendorIds={[]}
        onToggle={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('offers both modes for a pickup-capable vendor, defaulting to delivery', () => {
    renderSelector([vendor({})]);

    expect(screen.getByLabelText('Deliver to me')).toBeChecked();
    expect(screen.getByLabelText('Pick up in store')).not.toBeChecked();
  });

  it('offers no pickup control for a delivery-only vendor, and never silently offers one', () => {
    renderSelector([
      vendor({}),
      vendor({ vendorId: 'vendor-b', vendorShopName: 'Delivery Shop B', supportsPickup: false }),
    ]);

    expect(screen.getByText('Delivery Shop B')).toBeInTheDocument();
    expect(screen.getByText('Delivery only')).toBeInTheDocument();
    // Exactly one vendor's worth of controls — vendor B contributes none.
    expect(screen.getAllByLabelText('Pick up in store')).toHaveLength(1);
  });

  it('reports the vendor and the chosen mode when a customer picks up', () => {
    const { onToggle } = renderSelector([vendor({})]);

    fireEvent.click(screen.getByLabelText('Pick up in store'));

    expect(onToggle).toHaveBeenCalledWith('vendor-a', true);
  });

  it('reports a switch back to delivery', () => {
    const { onToggle } = renderSelector([vendor({})], ['vendor-a']);

    expect(screen.getByLabelText('Pick up in store')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Deliver to me'));

    expect(onToggle).toHaveBeenCalledWith('vendor-a', false);
  });

  it('scopes each vendor’s radios to its own group, so one choice cannot clear another', () => {
    renderSelector(
      [vendor({}), vendor({ vendorId: 'vendor-b', vendorShopName: 'Shop B' })],
      ['vendor-a'],
    );

    const [pickupA, pickupB] = screen.getAllByLabelText('Pick up in store');
    expect(pickupA).toBeChecked();
    expect(pickupB).not.toBeChecked();
    expect(pickupA).toHaveAttribute('name', 'fulfilment-vendor-a');
    expect(pickupB).toHaveAttribute('name', 'fulfilment-vendor-b');
  });
});
