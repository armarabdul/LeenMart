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
 *
 * S7-SCHED's one, from the matrix row this milestone's scheduler platform
 * exists to produce (SDD 11.2: "Pickup reminder (T-2h) | High | ● | ● | — |
 * ●" — In-app is marked, Push/SMS are not implemented here for the same
 * reason no other event's Push/SMS column is: S6-NOTIFY-INAPP's own scope
 * decision to build only the channel with no external dependency, unchanged
 * by this milestone):
 *
 *   sub_order.pickup_reminder → "Pickup reminder (T-2h)"
 *
 * Reaches the customer only — the row names no vendor-facing wording, and a
 * vendor already knows their own sub-order is `READY_FOR_PICKUP`.
 *
 * S9-NOTIFY-REVIEW's one, from SDD 5 module #14's own review responsibility
 * (no dedicated 11.2 row exists for it, the same way S7-SCHED's own event
 * traced to a matrix row rather than this table inventing one; this one
 * traces to the module's notification requirement instead):
 *
 *   review.received → "New review (vendor)"
 *
 * Reaches the vendor whose product was reviewed — never the reviewing
 * customer, and never a different vendor than the one the purchase was
 * actually from.
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
  'sub_order.pickup_reminder': 'CUSTOMER',
  'review.received': 'VENDOR',
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
  // `ORDER`, not a new sub-order-level subject: the customer-facing surface
  // (order history, the order-confirmation page) never shows a sub-order id
  // on its own — only the parent order's — so referencing anything else here
  // would print an id the customer has never seen, which is less
  // recognisable, not more precise. Every other order-lifecycle notification
  // already references the parent order the same way.
  'sub_order.pickup_reminder': 'ORDER',
  // `PRODUCT`, not a new subject: a review is about the product it was
  // written for, and reusing this subject is what lets
  // `DeliverNotificationUseCase`'s existing `resolveVendorOwner` branch
  // (already written for `product.approved`/`.rejected`) resolve this
  // event's recipient too, with no change to that method at all — the
  // payload just has to carry `vendorId` the same way those two already do.
  'review.received': 'PRODUCT',
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
/**
 * One wording function per notified event, keyed rather than switched on —
 * a plain lookup so a tenth event type does not have to fight the
 * `complexity` lint budget the way a growing `switch` eventually would.
 */
const CONTENT_BY_EVENT_TYPE: Record<NotifiedEventType, (ref: string) => NotificationContent> = {
  'order.confirmed': (ref) => ({
    title: 'Order confirmed',
    body: `Your order ${ref} has been confirmed.`,
  }),
  'order.placed': (ref) => ({ title: 'New order', body: `You have received a new order ${ref}.` }),
  'order.payment_failed': (ref) => ({
    title: 'Payment failed',
    body: `Payment for your order ${ref} did not go through.`,
  }),
  'order.cancelled': (ref) => ({
    title: 'Order cancelled',
    body: `Your order ${ref} has been cancelled.`,
  }),
  'product.approved': (ref) => ({
    title: 'Product approved',
    body: `Your product ${ref} has been approved.`,
  }),
  // No reason, no reviewer note — see this file's own rules above.
  'product.rejected': (ref) => ({
    title: 'Product rejected',
    body: `Your product ${ref} was not approved.`,
  }),
  'kyc.approved': () => ({
    title: 'Verification approved',
    body: 'Your shop verification has been approved.',
  }),
  'kyc.rejected': () => ({
    title: 'Verification rejected',
    body: 'Your shop verification was not approved.',
  }),
  // S7-SCHED locked wording. Says only that the pickup is approaching and
  // which order it belongs to — no address (`pickupLocationSnapshot` exists
  // on the sub-order but is never read here), no amount, no slot time itself
  // (stating a precise time this function does not independently verify
  // would be a fact this notification cannot stand behind if it is ever
  // delayed in delivery), and no instruction — "bring your code"/"arrive on
  // time" are operational guidance no document specifies.
  'sub_order.pickup_reminder': (ref) => ({
    title: 'Pickup reminder',
    body: `Your order ${ref} is ready for pickup soon.`,
  }),
  // S9-NOTIFY-REVIEW locked wording. Names the product a review arrived for
  // and nothing else — no rating, no review body, no customer name or id,
  // no reviewer identity of any kind. `contentFor` is given only
  // `subjectId` (`productId`), so there is no reviewer field in scope here
  // even by mistake: the function has no parameter through which one could
  // leak.
  'review.received': (ref) => ({
    title: 'New review',
    body: `Your product ${ref} received a new review.`,
  }),
};

export const contentFor = (
  eventType: NotifiedEventType,
  reference: { readonly subjectId: string | null },
): NotificationContent => {
  const ref = reference.subjectId === null ? '' : shortRef(reference.subjectId);
  return CONTENT_BY_EVENT_TYPE[eventType](ref);
};
