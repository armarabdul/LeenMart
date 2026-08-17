import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PickupLocationSnapshotDto } from '@leen-mart/contracts';
import { PickupLocationPanel } from '@/features/checkout/components/PickupLocationPanel';

const LOCATION: PickupLocationSnapshotDto = {
  line1: '12 Market Road',
  line2: 'Near the clock tower',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

describe('PickupLocationPanel', () => {
  it('shows the shop name and every part of the address', () => {
    render(<PickupLocationPanel shopName="FreshMart" location={LOCATION} />);

    expect(screen.getByText('Collect from')).toBeInTheDocument();
    expect(screen.getByText('FreshMart')).toBeInTheDocument();
    expect(screen.getByText('12 Market Road, Near the clock tower')).toBeInTheDocument();
    expect(screen.getByText('Bengaluru, Karnataka 560001')).toBeInTheDocument();
  });

  it('omits the optional second line cleanly when there is none', () => {
    render(<PickupLocationPanel shopName="FreshMart" location={{ ...LOCATION, line2: null }} />);

    // No trailing comma, no empty gap where line2 would have been.
    expect(screen.getByText('12 Market Road')).toBeInTheDocument();
  });

  it('renders as an address element, so it reads as one to assistive tech', () => {
    const { container } = render(<PickupLocationPanel shopName="FreshMart" location={LOCATION} />);

    expect(container.querySelector('address')).not.toBeNull();
  });
});
