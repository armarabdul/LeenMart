import { useState } from 'react';
import type { ConfirmReservationPaymentRequest } from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage, isApiError } from '@/shared/api/base-api';
import {
  useConfirmAdvancePaymentMutation,
  useConfirmBalancePaymentMutation,
  useInitiateAdvancePaymentMutation,
  useInitiateBalancePaymentMutation,
} from '../preorder.api';

interface ReservationPaymentPanelProps {
  readonly reservationId: string;
  readonly kind: 'ADVANCE' | 'BALANCE';
  readonly amountLabel: string;
}

type PaymentTestScenario = ConfirmReservationPaymentRequest['testScenario'];
type PanelState = 'idle' | 'initiating' | 'awaitingScenario' | 'confirming' | 'failed';

const isBusy = (state: PanelState): boolean => state === 'initiating' || state === 'confirming';

/**
 * Every branch this panel needs — which pair of mutations to drive, and the
 * initiate/confirm handlers themselves — lives here, out of the component's
 * own render function, purely to keep that function within this
 * repository's complexity budget. Mirrors `TestPaymentPanel`'s own two
 * handlers, parameterised over `kind` instead of duplicated per kind.
 */
const useReservationPayment = (
  reservationId: string,
  kind: 'ADVANCE' | 'BALANCE',
): {
  readonly panelState: PanelState;
  readonly initiateError: unknown;
  readonly confirmError: unknown;
  readonly handleInitiate: () => Promise<void>;
  readonly handleConfirm: (testScenario: PaymentTestScenario) => Promise<void>;
} => {
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [initiateAdvance, { error: initiateAdvanceError }] = useInitiateAdvancePaymentMutation();
  const [confirmAdvance, { error: confirmAdvanceError }] = useConfirmAdvancePaymentMutation();
  const [initiateBalance, { error: initiateBalanceError }] = useInitiateBalancePaymentMutation();
  const [confirmBalance, { error: confirmBalanceError }] = useConfirmBalancePaymentMutation();

  const initiate = kind === 'ADVANCE' ? initiateAdvance : initiateBalance;
  const confirm = kind === 'ADVANCE' ? confirmAdvance : confirmBalance;
  const initiateError = kind === 'ADVANCE' ? initiateAdvanceError : initiateBalanceError;
  const confirmError = kind === 'ADVANCE' ? confirmAdvanceError : confirmBalanceError;

  const handleInitiate = async (): Promise<void> => {
    setPanelState('initiating');
    try {
      await initiate({ reservationId, idempotencyKey: crypto.randomUUID() }).unwrap();
      setPanelState('awaitingScenario');
    } catch (error) {
      // Mirrors `TestPaymentPanel`'s own reasoning: a refreshed page can find
      // an attempt this component never saw initiated — not a failure, it is
      // exactly the state this panel wants to reach.
      if (isApiError(error) && error.data.error.code === 'PREORDER_PAYMENT_ALREADY_INITIATED') {
        setPanelState('awaitingScenario');
        return;
      }
      setPanelState('failed');
    }
  };

  const handleConfirm = async (testScenario: PaymentTestScenario): Promise<void> => {
    setPanelState('confirming');
    try {
      await confirm({ reservationId, testScenario, idempotencyKey: crypto.randomUUID() }).unwrap();
      // Success: the mutation's own tag invalidation refetches this
      // reservation into its next status, and the parent stops rendering
      // this panel — nothing local to show here.
    } catch {
      setPanelState('failed');
    }
  };

  return { panelState, initiateError, confirmError, handleInitiate, handleConfirm };
};

const PanelHeading = ({ kind }: { readonly kind: 'ADVANCE' | 'BALANCE' }): JSX.Element => (
  <h2 className="text-sm font-semibold text-text">
    {kind === 'ADVANCE' ? 'Pay advance' : 'Pay remaining balance'} — TEST / DEMO mode
  </h2>
);

/**
 * The mock payment step for one reservation's advance or balance
 * (`kind` picks which pair of mutations this instance drives) — mirrors
 * `TestPaymentPanel` (order module) exactly, including its most important
 * property: clicking a scenario button only selects which deterministic
 * outcome the mock gateway returns, then waits for the real
 * `.../confirm` response. There is no local "confirmed" state to fake —
 * success is rendered by the parent no longer showing this panel at all,
 * once the reservation refetches into its next status.
 */
export const ReservationPaymentPanel = ({
  reservationId,
  kind,
  amountLabel,
}: ReservationPaymentPanelProps): JSX.Element => {
  const { panelState, initiateError, confirmError, handleInitiate, handleConfirm } =
    useReservationPayment(reservationId, kind);

  return (
    <section
      aria-label={kind === 'ADVANCE' ? 'Advance payment' : 'Balance payment'}
      aria-busy={isBusy(panelState) || undefined}
      className="flex flex-col gap-3 rounded-card border border-warning/30 bg-warning/10 p-4"
    >
      <PanelHeading kind={kind} />
      <p className="text-sm text-text-muted">
        {amountLabel} — no real payment provider is contacted; every outcome below is simulated.
      </p>

      {panelState === 'idle' && (
        <Button type="button" className="self-start" onClick={() => void handleInitiate()}>
          Start test payment
        </Button>
      )}

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
