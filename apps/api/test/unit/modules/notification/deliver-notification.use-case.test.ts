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

const resolver = (vendorUserIds: readonly string[] = []): NotificationRecipientResolver => ({
  vendorUserIdsForOrder: vi.fn().mockResolvedValue(vendorUserIds),
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
