import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VendorSubOrderResponse } from '@leen-mart/contracts';
import { QrRedemptionForm } from '@/features/vendor-order/components/QrRedemptionForm';
import { useRedeemPickupTokenMutation } from '@/features/vendor-order/vendor-order.api';
import { verifyPickupTokenLocally } from '@/features/vendor-order/pickup-local-verification';
import { listQueuedRedemptions } from '@/features/vendor-order/offline-redemption-queue';

vi.mock('@/features/vendor-order/vendor-order.api', () => ({
  useRedeemPickupTokenMutation: vi.fn(),
}));
vi.mock('@/features/vendor-order/pickup-local-verification', () => ({
  verifyPickupTokenLocally: vi.fn(),
}));

const mockedUseRedeemPickupTokenMutation = vi.mocked(useRedeemPickupTokenMutation);
const mockedVerifyLocally = vi.mocked(verifyPickupTokenLocally);

const order = (overrides: Partial<VendorSubOrderResponse> = {}): VendorSubOrderResponse => ({
  id: 'sub-order-1',
  orderId: 'order-1',
  status: 'COMPLETED',
  fulfilmentMode: 'PICKUP',
  totalAmount: { amount: '19800', currency: 'INR' },
  address: {
    recipientName: 'Asha Rao',
    phone: '+919876543210',
    line1: '221B Baker Street',
    line2: null,
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    landmark: null,
    label: 'Home',
  },
  items: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const setOnline = (value: boolean): void => {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true, writable: true });
};

const dispatchConnectivity = (kind: 'online' | 'offline'): void => {
  act(() => {
    window.dispatchEvent(new Event(kind));
  });
};

interface MutationState {
  readonly isLoading?: boolean;
  readonly error?: unknown;
  readonly data?: VendorSubOrderResponse;
}

const setMutation = (trigger: ReturnType<typeof vi.fn>, state: MutationState = {}): void => {
  mockedUseRedeemPickupTokenMutation.mockReturnValue([
    trigger,
    { isLoading: state.isLoading ?? false, error: state.error, data: state.data, reset: vi.fn() },
  ] as unknown as ReturnType<typeof useRedeemPickupTokenMutation>);
};

describe('QrRedemptionForm (S4-QR, extended S4-QR-FALLBACK)', () => {
  beforeEach(() => {
    localStorage.clear();
    setOnline(true);
    mockedVerifyLocally.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
    setOnline(true);
  });

  it('submits directly while online — unchanged behaviour', async () => {
    const trigger = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve(order()) });
    setMutation(trigger);
    const { rerender } = render(<QrRedemptionForm />);

    fireEvent.change(screen.getByLabelText('Pickup code'), { target: { value: 'a.b.c' } });
    fireEvent.click(screen.getByRole('button', { name: 'Redeem pickup' }));

    await waitFor(() => expect(trigger).toHaveBeenCalledWith({ token: 'a.b.c' }));
    expect(mockedVerifyLocally).not.toHaveBeenCalled();

    setMutation(trigger, { data: order() });
    rerender(<QrRedemptionForm />);
    expect(screen.getByText('Pickup completed')).toBeInTheDocument();
  });

  it('shows an offline banner when the device has no connectivity', () => {
    setOnline(false);
    setMutation(vi.fn());
    render(<QrRedemptionForm />);

    expect(screen.getByText(/You’re offline/)).toBeInTheDocument();
  });

  it('verifies a token locally and queues it, without calling the server, while offline', async () => {
    setOnline(false);
    mockedVerifyLocally.mockResolvedValue({ valid: true });
    const trigger = vi.fn();
    setMutation(trigger);
    render(<QrRedemptionForm />);

    fireEvent.change(screen.getByLabelText('Pickup code'), {
      target: { value: 'offline.token.x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Redeem pickup' }));

    await waitFor(() => expect(screen.getByText(/Verified locally/)).toBeInTheDocument());
    expect(trigger).not.toHaveBeenCalled();
    expect(listQueuedRedemptions().map((item) => item.token)).toEqual(['offline.token.x']);
  });

  it('refuses a locally-invalid token outright, without queuing it', async () => {
    setOnline(false);
    mockedVerifyLocally.mockResolvedValue({ valid: false });
    setMutation(vi.fn());
    render(<QrRedemptionForm />);

    fireEvent.change(screen.getByLabelText('Pickup code'), { target: { value: 'garbage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Redeem pickup' }));

    await waitFor(() =>
      expect(
        screen.getByText('This pickup code could not be verified on this device.'),
      ).toBeInTheDocument(),
    );
    expect(listQueuedRedemptions()).toHaveLength(0);
  });

  it('drains the queue automatically on reconnect and reports success', async () => {
    setOnline(false);
    mockedVerifyLocally.mockResolvedValue({ valid: true });
    const trigger = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve(order()) });
    setMutation(trigger);
    render(<QrRedemptionForm />);

    fireEvent.change(screen.getByLabelText('Pickup code'), { target: { value: 'queued.token.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Redeem pickup' }));
    await waitFor(() => expect(listQueuedRedemptions()).toHaveLength(1));

    setOnline(true);
    dispatchConnectivity('online');

    await waitFor(() =>
      expect(trigger).toHaveBeenCalledWith({ token: 'queued.token.1', queuedOffline: true }),
    );
    await waitFor(() =>
      expect(screen.getByText('A queued pickup was confirmed.')).toBeInTheDocument(),
    );
    expect(listQueuedRedemptions()).toHaveLength(0);
  });

  it('surfaces a conflict — never a false success — when the queued redemption was already spent', async () => {
    setOnline(false);
    mockedVerifyLocally.mockResolvedValue({ valid: true });
    const trigger = vi
      .fn()
      .mockReturnValue({ unwrap: () => Promise.reject(new Error('conflict')) });
    setMutation(trigger);
    render(<QrRedemptionForm />);

    fireEvent.change(screen.getByLabelText('Pickup code'), { target: { value: 'queued.token.2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Redeem pickup' }));
    await waitFor(() => expect(listQueuedRedemptions()).toHaveLength(1));

    setOnline(true);
    dispatchConnectivity('online');

    await waitFor(() =>
      expect(screen.getByText(/could not be confirmed automatically/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('A queued pickup was confirmed.')).not.toBeInTheDocument();
    expect(screen.queryByText('Pickup completed')).not.toBeInTheDocument();
    expect(listQueuedRedemptions()).toHaveLength(0);
  });

  it('never echoes the raw token into any other element (banners, results) than the textarea itself', () => {
    setOnline(false);
    mockedVerifyLocally.mockResolvedValue({ valid: true });
    setMutation(vi.fn());
    render(<QrRedemptionForm />);

    const textarea = screen.getByLabelText('Pickup code');
    fireEvent.change(textarea, { target: { value: 'super-secret-token-value' } });

    // Ancestors of the textarea naturally aggregate its value into their own
    // `.textContent` (ordinary DOM behaviour, not leakage) — so only leaf
    // elements outside the textarea's own ancestor chain are checked, which
    // is where a banner or result message would actually echo it.
    const ancestors = new Set<Node>();
    for (let node: Node | null = textarea; node; node = node.parentNode) {
      ancestors.add(node);
    }
    document.body.querySelectorAll('*').forEach((node) => {
      if (ancestors.has(node) || node.children.length > 0) return;
      expect(node.textContent).not.toContain('super-secret-token-value');
    });
  });
});
