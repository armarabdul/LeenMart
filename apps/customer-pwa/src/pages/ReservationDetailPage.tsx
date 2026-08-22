import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ReservationResponse } from '@leen-mart/contracts';
import { Alert, Button, Card, Skeleton, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { PREORDER_RESERVATION_STATUS_LABEL } from '@/shared/lib/preorder-reservation-status-label';
import { PREORDER_RESERVATION_STATUS_TONE } from '@/shared/lib/preorder-reservation-status-tone';
import { PageContainer } from '@/components/PageContainer';
import { ReservationCountdown } from '@/features/preorder/components/ReservationCountdown';
import { ReservationPaymentPanel } from '@/features/preorder/components/ReservationPaymentPanel';
import {
  useCancelReservationMutation,
  useGetReservationQuery,
} from '@/features/preorder/preorder.api';

const DetailSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading reservation">
    <Skeleton shape="rect" className="h-8 w-2/3" />
    <Skeleton shape="rect" className="h-32 w-full" />
  </div>
);

const hasOutstandingBalance = (reservation: ReservationResponse): boolean =>
  reservation.status === 'CONFIRMED' &&
  reservation.balancePaidAt === null &&
  Number(reservation.balanceAmount.amount) > 0;

const canCancel = (reservation: ReservationResponse): boolean =>
  (reservation.status === 'PENDING' || reservation.status === 'CONFIRMED') &&
  reservation.convertedOrderId === null;

const ReservationSummaryCard = ({
  reservation,
  onExpire,
}: {
  readonly reservation: ReservationResponse;
  readonly onExpire: () => void;
}): JSX.Element => (
  <Card className="flex flex-col gap-2 text-sm">
    <div className="flex justify-between">
      <span className="text-text-muted">Quantity</span>
      <span className="text-text">{reservation.quantity}</span>
    </div>
    <div className="flex justify-between">
      <span className="text-text-muted">Fulfilment</span>
      <span className="text-text">
        {reservation.fulfilmentMode === 'PICKUP' ? 'Pickup' : 'Delivery'}
      </span>
    </div>
    <div className="flex justify-between">
      <span className="text-text-muted">Unit price</span>
      <span className="text-text">{formatMoney(reservation.unitPrice)}</span>
    </div>
    <div className="flex justify-between">
      <span className="text-text-muted">Advance</span>
      <span className="text-text">{formatMoney(reservation.advanceAmount)}</span>
    </div>
    <div className="flex justify-between">
      <span className="text-text-muted">Balance</span>
      <span className="text-text">
        {formatMoney(reservation.balanceAmount)}
        {reservation.balancePaidAt !== null && ' (paid)'}
      </span>
    </div>
    {reservation.status === 'PENDING' && (
      <div className="flex justify-between">
        <span className="text-text-muted">Time left to pay advance</span>
        <ReservationCountdown expiresAt={reservation.expiresAt} onExpire={onExpire} />
      </div>
    )}
  </Card>
);

/**
 * Every status-dependent notice this page can show, one at a time — split
 * out purely to keep `ReservationDetailPage` itself within this
 * repository's complexity budget. Mirrors the reservation state machine
 * exactly: exactly one of these renders for any given reservation.
 */
const ReservationStatusNotice = ({
  reservation,
}: {
  readonly reservation: ReservationResponse;
}): JSX.Element | null => {
  if (reservation.convertedOrderId !== null) {
    return (
      <Alert tone="success" title="Converted to an order">
        This reservation has been converted into an order.{' '}
        <Link
          to={`/orders/${reservation.convertedOrderId}`}
          className="font-medium underline underline-offset-2"
        >
          View order
        </Link>
      </Alert>
    );
  }
  if (reservation.status === 'CONFIRMED' && !hasOutstandingBalance(reservation)) {
    return (
      <Alert tone="info">
        Your reservation is confirmed and the balance is paid. It will convert into an order once
        the vendor’s fulfilment window opens.
      </Alert>
    );
  }
  if (reservation.status === 'EXPIRED') {
    return (
      <Alert tone="warning">
        This reservation expired before the advance payment was completed, and the held quantity was
        released.
      </Alert>
    );
  }
  if (reservation.status === 'PAYMENT_FAILED') {
    return <Alert tone="danger">The advance payment for this reservation failed.</Alert>;
  }
  if (reservation.status === 'CANCELLED') {
    return <Alert tone="info">This reservation was cancelled.</Alert>;
  }
  return null;
};

