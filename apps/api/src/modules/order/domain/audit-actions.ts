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
} as const;

export type OrderAuditAction = (typeof ORDER_AUDIT_ACTIONS)[keyof typeof ORDER_AUDIT_ACTIONS];

export const ORDER_AUDIT_ENTITY_TYPES = {
  ORDER: 'Order',
} as const;

export type OrderAuditEntityType =
  (typeof ORDER_AUDIT_ENTITY_TYPES)[keyof typeof ORDER_AUDIT_ENTITY_TYPES];
