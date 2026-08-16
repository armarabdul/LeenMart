import type { OrderStatusDto } from '@leen-mart/contracts';

/** Shared between `OrderConfirmationPage` and `OrderHistoryPage` (S3-4) — extracted rather than duplicated. */
export const ORDER_STATUS_LABEL: Record<OrderStatusDto, string> = {
  PENDING_PAYMENT: 'Payment pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};
