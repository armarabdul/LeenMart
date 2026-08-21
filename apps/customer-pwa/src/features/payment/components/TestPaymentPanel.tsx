import { useState } from 'react';
import type { ConfirmPaymentRequest } from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage, isApiError } from '@/shared/api/base-api';
import { useConfirmPaymentMutation, useInitiatePaymentMutation } from '../payment.api';

interface TestPaymentPanelProps {
  readonly orderId: string;
}

type PaymentTestScenario = ConfirmPaymentRequest['testScenario'];

type PanelState = 'idle' | 'initiating' | 'awaitingScenario' | 'confirming' | 'failed';

/** The two states in which a request is in flight and no control may look actionable. */
const isBusy = (state: PanelState): boolean => state === 'initiating' || state === 'confirming';

/**
 * S3-3B's payment step, rendered inline on the order page whenever the order
 * is still `PENDING_PAYMENT` — no separate payment route (the confirmation
 * page already owns rendering this order; a payment attempt is just another
 * fact about it). The backend, never this component, decides whether a
 * payment actually succeeds: clicking a scenario button only selects which
 * deterministic outcome the mock gateway returns, then waits for the real
 * `POST .../payment/confirm` response — there is no local "confirmed" state
 * to fake.
 *
 * **Phase E presentation.** Every in-flight state replaces the controls
 * rather than merely dimming them, so there is never a moment where a button
 * looks pressable while a payment request is outstanding, and the progress
 * text lives in a single `role="status"` region so a screen reader hears the
 * transition. Success is deliberately not rendered here at all: when the
 * confirmation succeeds this panel's own tag invalidation refetches the order
 * as `CONFIRMED` and the parent stops rendering the panel — so a "payment
 * successful" message can never appear ahead of the server agreeing.
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
      aria-busy={isBusy(panelState) || undefined}
      className="flex flex-col gap-3 rounded-card border border-warning/30 bg-warning/10 p-4"
    >
      <h2 className="text-sm font-semibold text-text">Payment — TEST / DEMO mode</h2>
      <p className="text-sm text-text-muted">
        This is a test environment. No real payment provider is contacted and no real charge is ever
        made — every outcome below is simulated.
      </p>

      {panelState === 'idle' && (
        <Button type="button" className="self-start" onClick={() => void handleInitiate()}>
          Start test payment
        </Button>
      )}

      {/* One live region for the whole panel: the customer hears "Starting
          payment…" then "Confirming payment…" from the same place rather than
          from two regions that compete. */}
      {isBusy(panelState) && (
        <p className="flex items-center gap-2 text-sm text-text" role="status">
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-faint border-t-transparent"
          />
          {panelState === 'initiating' ? 'Starting payment…' : 'Confirming payment…'}
        </p>
      )}

      {panelState === 'awaitingScenario' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-muted">Choose a test outcome to simulate:</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void handleConfirm('SUCCEEDED')}>
              Simulate successful payment
            </Button>
            <Button type="button" variant="danger" onClick={() => void handleConfirm('FAILED')}>
              Simulate failed payment
            </Button>
          </div>
        </div>
      )}

      {panelState === 'failed' && (
        <div className="flex flex-col gap-3">
          <Alert tone="danger" title="Payment not completed">
            {apiErrorMessage(
              confirmError ?? initiateError,
              'The payment could not be completed. Please try again.',
            )}
          </Alert>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => void handleInitiate()}
          >
            Retry payment
          </Button>
        </div>
      )}
    </section>
  );
};
