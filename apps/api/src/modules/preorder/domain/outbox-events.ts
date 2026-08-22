/** SDD §5 module #9's named events: `PreorderOpened/PreorderSoldOut/PreorderExpired/PreorderCancelled`. */
export const PREORDER_OUTBOX_EVENTS = {
  OPENED: 'preorder.opened',
  SOLD_OUT: 'preorder.sold_out',
  CLOSED: 'preorder.closed',
  CANCELLED: 'preorder.cancelled',
  RESERVATION_CREATED: 'preorder.reservation_created',
  RESERVATION_CONFIRMED: 'preorder.reservation_confirmed',
  RESERVATION_EXPIRED: 'preorder.reservation_expired',
  RESERVATION_PAYMENT_INITIATED_ADVANCE: 'preorder.reservation_payment_initiated.advance',
  RESERVATION_PAYMENT_INITIATED_BALANCE: 'preorder.reservation_payment_initiated.balance',
  RESERVATION_PAYMENT_FAILED_ADVANCE: 'preorder.reservation_payment_failed.advance',
  RESERVATION_PAYMENT_FAILED_BALANCE: 'preorder.reservation_payment_failed.balance',
  RESERVATION_BALANCE_PAID: 'preorder.reservation_balance_paid',
  RESERVATION_CANCELLED: 'preorder.reservation_cancelled',
} as const;
