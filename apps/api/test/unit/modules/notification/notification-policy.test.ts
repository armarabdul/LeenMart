import { describe, expect, it } from 'vitest';
import {
  NOTIFIED_EVENT_TYPES,
  contentFor,
  isNotifiedEventType,
  recipientKindFor,
} from '../../../../src/modules/notification/domain/services/notification-policy.js';

/** Every event type the platform emits today, per `ORDER_AUDIT_ACTIONS`. */
const ALL_EVENT_TYPES = [
  'order.placed',
  'order.confirmed',
  'order.cancelled',
  'order.payment_failed',
  'order.payment_initiated',
  'sub_order.processing_started',
  'sub_order.shipped',
  'sub_order.delivered',
  'sub_order.ready_for_pickup',
  'sub_order.pickup_completed',
  'sub_order.pickup_reminder',
] as const;

/** The six that S6 deliberately does not notify on — none has a row in SDD 11.2. */
const NOT_NOTIFIED = [
  'order.payment_initiated',
  'sub_order.processing_started',
  'sub_order.shipped',
  'sub_order.delivered',
  'sub_order.ready_for_pickup',
  'sub_order.pickup_completed',
] as const;

const ORDER_ID = '01a01234-5678-7abc-9def-0123456789ab';

describe('notification event mapping (S6-NOTIFY-INAPP)', () => {
  it('notifies on exactly ten event types — S6-NOTIFY-INAPP’s four, S6-NOTIFY-LIFECYCLE’s four, S7-SCHED’s one, and S9-NOTIFY-REVIEW’s one', () => {
    // The map is closed on purpose: an event type without a requirement
    // behind it should not silently start notifying.
    expect(Object.keys(NOTIFIED_EVENT_TYPES).sort()).toEqual([
      'kyc.approved',
      'kyc.rejected',
      'order.cancelled',
      'order.confirmed',
      'order.payment_failed',
      'order.placed',
      'product.approved',
      'product.rejected',
      'review.received',
      'sub_order.pickup_reminder',
    ]);
  });

  it('accepts review.received and files it in the VENDOR inbox (S9-NOTIFY-REVIEW)', () => {
    expect(isNotifiedEventType('review.received')).toBe(true);
    expect(recipientKindFor('review.received')).toBe('VENDOR');
  });

  it('still rejects review.approved and review.hidden — audit action names, not the published event name', () => {
    // Same distinction `REVIEW_AUDIT_ACTIONS` draws from
    // `REVIEW_OUTBOX_EVENTS`: a moderator's decision is recorded under one
    // vocabulary, and only `review.received` — the customer's own submission
    // — is ever published to the outbox.
    expect(isNotifiedEventType('review.approved')).toBe(false);
    expect(isNotifiedEventType('review.hidden')).toBe(false);
  });

  it.each(['product.approved', 'product.rejected', 'kyc.approved', 'kyc.rejected'] as const)(
    'accepts %s and files it in the VENDOR inbox',
    (eventType) => {
      // SDD 11.2's "Product approved/rejected" and "KYC status" rows both
      // describe an outcome the seller is told about.
      expect(isNotifiedEventType(eventType)).toBe(true);
      expect(recipientKindFor(eventType)).toBe('VENDOR');
    },
  );

  it.each([
    'product.submitted_for_review',
    'kyc.submitted',
    'kyc.review.started',
    'vendor.activated',
    'catalogue.product.approved',
    'vendor.kyc.approved',
  ])('still rejects %s — outside the locked set', (eventType) => {
    // The last two matter: the *audit action* names differ from the
    // published event names on purpose, and only the published names notify.
    expect(isNotifiedEventType(eventType)).toBe(false);
  });

  it('sends order.confirmed to the customer', () => {
    expect(recipientKindFor('order.confirmed')).toBe('CUSTOMER');
  });

  it('sends order.placed to the vendor — SDD 11.2 "New order (vendor)"', () => {
    expect(recipientKindFor('order.placed')).toBe('VENDOR');
  });

  it('sends order.payment_failed to the customer', () => {
    expect(recipientKindFor('order.payment_failed')).toBe('CUSTOMER');
  });

  it('sends order.cancelled to the customer, and not to vendors', () => {
    // SDD 11.2's row does not name a vendor recipient, and extending it would
    // be a decision no document supports.
    expect(recipientKindFor('order.cancelled')).toBe('CUSTOMER');
  });

  it('sends sub_order.pickup_reminder to the customer — SDD 11.2 "Pickup reminder (T-2h)" (S7-SCHED)', () => {
    expect(isNotifiedEventType('sub_order.pickup_reminder')).toBe(true);
    expect(recipientKindFor('sub_order.pickup_reminder')).toBe('CUSTOMER');
  });

  it('never sends a pickup reminder to a vendor — a distinct event from sub_order.ready_for_pickup/pickup_completed, which stay unnotified', () => {
    // Guards against the two existing sub-order events this one could be
    // confused with getting silently swept into the notified set alongside it.
    expect(isNotifiedEventType('sub_order.ready_for_pickup')).toBe(false);
    expect(isNotifiedEventType('sub_order.pickup_completed')).toBe(false);
  });

  it.each(NOT_NOTIFIED)('does not notify on %s', (eventType) => {
    expect(isNotifiedEventType(eventType)).toBe(false);
  });

  it('recognises every notified type and rejects everything else', () => {
    const notified = ALL_EVENT_TYPES.filter(isNotifiedEventType);

    expect(notified).toHaveLength(5);
    expect(isNotifiedEventType('something.invented')).toBe(false);
    expect(isNotifiedEventType('')).toBe(false);
  });
});

