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
  it('notifies on exactly four event types', () => {
    // The map is closed on purpose: an event type without a row in SDD 11.2
    // has no requirement behind it, and notifying anyway would be inventing
    // one.
    expect(Object.keys(NOTIFIED_EVENT_TYPES).sort()).toEqual([
      'order.cancelled',
      'order.confirmed',
      'order.payment_failed',
      'order.placed',
    ]);
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

  it.each(NOT_NOTIFIED)('does not notify on %s', (eventType) => {
    expect(isNotifiedEventType(eventType)).toBe(false);
  });

  it('recognises every notified type and rejects everything else', () => {
    const notified = ALL_EVENT_TYPES.filter(isNotifiedEventType);

    expect(notified).toHaveLength(4);
    expect(isNotifiedEventType('something.invented')).toBe(false);
    expect(isNotifiedEventType('')).toBe(false);
  });
});

describe('notification content (S6-NOTIFY-INAPP)', () => {
  it('names the event and the order, and nothing else', () => {
    const content = contentFor('order.confirmed', { orderId: ORDER_ID });

    expect(content.title).toBe('Order confirmed');
    expect(content.body).toContain('confirmed');
    expect(content.body).toContain('0123456789AB'.slice(-8));
  });

  it('gives every notified type its own wording', () => {
    const titles = (
      ['order.confirmed', 'order.placed', 'order.payment_failed', 'order.cancelled'] as const
    ).map((eventType) => contentFor(eventType, { orderId: ORDER_ID }).title);

    expect(new Set(titles).size).toBe(4);
  });

  it('shortens the order reference rather than printing the whole key', () => {
    const { body } = contentFor('order.placed', { orderId: ORDER_ID });

    expect(body).not.toContain(ORDER_ID);
    expect(body).toContain(ORDER_ID.slice(-8).toUpperCase());
  });

  it('never leaks a payment provider reference or an amount', () => {
    // A notification list is a surface a shoulder-surfer reads; none of that is
    // needed to know what happened.
    for (const eventType of ['order.confirmed', 'order.payment_failed'] as const) {
      const { title, body } = contentFor(eventType, { orderId: ORDER_ID });
      const text = `${title} ${body}`;
      // Razorpay-style references and any currency figure. The order's own
      // short reference is the one identifier that belongs here, so it is
      // removed before checking that no other number survives.
      expect(text).not.toMatch(/pay_|order_|₹/);
      expect(text.replace(ORDER_ID.slice(-8).toUpperCase(), '')).not.toMatch(/\d/);
    }
  });

  it('says nothing a customer could mistake for an instruction', () => {
    const { body } = contentFor('order.payment_failed', { orderId: ORDER_ID });

    expect(body).not.toMatch(/click|tap|please|sorry/i);
  });
});
