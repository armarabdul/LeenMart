import { useState } from 'react';
import type { ConfirmPaymentRequest } from '@leen-mart/contracts';
import { apiErrorMessage, isApiError } from '@/shared/api/base-api';
import { useConfirmPaymentMutation, useInitiatePaymentMutation } from '../payment.api';

interface TestPaymentPanelProps {
  readonly orderId: string;
}

type PaymentTestScenario = ConfirmPaymentRequest['testScenario'];

type PanelState = 'idle' | 'initiating' | 'awaitingScenario' | 'confirming' | 'failed';

/**
 * S3-3B's payment step, rendered inline on the order page whenever the order
 * is still `PENDING_PAYMENT` — no separate payment route (the confirmation
 * page already owns rendering this order; a payment attempt is just another
 * fact about it). The backend, never this component, decides whether a
 * payment actually succeeds: clicking a scenario button only selects which
 * deterministic outcome the mock gateway returns, then waits for the real
 * `POST .../payment/confirm` response — there is no local "confirmed" state
 * to fake.
 */
export const TestPaymentPanel = ({ orderId }: TestPaymentPanelProps): JSX.Element => {
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [initiatePayment, { error: initiateError }] = useInitiatePaymentMutation();
  const [confirmPayment, { error: confirmError }] = useConfirmPaymentMutation();

  const handleInitiate = async (): Promise<void> => {
    setPanelState('initiating');
    try {
      await initiatePayment({ orderId, idempotencyKey: crypto.randomUUID() }).unwrap();
      setPanelState('awaitingScenario');
    } catch (error) {
      // A refreshed page can find an attempt this component never saw
      // initiated (S3-3B: at most one INITIATED attempt per order) — that is
      // not a failure, it is exactly the state this panel wants to reach.
      if (isApiError(error) && error.data.error.code === 'ORDER_PAYMENT_ALREADY_INITIATED') {
        setPanelState('awaitingScenario');
        return;
      }
      setPanelState('failed');
    }
  };

  const handleConfirm = async (testScenario: PaymentTestScenario): Promise<void> => {
    setPanelState('confirming');
    try {
      await confirmPayment({ orderId, testScenario, idempotencyKey: crypto.randomUUID() }).unwrap();
      // Success: `confirmPayment`'s own tag invalidation refetches this
      // order as CONFIRMED, and the parent stops rendering this panel at
      // all — there is no local "done" state to show here.
    } catch {
      setPanelState('failed');
    }
  };

  return (
    <section
      aria-label="Payment"
      className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
        Payment — TEST / DEMO mode
      </h2>
      <p className="text-sm text-amber-800">
        This is a test environment. No real payment provider is contacted and no real charge is ever
        made — every outcome below is simulated.
      </p>

      {panelState === 'idle' && (
        <button
          type="button"
          onClick={() => void handleInitiate()}
          className="self-start rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Start test payment
        </button>
      )}

      {panelState === 'initiating' && (
        <p className="text-sm text-amber-800" role="status">
          Starting payment…
        </p>
      )}

      {panelState === 'awaitingScenario' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-amber-800">Choose a test outcome to simulate:</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleConfirm('SUCCEEDED')}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Simulate successful payment
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm('FAILED')}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              Simulate failed payment
            </button>
          </div>
        </div>
      )}

      {panelState === 'confirming' && (
        <p className="text-sm text-amber-800" role="status">
          Confirming payment…
        </p>
      )}

      {panelState === 'failed' && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-red-700">
            {apiErrorMessage(
              confirmError ?? initiateError,
              'The payment could not be completed. Please try again.',
            )}
          </p>
          <button
            type="button"
            onClick={() => void handleInitiate()}
            className="self-start rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Retry payment
          </button>
        </div>
      )}
    </section>
  );
};
