/** Who a notification is for. A vendor owner is also a user, so this is what separates the two inboxes. */
export type NotificationRecipientKind = 'CUSTOMER' | 'VENDOR';

/** SDD 11.2 names four channels; S6-NOTIFY-INAPP implements the one with no external dependency. */
export type NotificationChannelName = 'IN_APP';

export const IN_APP: NotificationChannelName = 'IN_APP';

/**
 * Every event type that produces a notification, and who each one reaches.
 *
 * **Deliberately closed.** An event type without a row in SDD 11.2's channel
 * matrix has no requirement behind it, and notifying on it anyway would be
 * inventing one. Everything outside this map flows through the relay
 * unconsumed.
 *
 * S6-NOTIFY-INAPP's four, each tracing to a named row of SDD 11.2:
 *
 *   order.confirmed      → "Order confirmed (customer)"
 *   order.placed         → "New order (vendor)" — Critical in the matrix
 *   order.payment_failed → "Payment failed"
 *   order.cancelled      → "Order cancelled / refunded"
 *
 * `order.cancelled` reaches the customer only. The matrix's row does not say
 * who receives it, and extending it to vendors would be a decision no document
 * supports.
 *
 * S6-NOTIFY-LIFECYCLE's four, from the two matrix rows that had an in-app
 * mark and no producer:
 *
 *   product.approved / product.rejected → "Product approved/rejected"
 *   kyc.approved     / kyc.rejected     → "KYC status"
 *
 * All four reach the vendor. Both rows describe an outcome the *seller* is
 * told about; no document gives a customer any interest in either, and a
 * customer has no moderation or verification state to be notified of.
 */
export const NOTIFIED_EVENT_TYPES = {
  'order.confirmed': 'CUSTOMER',
  'order.placed': 'VENDOR',
  'order.payment_failed': 'CUSTOMER',
  'order.cancelled': 'CUSTOMER',
  'product.approved': 'VENDOR',
  'product.rejected': 'VENDOR',
  'kyc.approved': 'VENDOR',
  'kyc.rejected': 'VENDOR',
} as const satisfies Record<string, NotificationRecipientKind>;

export type NotifiedEventType = keyof typeof NOTIFIED_EVENT_TYPES;

/** Whether this event produces notifications at all. Everything outside the map is silently ignored, by design. */
export const isNotifiedEventType = (eventType: string): eventType is NotifiedEventType =>
  Object.prototype.hasOwnProperty.call(NOTIFIED_EVENT_TYPES, eventType);

/** Which inbox an event's notifications belong in. */
export const recipientKindFor = (eventType: NotifiedEventType): NotificationRecipientKind =>
  NOTIFIED_EVENT_TYPES[eventType];

/**
 * What a notified event is *about*, which decides two things the orchestrator
 * cannot read off the event type alone: which payload field identifies the
 * subject, and how its recipients are resolved.
 */
export type NotificationSubject = 'ORDER' | 'PRODUCT' | 'VENDOR_KYC';

const EVENT_SUBJECTS = {
  'order.confirmed': 'ORDER',
  'order.placed': 'ORDER',
  'order.payment_failed': 'ORDER',
  'order.cancelled': 'ORDER',
  'product.approved': 'PRODUCT',
  'product.rejected': 'PRODUCT',
  'kyc.approved': 'VENDOR_KYC',
  'kyc.rejected': 'VENDOR_KYC',
} as const satisfies Record<NotifiedEventType, NotificationSubject>;

export const subjectOf = (eventType: NotifiedEventType): NotificationSubject =>
  EVENT_SUBJECTS[eventType];

/**
 * The payload field naming the subject, or `null` where the subject needs no
 * reference of its own.
 *
 * A vendor has exactly one verification status, so a KYC notification has
 * nothing useful to disambiguate — printing a submission id would be noise, not
 * a reference the vendor could act on.
 */
export const subjectIdFieldOf = (subject: NotificationSubject): string | null => {
  switch (subject) {
    case 'ORDER':
      return 'orderId';
    case 'PRODUCT':
      return 'productId';
    case 'VENDOR_KYC':
      return null;
  }
};

/** The fixed wording for one event, rendered from data the event already carries. */
export interface NotificationContent {
  readonly title: string;
  readonly body: string;
}

/** The last 8 characters of a uuid — enough for a person to match a notification to its subject without printing the whole key. */
const shortRef = (id: string): string => id.slice(-8).toUpperCase();

/**
 * Fixed application strings (locked decision: no template system in v1, FR-59
 * deferred).
 *
 * The rules these follow, because "minimal factual wording" is easy to drift
 * from once there are more of them:
 *
 *  - Say what happened and which thing it happened to. Nothing else.
 *  - Never include a payment provider reference, an amount, an address or any
 *    other payload field beyond the subject's own short reference — a
 *    notification list is a surface a shoulder-surfer reads, and none of that
 *    is needed to know what happened.
 *  - No instructions, no calls to action, no apology. The order or product
 *    page is where someone acts; this only tells them it is there.
 *  - **Never a moderation detail.** A rejection says only that the decision
 *    went that way. The coded reason and the reviewer's free-text note stay in
 *    the moderation surface the vendor already has — the same restraint
 *    `DecideProductUseCase` and `DecideVendorKycUseCase` already apply when
 *    they keep the reviewer's prose out of the audit row and the log line.
 *
 * The full payload is stored alongside, so a later templated version can say
 * more without a backfill.
 */
export const contentFor = (
  eventType: NotifiedEventType,
  reference: { readonly subjectId: string | null },
): NotificationContent => {
  const ref = reference.subjectId === null ? '' : shortRef(reference.subjectId);
  switch (eventType) {
    case 'order.confirmed':
      return { title: 'Order confirmed', body: `Your order ${ref} has been confirmed.` };
    case 'order.placed':
      return { title: 'New order', body: `You have received a new order ${ref}.` };
    case 'order.payment_failed':
      return { title: 'Payment failed', body: `Payment for your order ${ref} did not go through.` };
    case 'order.cancelled':
      return { title: 'Order cancelled', body: `Your order ${ref} has been cancelled.` };
    case 'product.approved':
      return { title: 'Product approved', body: `Your product ${ref} has been approved.` };
    case 'product.rejected':
      // No reason, no reviewer note — see this function's own rules above.
      return { title: 'Product rejected', body: `Your product ${ref} was not approved.` };
    case 'kyc.approved':
      return { title: 'Verification approved', body: 'Your shop verification has been approved.' };
    case 'kyc.rejected':
      return {
        title: 'Verification rejected',
        body: 'Your shop verification was not approved.',
      };
  }
};
