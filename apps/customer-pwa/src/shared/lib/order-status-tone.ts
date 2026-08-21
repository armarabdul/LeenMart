import type { OrderStatusDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

/**
 * Maps Leen Mart's order lifecycle onto the design system's four status
 * tones (Phase E).
 *
 * `StatusBadge` deliberately takes a tone rather than a domain status — see
 * its own doc comment — so the mapping has to live on the domain side. It
 * sits in `shared/` because both the order list and order detail need it and
 * a feature may never import another feature.
 *
 * The tones carry meaning and are not decoration: `warning` is "you still
 * have something to do" (payment is owed), `info` is "in motion, nothing
 * required from you", `success` is "this order arrived", and `danger` is the
 * one terminal state that did not.
 */
export const ORDER_STATUS_TONE: Record<OrderStatusDto, StatusBadgeProps['tone']> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  READY_FOR_PICKUP: 'info',
  DELIVERED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};
