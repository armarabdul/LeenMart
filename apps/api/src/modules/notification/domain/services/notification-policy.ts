/** Who a notification is for. A vendor owner is also a user, so this is what separates the two inboxes. */
export type NotificationRecipientKind = 'CUSTOMER' | 'VENDOR';

/** SDD 11.2 names four channels; S6-NOTIFY-INAPP implements the one with no external dependency. */
export type NotificationChannelName = 'IN_APP';

export const IN_APP: NotificationChannelName = 'IN_APP';

/**
 * The four event types S6-NOTIFY-INAPP notifies on, and who each one reaches.
 *
 * **This map is the whole of the locked mapping, and it is deliberately
 * closed.** Ten event types exist in `outbox_events`; six of them —
 * `order.payment_initiated` and the five `sub_order.*` transitions — have no
 * row in SDD 11.2's channel matrix, so notifying on them would be inventing a
 * requirement. They keep flowing through the relay and are simply not consumed
 * here; a later milestone that gains a requirement adds them.
 *
 * The four that are here each trace to a named row of SDD 11.2:
 *
 *   order.confirmed      → "Order confirmed (customer)"
 *   order.placed         → "New order (vendor)" — Critical in the matrix
 *   order.payment_failed → "Payment failed"
 *   order.cancelled      → "Order cancelled / refunded"
 *
 * `order.cancelled` reaches the customer only. The matrix's row does not say
 * who receives it, and extending it to vendors would be a decision no document
 * supports.
 */
export const NOTIFIED_EVENT_TYPES = {
  'order.confirmed': 'CUSTOMER',
  'order.placed': 'VENDOR',
  'order.payment_failed': 'CUSTOMER',
  'order.cancelled': 'CUSTOMER',
} as const satisfies Record<string, NotificationRecipientKind>;

export type NotifiedEventType = keyof typeof NOTIFIED_EVENT_TYPES;

/** Whether this event produces notifications at all. Everything outside the map is silently ignored, by design. */
export const isNotifiedEventType = (eventType: string): eventType is NotifiedEventType =>
  Object.prototype.hasOwnProperty.call(NOTIFIED_EVENT_TYPES, eventType);

/** Which inbox an event's notifications belong in. */
export const recipientKindFor = (eventType: NotifiedEventType): NotificationRecipientKind =>
  NOTIFIED_EVENT_TYPES[eventType];

/** The fixed wording for one event, rendered from data the event already carries. */
export interface NotificationContent {
  readonly title: string;
  readonly body: string;
}

/** The last 8 characters of a uuid — enough for a person to match a notification to an order without printing the whole key. */
const shortRef = (id: string): string => id.slice(-8).toUpperCase();

/**
 * Fixed application strings (locked decision: no template system in v1, FR-59
 * deferred).
 *
 * The rules these follow, because "minimal factual wording" is easy to drift
 * from once there are more of them:
 *
 *  - Say what happened and which order it happened to. Nothing else.
 *  - Never include a payment provider reference, an amount, an address or any
 *    other payload field beyond the order's own short reference — a
 *    notification list is a surface a shoulder-surfer reads, and none of that
 *    is needed to know what happened.
 *  - No instructions, no calls to action, no apology. The order page is where
 *    a customer acts; this only tells them to go there.
 *
 * The full payload is stored alongside, so a later templated version can say
 * more without a backfill.
 */
export const contentFor = (
  eventType: NotifiedEventType,
  reference: { readonly orderId: string },
): NotificationContent => {
  const ref = shortRef(reference.orderId);
  switch (eventType) {
    case 'order.confirmed':
      return { title: 'Order confirmed', body: `Your order ${ref} has been confirmed.` };
    case 'order.placed':
      return { title: 'New order', body: `You have received a new order ${ref}.` };
    case 'order.payment_failed':
      return { title: 'Payment failed', body: `Payment for your order ${ref} did not go through.` };
    case 'order.cancelled':
      return { title: 'Order cancelled', body: `Your order ${ref} has been cancelled.` };
  }
};
