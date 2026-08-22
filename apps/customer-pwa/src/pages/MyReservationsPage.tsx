import { Link } from 'react-router-dom';
import type { ReservationResponse } from '@leen-mart/contracts';
import { Alert, Card, EmptyState, Skeleton, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { PREORDER_RESERVATION_STATUS_LABEL } from '@/shared/lib/preorder-reservation-status-label';
import { PREORDER_RESERVATION_STATUS_TONE } from '@/shared/lib/preorder-reservation-status-tone';
import { PageContainer } from '@/components/PageContainer';
import { useListMyReservationsQuery } from '@/features/preorder/preorder.api';

const ReservationsIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-8 w-8 text-text-faint">
    <path
      d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const ReservationsSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your reservations">
    {Array.from({ length: 3 }, (_, index) => (
      <Skeleton key={index} shape="rect" className="h-20 w-full" />
    ))}
  </div>
);

const formatReservationDate = (isoDateTime: string): string =>
  new Date(isoDateTime).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const ReservationRow = ({
  reservation,
}: {
  readonly reservation: ReservationResponse;
}): JSX.Element => (
  <li>
    <Link to={`/my-reservations/${reservation.id}`} className="block">
      <Card interactive className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-mono text-xs text-text-faint">{reservation.id}</span>
          <span className="text-sm text-text-muted">
            {formatReservationDate(reservation.createdAt)}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge
            tone={PREORDER_RESERVATION_STATUS_TONE[reservation.status]}
            label={PREORDER_RESERVATION_STATUS_LABEL[reservation.status]}
          />
          <span className="text-sm font-semibold text-text">
            {formatMoney({
              amount: String(
                Number(reservation.advanceAmount.amount) + Number(reservation.balanceAmount.amount),
              ),
              currency: 'INR',
            })}
          </span>
        </div>
      </Card>
    </Link>
  </li>
);

/** "My Reservations" (Phase Next) — mirrors `OrderHistoryPage` exactly. */
export const MyReservationsPage = (): JSX.Element => {
  const { data: reservations, isLoading, isError, error } = useListMyReservationsQuery();

  if (isLoading) {
    return (
      <main>
        <PageContainer>
          <div className="flex flex-col gap-6 py-6 sm:py-8">
            <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
              My reservations
            </h1>
            <ReservationsSkeleton />
          </div>
        </PageContainer>
      </main>
    );
  }

  if (isError || !reservations) {
    return (
      <main>
        <PageContainer>
          <div className="flex flex-col gap-6 py-6 sm:py-8">
            <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
              My reservations
            </h1>
            <Alert tone="danger" title="Your reservations couldn’t be loaded">
              {apiErrorMessage(error, 'Your reservations could not be loaded. Please try again.')}
            </Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  if (reservations.length === 0) {
    return (
      <main>
        <PageContainer>
          <div className="py-12 sm:py-16">
            <EmptyState
              icon={<ReservationsIcon />}
              title="No preorder reservations yet"
              description="Reservations you make will show up here."
              action={
                <Link
                  to="/preorders"
                  className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  Browse preorders
                </Link>
              }
            />
          </div>
        </PageContainer>
      </main>
    );
  }

  return (
    <main>
      <PageContainer>
        <div className="flex flex-col gap-6 py-6 sm:py-8">
          <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
            My reservations
          </h1>
          <ul className="flex flex-col gap-3">
            {reservations.map((reservation) => (
              <ReservationRow key={reservation.id} reservation={reservation} />
            ))}
          </ul>
        </div>
      </PageContainer>
    </main>
  );
};
