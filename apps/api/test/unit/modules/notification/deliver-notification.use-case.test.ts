import { describe, expect, it, vi } from 'vitest';
import { NullLogger } from '@leen-mart/domain-kit';
import { DeliverNotificationUseCase } from '../../../../src/modules/notification/application/use-cases/deliver-notification.use-case.js';
import type { NotificationWriteRepository } from '../../../../src/modules/notification/domain/repositories/notification.repository.js';
import type { NotificationRecipientResolver } from '../../../../src/modules/notification/application/ports/notification-recipient-resolver.port.js';

const OUTBOX_EVENT_ID = '01a01111-1111-7111-8111-111111111111';
const ORDER_ID = '01a02222-2222-7222-8222-222222222222';
const CUSTOMER_ID = '01a03333-3333-7333-8333-333333333333';
const VENDOR_USER_A = '01a04444-4444-7444-8444-444444444444';
const VENDOR_USER_B = '01a05555-5555-7555-8555-555555555555';

interface RepoSpy extends NotificationWriteRepository {
  readonly createIfAbsent: ReturnType<typeof vi.fn>;
}

/**
 * `existing` names recipients a row already exists for, so redelivery is
 * expressible; `missing` names recipients whose `users` row is gone.
 */
const repo = (existing: readonly string[] = [], missing: readonly string[] = []): RepoSpy => ({
  createIfAbsent: vi.fn().mockImplementation(({ recipientUserId }: { recipientUserId: string }) => {
    if (missing.includes(recipientUserId)) return Promise.resolve('recipient-missing');
    return Promise.resolve(existing.includes(recipientUserId) ? 'already-present' : 'created');
  }),
});

const resolver = (
  vendorUserIds: readonly string[] = [],
  ownerUserId: string | null = null,
): NotificationRecipientResolver => ({
  vendorUserIdsForOrder: vi.fn().mockResolvedValue(vendorUserIds),
  vendorOwnerUserId: vi.fn().mockResolvedValue(ownerUserId),
});

const useCase = (
  repository: NotificationWriteRepository,
  recipients: NotificationRecipientResolver = resolver(),
): DeliverNotificationUseCase =>
  new DeliverNotificationUseCase({ repository, recipients, logger: new NullLogger() });

const customerEvent = (
  eventType: string,
): Parameters<DeliverNotificationUseCase['execute']>[0] => ({
  outboxEventId: OUTBOX_EVENT_ID,
  eventType,
  payload: { orderId: ORDER_ID, customerId: CUSTOMER_ID },
});

