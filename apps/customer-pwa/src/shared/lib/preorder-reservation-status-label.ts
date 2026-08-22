import type { PreorderReservationStatusDto } from '@leen-mart/contracts';

/** Shared between `MyReservationsPage` and `ReservationDetailPage` — extracted rather than duplicated. */
export const PREORDER_RESERVATION_STATUS_LABEL: Record<PreorderReservationStatusDto, string> = {
  PENDING: 'Awaiting advance payment',
  CONFIRMED: 'Confirmed',
  EXPIRED: 'Expired',
  PAYMENT_FAILED: 'Payment failed',
  CANCELLED: 'Cancelled',
};