describe('notification content (S6-NOTIFY-INAPP)', () => {
  it('names the event and the order, and nothing else', () => {
    const content = contentFor('order.confirmed', { subjectId: ORDER_ID });

    expect(content.title).toBe('Order confirmed');
    expect(content.body).toContain('confirmed');
    expect(content.body).toContain('0123456789AB'.slice(-8));
  });

  it('gives every notified type its own wording', () => {
    const titles = (
      [
        'order.confirmed',
        'order.placed',
        'order.payment_failed',
        'order.cancelled',
        'sub_order.pickup_reminder',
      ] as const
    ).map((eventType) => contentFor(eventType, { subjectId: ORDER_ID }).title);

    expect(new Set(titles).size).toBe(5);
  });

  it('the pickup reminder says only that the pickup is approaching, naming the order and nothing else (S7-SCHED locked wording)', () => {
    const content = contentFor('sub_order.pickup_reminder', { subjectId: ORDER_ID });

    expect(content.title).toBe('Pickup reminder');
    expect(content.body).toBe(
      `Your order ${ORDER_ID.slice(-8).toUpperCase()} is ready for pickup soon.`,
    );
    // No address, no amount, no slot time, no instruction.
    expect(content.body).not.toMatch(/₹|pincode|address|\d{1,2}:\d{2}|click|please|bring/i);
  });

  it('shortens the order reference rather than printing the whole key', () => {
    const { body } = contentFor('order.placed', { subjectId: ORDER_ID });

    expect(body).not.toContain(ORDER_ID);
    expect(body).toContain(ORDER_ID.slice(-8).toUpperCase());
  });

  it('never leaks a payment provider reference or an amount', () => {
    // A notification list is a surface a shoulder-surfer reads; none of that is
    // needed to know what happened.
    for (const eventType of ['order.confirmed', 'order.payment_failed'] as const) {
      const { title, body } = contentFor(eventType, { subjectId: ORDER_ID });
      const text = `${title} ${body}`;
      // Razorpay-style references and any currency figure. The order's own
      // short reference is the one identifier that belongs here, so it is
      // removed before checking that no other number survives.
      expect(text).not.toMatch(/pay_|order_|₹/);
      expect(text.replace(ORDER_ID.slice(-8).toUpperCase(), '')).not.toMatch(/\d/);
    }
  });

  it('says nothing a customer could mistake for an instruction', () => {
    const { body } = contentFor('order.payment_failed', { subjectId: ORDER_ID });

    expect(body).not.toMatch(/click|tap|please|sorry/i);
  });
});
