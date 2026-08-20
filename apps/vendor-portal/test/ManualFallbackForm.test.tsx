import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VendorSubOrderResponse } from '@leen-mart/contracts';
import { ManualFallbackForm } from '@/features/vendor-order/components/ManualFallbackForm';
import { useCompletePickupManuallyMutation } from '@/features/vendor-order/vendor-order.api';

vi.mock('@/features/vendor-order/vendor-order.api', () => ({
  useCompletePickupManuallyMutation: vi.fn(),
}));

const mockedUseCompletePickupManuallyMutation = vi.mocked(useCompletePickupManuallyMutation);

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

interface MutationState {
  readonly isLoading?: boolean;
  readonly error?: unknown;
  readonly data?: VendorSubOrderResponse;
}

const setMutation = (trigger: ReturnType<typeof vi.fn>, state: MutationState = {}): void => {
  mockedUseCompletePickupManuallyMutation.mockReturnValue([
    trigger,
    {
      isLoading: state.isLoading ?? false,
      error: state.error,
      data: state.data,
      reset: vi.fn(),
    },
  ] as unknown as ReturnType<typeof useCompletePickupManuallyMutation>);
};

const openFallback = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Scanner broken?' }));
};

describe('ManualFallbackForm (S4-QR-FALLBACK)', () => {
  it('is collapsed by default — the QR path stays the obvious default', () => {
    setMutation(vi.fn());
    render(<ManualFallbackForm />);

    expect(screen.queryByLabelText('4-digit code')).not.toBeInTheDocument();
  });

  it('opens the manual fallback form on click', () => {
    setMutation(vi.fn());
    render(<ManualFallbackForm />);

    openFallback();

    expect(screen.getByLabelText('4-digit code')).toBeInTheDocument();
    expect(screen.getByLabelText('Order (sub-order id)')).toBeInTheDocument();
  });

  it('rejects non-digit characters and caps input at 4 digits', () => {
    setMutation(vi.fn());
    render(<ManualFallbackForm />);
    openFallback();

    const input = screen.getByLabelText('4-digit code');
    fireEvent.change(input, { target: { value: 'ab12cd3456' } });

    expect(input).toHaveValue('1234');
  });

  it('disables submit until both a sub-order id and a full 4-digit code are present', () => {
    setMutation(vi.fn());
    render(<ManualFallbackForm />);
    openFallback();

    const submit = screen.getByRole('button', { name: 'Complete pickup manually' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Order (sub-order id)'), {
      target: { value: 'sub-order-1' },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('4-digit code'), { target: { value: '482' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('4-digit code'), { target: { value: '4821' } });
    expect(submit).toBeEnabled();
  });

  it('submits the sub-order id and code, and shows the completed state', async () => {
    const trigger = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve(order()) });
    setMutation(trigger);
    const { rerender } = render(<ManualFallbackForm />);
    openFallback();

    fireEvent.change(screen.getByLabelText('Order (sub-order id)'), {
      target: { value: 'sub-order-1' },
    });
    fireEvent.change(screen.getByLabelText('4-digit code'), { target: { value: '4821' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete pickup manually' }));

    await waitFor(() =>
      expect(trigger).toHaveBeenCalledWith({
        subOrderId: 'sub-order-1',
        body: { code: '4821' },
      }),
    );

    setMutation(trigger, { data: order() });
    rerender(<ManualFallbackForm />);

    expect(screen.getByText('Pickup completed (manual fallback)')).toBeInTheDocument();
  });

  it('shows the backend’s own uniform error message on failure', async () => {
    const trigger = vi.fn().mockReturnValue({
      unwrap: () =>
        Promise.reject(
          Object.assign(new Error('rejected'), {
            status: 422,
            data: {
              error: {
                code: 'PICKUP_TOKEN_INVALID',
                message: 'This pickup could not be completed.',
              },
            },
          }),
        ),
    });
    setMutation(trigger, {
      error: {
        status: 422,
        data: {
          error: { code: 'PICKUP_TOKEN_INVALID', message: 'This pickup could not be completed.' },
        },
      },
    });
    render(<ManualFallbackForm />);
    openFallback();

    fireEvent.change(screen.getByLabelText('Order (sub-order id)'), {
      target: { value: 'sub-order-1' },
    });
    fireEvent.change(screen.getByLabelText('4-digit code'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete pickup manually' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This pickup could not be completed.'),
    );
  });

  it('never renders the plaintext code anywhere outside the input itself', () => {
    setMutation(vi.fn());
    render(<ManualFallbackForm />);
    openFallback();

    fireEvent.change(screen.getByLabelText('4-digit code'), { target: { value: '4821' } });

    // The only element allowed to contain the code is the input control
    // itself (as its `value`) — nowhere else in the rendered DOM.
    const codeInput = screen.getByLabelText('4-digit code');
    document.body.querySelectorAll('*').forEach((node) => {
      if (node === codeInput) return;
      expect(node.textContent).not.toContain('4821');
    });
  });
});
