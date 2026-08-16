/**
 * The audit vocabulary for this bounded context (SDD 18.4), following the
 * same dotted, bounded-context-scoped convention `vendor/domain/audit-actions.ts`
 * established.
 */
export const ORDER_AUDIT_ACTIONS = {
  /** A customer placed an order. */
  PLACED: 'order.placed',
  /** A customer cancelled their own order. */
  CANCELLED: 'order.cancelled',
  /** S3-3B: a payment attempt succeeded and the order moved PENDING_PAYMENT -> CONFIRMED. */
  CONFIRMED: 'order.confirmed',
  /** S3-3B: a payment attempt failed. The order itself is untouched — still PENDING_PAYMENT. */
  PAYMENT_FAILED: 'order.payment_failed',
  /**
   * S3-5: a vendor moved their own sub-order CONFIRMED -> PROCESSING. Used
   * as both the outbox `eventType` and the `AuditWriter` `action` — the
   * order module's first genuine `AuditWriter` caller (every use case before
   * this one was self-service and deliberately unaudited, see
   * `CancelOrderUseCase`'s own comment); a vendor's action affecting a
   * customer's order is exactly the kind of action `vendor`'s own KYC
   * decisions already treat as audit-worthy.
   */
  PROCESSING_STARTED: 'sub_order.processing_started',
} as const;

export type OrderAuditAction = (typeof ORDER_AUDIT_ACTIONS)[keyof typeof ORDER_AUDIT_ACTIONS];

export const ORDER_AUDIT_ENTITY_TYPES = {
  ORDER: 'Order',
  /** S3-5's own audit/outbox subject — a vendor's action is scoped to their one sub-order, never the whole multi-vendor order. */
  SUB_ORDER: 'SubOrder',
} as const;

export type OrderAuditEntityType =
  (typeof ORDER_AUDIT_ENTITY_TYPES)[keyof typeof ORDER_AUDIT_ENTITY_TYPES];
