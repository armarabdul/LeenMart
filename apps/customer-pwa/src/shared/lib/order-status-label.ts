import type { OrderStatusDto } from '@leen-mart/contracts';

/** Shared between `OrderConfirmationPage` and `OrderHistoryPage` (S3-4) — extracted rather than duplicated. */
export const ORDER_STATUS_LABEL: Record<OrderStatusDto, string> = {
  PENDING_PAYMENT: 'Payment pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  // S4-QR: pickup-mode states. Same wording in both apps, so a vendor and a
  // customer read the same status the same way.
  READY_FOR_PICKUP: 'Ready for pickup',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