describe('DeliverNotificationUseCase (S6-NOTIFY-INAPP)', () => {
  describe('customer mappings', () => {
    it.each(['order.confirmed', 'order.payment_failed', 'order.cancelled'])(
      'creates one customer notification for %s',
      async (eventType) => {
        const repository = repo();

        const result = await useCase(repository).execute(customerEvent(eventType));

        expect(result).toMatchObject({ created: 1, recipients: 1 });
        expect(repository.createIfAbsent).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientUserId: CUSTOMER_ID,
            recipientKind: 'CUSTOMER',
            outboxEventId: OUTBOX_EVENT_ID,
            channel: 'IN_APP',
            eventType,
          }),
        );
      },
    );

    it('never asks the resolver for vendors on a customer event', async () => {
      const recipients = resolver();

      await useCase(repo(), recipients).execute(customerEvent('order.confirmed'));

      expect(recipients.vendorUserIdsForOrder).not.toHaveBeenCalled();
    });

    it('stores the originating payload so a later template can re-render it', async () => {
      const repository = repo();

      await useCase(repository).execute(customerEvent('order.confirmed'));

      expect(repository.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { orderId: ORDER_ID, customerId: CUSTOMER_ID } }),
      );
    });
  });

  describe('vendor mapping (order.placed)', () => {
    it('notifies every vendor on the order, not just the first', async () => {
      // A multi-vendor cart produces one sub-order per vendor (ASM-03), and
      // each of those vendors receives "New order".
      const repository = repo();
      const recipients = resolver([VENDOR_USER_A, VENDOR_USER_B]);

      const result = await useCase(repository, recipients).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'order.placed',
        payload: { orderId: ORDER_ID, customerId: CUSTOMER_ID, subOrderCount: 2 },
      });

      expect(result).toMatchObject({ created: 2, recipients: 2 });
      const targets = repository.createIfAbsent.mock.calls.map(
        (call) => (call[0] as { recipientUserId: string }).recipientUserId,
      );
      expect(targets.sort()).toEqual([VENDOR_USER_A, VENDOR_USER_B].sort());
    });

    it('files the notification in the VENDOR inbox, never the customer one', async () => {
      const repository = repo();

      await useCase(repository, resolver([VENDOR_USER_A])).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'order.placed',
        payload: { orderId: ORDER_ID, customerId: CUSTOMER_ID },
      });

      expect(repository.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ recipientKind: 'VENDOR' }),
      );
      // The customer is in the payload but is not a recipient of this event.
      const targets = repository.createIfAbsent.mock.calls.map(
        (call) => (call[0] as { recipientUserId: string }).recipientUserId,
      );
      expect(targets).not.toContain(CUSTOMER_ID);
    });

    it('gives one person owning two of the order’s vendors a single notification', async () => {
      const repository = repo();

      const result = await useCase(repository, resolver([VENDOR_USER_A, VENDOR_USER_A])).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'order.placed',
        payload: { orderId: ORDER_ID },
      });

      expect(result).toMatchObject({ created: 1, recipients: 1 });
    });

    it('creates nothing when the order has no resolvable vendor', async () => {
      const repository = repo();

      const result = await useCase(repository, resolver([])).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'order.placed',
        payload: { orderId: ORDER_ID },
      });

      expect(result).toMatchObject({ created: 0, recipients: 0 });
      expect(repository.createIfAbsent).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle mappings (S6-NOTIFY-LIFECYCLE)', () => {
    const VENDOR_ID = '01a06666-6666-7666-8666-666666666666';
    const OWNER_USER = '01a07777-7777-7777-8777-777777777777';

    const lifecycleEvent = (
      eventType: string,
      payload: Record<string, unknown>,
    ): Parameters<DeliverNotificationUseCase['execute']>[0] => ({
      outboxEventId: OUTBOX_EVENT_ID,
      eventType,
      payload,
    });

    it.each(['product.approved', 'product.rejected'] as const)(
      'resolves %s to the owner of the vendor named in the payload',
      async (eventType) => {
        const repository = repo();
        const recipients = resolver([], OWNER_USER);

        const result = await useCase(repository, recipients).execute(
          lifecycleEvent(eventType, { productId: ORDER_ID, vendorId: VENDOR_ID }),
        );

        expect(recipients.vendorOwnerUserId).toHaveBeenCalledWith(VENDOR_ID);
        expect(result).toMatchObject({ created: 1, recipients: 1 });
        expect(repository.createIfAbsent).toHaveBeenCalledWith(
          expect.objectContaining({ recipientUserId: OWNER_USER, recipientKind: 'VENDOR' }),
        );
      },
    );

    it.each(['kyc.approved', 'kyc.rejected'] as const)(
      'resolves %s to the vendor owner without needing any subject reference',
      async (eventType) => {
        const repository = repo();
        const recipients = resolver([], OWNER_USER);

        const result = await useCase(repository, recipients).execute(
          lifecycleEvent(eventType, { vendorId: VENDOR_ID, kycId: ORDER_ID }),
        );

        expect(result).toMatchObject({ created: 1, recipients: 1 });
        expect(repository.createIfAbsent).toHaveBeenCalledWith(
          expect.objectContaining({ recipientKind: 'VENDOR' }),
        );
      },
    );

    it('never asks the order resolver for a lifecycle event', async () => {
      const recipients = resolver([], OWNER_USER);

      await useCase(repo(), recipients).execute(
        lifecycleEvent('product.approved', { productId: ORDER_ID, vendorId: VENDOR_ID }),
      );

      expect(recipients.vendorUserIdsForOrder).not.toHaveBeenCalled();
    });

    it('creates nothing when the vendor owner cannot be resolved — never substitutes anyone', async () => {
      // There is no second candidate who should read another vendor's
      // moderation outcome.
      const repository = repo();

      const result = await useCase(repository, resolver([], null)).execute(
        lifecycleEvent('product.rejected', { productId: ORDER_ID, vendorId: VENDOR_ID }),
      );

      expect(result).toMatchObject({ created: 0, recipients: 0 });
      expect(repository.createIfAbsent).not.toHaveBeenCalled();
    });

    it('creates nothing when a lifecycle event carries no vendorId', async () => {
      const repository = repo();
      const recipients = resolver([], OWNER_USER);

      const result = await useCase(repository, recipients).execute(
        lifecycleEvent('kyc.approved', { kycId: ORDER_ID }),
      );

      expect(result).toMatchObject({ created: 0, recipients: 0 });
      expect(recipients.vendorOwnerUserId).not.toHaveBeenCalled();
      expect(repository.createIfAbsent).not.toHaveBeenCalled();
    });

    it('creates nothing when a product event does not name its product', async () => {
      const repository = repo();

      const result = await useCase(repository, resolver([], OWNER_USER)).execute(
        lifecycleEvent('product.approved', { vendorId: VENDOR_ID }),
      );

      expect(result).toMatchObject({ created: 0 });
      expect(repository.createIfAbsent).not.toHaveBeenCalled();
    });

    it('stores no rejection reason even when the payload somehow carries one', async () => {
      // Defence in depth: the producer does not put a reason in the payload,
      // and the content function would not read one if it did.
      const repository = repo();

      await useCase(repository, resolver([], OWNER_USER)).execute(
        lifecycleEvent('product.rejected', {
          productId: ORDER_ID,
          vendorId: VENDOR_ID,
          rejectionReason: 'PROHIBITED_ITEM',
        }),
      );

      const written = repository.createIfAbsent.mock.calls[0]?.[0] as {
        title: string;
        body: string;
      };
      expect(`${written.title} ${written.body}`).not.toContain('PROHIBITED_ITEM');
    });
  });

  describe('review mapping (S9-NOTIFY-REVIEW)', () => {
    const VENDOR_ID = '01a08888-8888-7888-8888-888888888888';
    const OWNER_USER = '01a09999-9999-7999-8999-999999999999';
    const CUSTOMER_USER = '01a0aaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';

    it('resolves review.received to the owner of the vendor named in the payload', async () => {
      const repository = repo();
      const recipients = resolver([], OWNER_USER);

      const result = await useCase(repository, recipients).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'review.received',
        payload: { productId: ORDER_ID, vendorId: VENDOR_ID },
      });

      expect(recipients.vendorOwnerUserId).toHaveBeenCalledWith(VENDOR_ID);
      expect(result).toMatchObject({ created: 1, recipients: 1 });
      expect(repository.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserId: OWNER_USER, recipientKind: 'VENDOR' }),
      );
    });

    it('never resolves review.received to the order resolver — a review has no order of its own to look vendors up on', async () => {
      const recipients = resolver([], OWNER_USER);

      await useCase(repo(), recipients).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'review.received',
        payload: { productId: ORDER_ID, vendorId: VENDOR_ID },
      });

      expect(recipients.vendorUserIdsForOrder).not.toHaveBeenCalled();
    });

    it('creates nothing when review.received’s vendor owner cannot be resolved — never substitutes anyone', async () => {
      const repository = repo();

      const result = await useCase(repository, resolver([], null)).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'review.received',
        payload: { productId: ORDER_ID, vendorId: VENDOR_ID },
      });

      expect(result).toMatchObject({ created: 0, recipients: 0 });
      expect(repository.createIfAbsent).not.toHaveBeenCalled();
    });

    it('never files a review notification in the reviewing customer’s own inbox, even if a customerId happened to be in the payload', async () => {
      const repository = repo();

      await useCase(repository, resolver([], OWNER_USER)).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'review.received',
        // A customerId should never actually be written to this payload —
        // this proves resolution does not fall back to it even if it were.
        payload: { productId: ORDER_ID, vendorId: VENDOR_ID, customerId: CUSTOMER_USER },
      });

      const targets = repository.createIfAbsent.mock.calls.map(
        (call) => (call[0] as { recipientUserId: string }).recipientUserId,
      );
      expect(targets).not.toContain(CUSTOMER_USER);
      expect(targets).toEqual([OWNER_USER]);
    });
  });

  describe('the six event types S6 does not notify on', () => {
    it.each([
      'order.payment_initiated',
      'sub_order.processing_started',
      'sub_order.shipped',
      'sub_order.delivered',
      'sub_order.ready_for_pickup',
      'sub_order.pickup_completed',
    ])('ignores %s without touching the database', async (eventType) => {
      const repository = repo();
      const recipients = resolver([VENDOR_USER_A]);

      const result = await useCase(repository, recipients).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType,
        payload: { orderId: ORDER_ID, customerId: CUSTOMER_ID, vendorId: 'v' },
      });

      expect(result).toEqual({ created: 0, alreadyPresent: 0, recipientMissing: 0, recipients: 0 });
      expect(repository.createIfAbsent).not.toHaveBeenCalled();
      expect(recipients.vendorUserIdsForOrder).not.toHaveBeenCalled();
    });

    it('ignores an event type nobody has defined', async () => {
      const repository = repo();

      await useCase(repository).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'something.invented',
        payload: { orderId: ORDER_ID },
      });

      expect(repository.createIfAbsent).not.toHaveBeenCalled();
    });
  });

  describe('at-least-once safety', () => {
    it('creates nothing the second time the same event arrives', async () => {
      // The relay can redeliver and BullMQ can retry; both land here.
      const repository = repo([CUSTOMER_ID]);

      const result = await useCase(repository).execute(customerEvent('order.confirmed'));

      expect(result).toMatchObject({ created: 0, alreadyPresent: 1 });
    });

    it('treats a recipient who no longer exists as done, not as a failure', async () => {
      // Retrying cannot bring a deleted user back, so the job must not fail.
      const repository = repo([], [CUSTOMER_ID]);

      const result = await useCase(repository).execute(customerEvent('order.confirmed'));

      expect(result).toMatchObject({ created: 0, recipientMissing: 1, recipients: 1 });
    });

    it('still notifies the vendors who do exist when one of them does not', async () => {
      const repository = repo([], [VENDOR_USER_A]);

      const result = await useCase(repository, resolver([VENDOR_USER_A, VENDOR_USER_B])).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'order.placed',
        payload: { orderId: ORDER_ID },
      });

      expect(result).toMatchObject({ created: 1, recipientMissing: 1, recipients: 2 });
    });

    it('creates only the missing rows when a redelivery is partial', async () => {
      // Vendor A was written before the worker died; vendor B was not.
      const repository = repo([VENDOR_USER_A]);

      const result = await useCase(repository, resolver([VENDOR_USER_A, VENDOR_USER_B])).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'order.placed',
        payload: { orderId: ORDER_ID },
      });

      expect(result).toMatchObject({ created: 1, alreadyPresent: 1, recipients: 2 });
    });
  });

  describe('malformed events', () => {
    it('creates nothing when the event carries no orderId', async () => {
      // Every notified event is an order event. Inventing a reference would put
      // a wrong order number in front of a customer.
      const repository = repo();

      const result = await useCase(repository).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'order.confirmed',
        payload: { customerId: CUSTOMER_ID },
      });

      expect(result).toMatchObject({ created: 0 });
      expect(repository.createIfAbsent).not.toHaveBeenCalled();
    });

    it('creates nothing when a customer event carries no customerId', async () => {
      const repository = repo();

      const result = await useCase(repository).execute({
        outboxEventId: OUTBOX_EVENT_ID,
        eventType: 'order.confirmed',
        payload: { orderId: ORDER_ID },
      });

      expect(result).toMatchObject({ created: 0, recipients: 0 });
      expect(repository.createIfAbsent).not.toHaveBeenCalled();
    });
  });
});
