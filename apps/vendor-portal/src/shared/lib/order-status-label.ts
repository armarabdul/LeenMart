import type { OrderStatusDto } from '@leen-mart/contracts';

/** Mirrors `customer-pwa`'s own `ORDER_STATUS_LABEL` — same wording, so a vendor and a customer read the same status the same way. */
export const ORDER_STATUS_LABEL: Record<OrderStatusDto, string> = {
  PENDING_PAYMENT: 'Payment pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};