/** The payment panel this reservation needs right now, if any — `PENDING` needs the advance, a `CONFIRMED`-with-unpaid-balance needs the balance, everything else needs neither. */
const ReservationPaymentSection = ({
  reservation,
}: {
  readonly reservation: ReservationResponse;
}): JSX.Element | null => {
  if (reservation.status === 'PENDING') {
    return (
      <ReservationPaymentPanel
        reservationId={reservation.id}
        kind="ADVANCE"
        amountLabel={`Advance due: ${formatMoney(reservation.advanceAmount)}`}
      />
    );
  }
  if (hasOutstandingBalance(reservation)) {
    return (
      <ReservationPaymentPanel
        reservationId={reservation.id}
        kind="BALANCE"
        amountLabel={`Balance due: ${formatMoney(reservation.balanceAmount)}`}
      />
    );
  }
  return null;
};

/** The cancel action's own mutation state — split out purely to keep `ReservationDetailPage` within this repository's complexity budget. */
const CancelReservationAction = ({
  reservation,
}: {
  readonly reservation: ReservationResponse;
}): JSX.Element | null => {
  const [cancelReservation, { isLoading: isCancelling, error: cancelError }] =
    useCancelReservationMutation();
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  if (!canCancel(reservation)) return null;

  const handleCancel = async (): Promise<void> => {
    try {
      await cancelReservation({ reservationId: reservation.id, idempotencyKey }).unwrap();
    } catch {
      // Surfaced below via `cancelError`.
    }
  };

  return (
    <>
      {cancelError !== undefined && (
        <Alert tone="danger">
          {apiErrorMessage(cancelError, 'This reservation could not be cancelled.')}
        </Alert>
      )}
      <Button
        type="button"
        variant="secondary"
        className="self-start text-danger hover:bg-danger/10"
        disabled={isCancelling}
        loading={isCancelling}
        onClick={() => void handleCancel()}
      >
        Cancel reservation
      </Button>
    </>
  );
};

/**
 * One reservation's own status page (Phase Next) — the customer's control
 * centre for a single preorder hold. Every reservation state renders a
 * different set of actions, and no action is ever offered that the backend
 * would refuse — see `ReservationStatusNotice`/`ReservationPaymentSection`/
 * `CancelReservationAction`'s own doc comments for exactly which state maps
 * to which surface.
 */
export const ReservationDetailPage = (): JSX.Element => {
  const { reservationId } = useParams<{ reservationId: string }>();
  const navigate = useNavigate();
  const {
    data: reservation,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetReservationQuery(reservationId ?? '', { skip: !reservationId });

  if (!reservationId) {
    return (
      <main>
        <PageContainer>
          <div className="py-12 sm:py-16">
            <Alert tone="danger">This reservation could not be found.</Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main>
        <PageContainer>
          <div className="py-6 sm:py-8">
            <DetailSkeleton />
          </div>
        </PageContainer>
      </main>
    );
  }

  if (isError || !reservation) {
    return (
      <main>
        <PageContainer>
          <div className="py-6 sm:py-8">
            <Alert tone="danger" title="This reservation couldn’t be loaded">
              {apiErrorMessage(error, 'This reservation could not be loaded.')}
            </Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  return (
    <main>
      <PageContainer>
        <div className="flex flex-col gap-6 py-6 sm:py-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
                Reservation
              </h1>
              <p className="mt-1 font-mono text-xs text-text-faint">{reservation.id}</p>
            </div>
            <StatusBadge
              tone={PREORDER_RESERVATION_STATUS_TONE[reservation.status]}
              label={PREORDER_RESERVATION_STATUS_LABEL[reservation.status]}
            />
          </div>

          <ReservationSummaryCard reservation={reservation} onExpire={() => void refetch()} />
          <ReservationStatusNotice reservation={reservation} />
          <ReservationPaymentSection reservation={reservation} />
          <CancelReservationAction reservation={reservation} />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => void navigate('/my-reservations')}
          >
            Back to my reservations
          </Button>
        </div>
      </PageContainer>
    </main>
  );
};
