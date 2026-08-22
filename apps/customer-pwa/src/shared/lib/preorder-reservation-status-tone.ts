import type { PreorderReservationStatusDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

export const PREORDER_RESERVATION_STATUS_TONE: Record<
  PreorderReservationStatusDto,
  StatusBadgeProps['tone']
> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  EXPIRED: 'neutral',
  PAYMENT_FAILED: 'danger',
  CANCELLED: 'neutral',
};
