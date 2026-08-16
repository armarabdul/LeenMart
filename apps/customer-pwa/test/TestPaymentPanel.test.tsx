import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from '@/app/store';
import { TestPaymentPanel } from '@/features/payment/components/TestPaymentPanel';
import {
  useConfirmPaymentMutation,
  useInitiatePaymentMutation,
} from '@/features/payment/payment.api';

vi.mock('@/features/payment/payment.api', () => ({
  useInitiatePaymentMutation: vi.fn(),
  useConfirmPaymentMutation: vi.fn(),
}));

const mockedUseInitiatePaymentMutation = vi.mocked(useInitiatePaymentMutation);
const mockedUseConfirmPaymentMutation = vi.mocked(useConfirmPaymentMutation);

/** `unwrap()` rejects with the plain API-error envelope (never an `Error` instance) — wrapped in one here only to satisfy the lint rule, `isApiError` reads `.status`/`.data`, not `instanceof`. */
const apiRejection = (status: number, code: string, message: string): Error =>
  Object.assign(new Error(message), { status, data: { error: { code, message } } });

const renderPanel = (options: {
  initiateError?: unknown;
  confirmError?: unknown;
}): { initiatePayment: ReturnType<typeof vi.fn>; confirmPayment: ReturnType<typeof vi.fn> } => {
  const initiatePayment = vi.fn();
  const confirmPayment = vi.fn();

  mockedUseInitiatePaymentMutation.mockReturnValue([
    initiatePayment,
    { isLoading: false, error: options.initiateError },
  ] as unknown as ReturnType<typeof useInitiatePaymentMutation>);
  mockedUseConfirmPaymentMutation.mockReturnValue([
    confirmPayment,
    { isLoading: false, error: options.confirmError },
  ] as unknown as ReturnType<typeof useConfirmPaymentMutation>);

  render(
    <Provider store={createStore()}>
      <TestPaymentPanel orderId="order-1" />
    </Provider>,
  );

  return { initiatePayment, confirmPayment };
};

describe('TestPaymentPanel', () => {
  it('clearly labels itself as TEST/DEMO mode, with no real gateway branding', () => {
    renderPanel({});

    expect(screen.getByText('Payment — TEST / DEMO mode')).toBeInTheDocument();
    expect(screen.queryByText(/razorpay/i)).not.toBeInTheDocument();
  });

  it('shows no COD option anywhere on the panel', () => {
    renderPanel({});

    expect(screen.queryByText(/cash on delivery/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bCOD\b/)).not.toBeInTheDocument();
  });

  it('starts a payment attempt and offers both scenario buttons once initiated', async () => {
    const { initiatePayment } = renderPanel({});
    initiatePayment.mockReturnValue({ unwrap: () => Promise.resolve({ orderId: 'order-1' }) });

    fireEvent.click(screen.getByRole('button', { name: 'Start test payment' }));

    expect(screen.getByRole('status')).toHaveTextContent('Starting payment…');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Simulate successful payment' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Simulate failed payment' })).toBeInTheDocument();
    expect(initiatePayment).toHaveBeenCalledTimes(1);
    const call = initiatePayment.mock.calls[0]?.[0] as {
      orderId: string;
      idempotencyKey: string;
    };
    expect(call.orderId).toBe('order-1');
    expect(typeof call.idempotencyKey).toBe('string');
    expect(call.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('treats an already-initiated attempt as reaching the scenario step, not a failure', async () => {
    const { initiatePayment } = renderPanel({});
    initiatePayment.mockReturnValue({
      unwrap: () =>
        Promise.reject(apiRejection(409, 'ORDER_PAYMENT_ALREADY_INITIATED', 'Already initiated.')),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start test payment' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Simulate successful payment' }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a loading state while confirming, then calls confirmPayment with the chosen scenario', async () => {
    const { initiatePayment, confirmPayment } = renderPanel({});
    initiatePayment.mockReturnValue({ unwrap: () => Promise.resolve({ orderId: 'order-1' }) });
    let resolveConfirm: (() => void) | undefined;
    confirmPayment.mockReturnValue({
      unwrap: () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start test payment' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Simulate successful payment' }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }));

    expect(screen.getByRole('status')).toHaveTextContent('Confirming payment…');
    expect(confirmPayment).toHaveBeenCalledTimes(1);
    const call = confirmPayment.mock.calls[0]?.[0] as {
      orderId: string;
      testScenario: string;
      idempotencyKey: string;
    };
    expect(call.orderId).toBe('order-1');
    expect(call.testScenario).toBe('SUCCEEDED');
    expect(typeof call.idempotencyKey).toBe('string');

    resolveConfirm?.();
  });

  it('surfaces a failed mock payment and offers a retry that re-initiates', async () => {
    const { initiatePayment, confirmPayment } = renderPanel({
      confirmError: {
        status: 422,
        data: { error: { code: 'PAYMENT_FAILED', message: 'The payment could not be completed.' } },
      },
    });
    initiatePayment.mockReturnValue({ unwrap: () => Promise.resolve({ orderId: 'order-1' }) });
    confirmPayment.mockReturnValue({
      unwrap: () =>
        Promise.reject(apiRejection(422, 'PAYMENT_FAILED', 'The payment could not be completed.')),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start test payment' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Simulate failed payment' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Simulate failed payment' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('The payment could not be completed.');
    expect(screen.getByRole('button', { name: 'Retry payment' })).toBeInTheDocument();

    initiatePayment.mockClear();
    initiatePayment.mockReturnValue({ unwrap: () => Promise.resolve({ orderId: 'order-1' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry payment' }));
    expect(initiatePayment).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Simulate successful payment' }),
      ).toBeInTheDocument(),
    );
  });

  it('surfaces an initiation failure unrelated to an already-existing attempt', async () => {
    const { initiatePayment } = renderPanel({
      initiateError: {
        status: 404,
        data: { error: { code: 'ORDER_NOT_FOUND', message: 'The requested order was not found.' } },
      },
    });
    initiatePayment.mockReturnValue({
      unwrap: () =>
        Promise.reject(apiRejection(404, 'ORDER_NOT_FOUND', 'The requested order was not found.')),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start test payment' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('The requested order was not found.');
  });
});
