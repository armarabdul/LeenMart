import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import {
  signUpCustomer,
  signUpVendorOwner,
  type Actor,
  type VendorActor,
} from '../support/actors.js';
import { DeliverNotificationUseCase } from '../../src/modules/notification/application/use-cases/deliver-notification.use-case.js';
import { PrismaNotificationWriteRepository } from '../../src/modules/notification/infrastructure/persistence/prisma-notification.repository.js';
import { PrismaNotificationRecipientResolver } from '../../src/modules/notification/infrastructure/persistence/prisma-notification-recipient-resolver.js';

const EMAIL_PREFIX = 'notify-lifecycle-';
const NOW = new Date('2026-08-20T10:00:00.000Z');

/**
 * Product-moderation and KYC notifications (S6-NOTIFY-LIFECYCLE, SDD 11.2's
 * "Product approved/rejected" and "KYC status" rows).
 *
 * The orchestrator and the recipient resolver are the **real** ones on the
 * **real** credentials, because the properties under test are facts about who
 * a row actually reaches: a vendor's decision must land in that vendor's inbox
 * and nobody else's, and it must land in the VENDOR inbox rather than the
 * customer one even though the same person owns both.
 */
describe('lifecycle notifications (S6-NOTIFY-LIFECYCLE)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let orchestrator: DeliverNotificationUseCase;

  let vendorA: VendorActor;
  let vendorB: VendorActor;
  let customer: Actor;

  const ids = new UuidV7Generator();

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;

    orchestrator = new DeliverNotificationUseCase({
      repository: new PrismaNotificationWriteRepository(
        harness.container.checkoutPrisma,
        ids,
        new FixedClock(NOW),
      ),
      recipients: new PrismaNotificationRecipientResolver(harness.container.checkoutPrisma),
      logger: new NullLogger(),
    });

    vendorA = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor-a');
    vendorB = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor-b');
    customer = await signUpCustomer(app, EMAIL_PREFIX, 'customer');
  });

  afterAll(async () => {
    // `notifications` has a RESTRICT foreign key to `users`, so its rows go
    // before the harness removes the accounts — the same order
    // `notifications.test.ts` already follows.
    const users = await db.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    await db.notification.deleteMany({
      where: { recipientUserId: { in: users.map((user) => user.id) } },
    });
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
  });

  /** Drives the real orchestrator exactly as the worker does. */
  const deliver = (
    eventType: string,
    payload: Record<string, unknown>,
    outboxEventId = randomUUID(),
  ): ReturnType<DeliverNotificationUseCase['execute']> =>
    orchestrator.execute({ outboxEventId, eventType, payload });

  const inboxOf = async (
    userId: string,
  ): Promise<{ eventType: string; title: string; body: string; recipientKind: string }[]> =>
    (await db.notification.findMany({
      where: { recipientUserId: userId },
      select: { eventType: true, title: true, body: true, recipientKind: true },
      orderBy: { createdAt: 'asc' },
    })) as { eventType: string; title: string; body: string; recipientKind: string }[];

  describe('product moderation reaches the owning vendor', () => {
    it.each(['product.approved', 'product.rejected'] as const)(
      '%s creates one VENDOR notification for that vendor',
      async (eventType) => {
        const result = await deliver(eventType, {
          productId: randomUUID(),
          vendorId: vendorA.vendorId,
        });

        expect(result).toMatchObject({ created: 1, recipients: 1 });
        const inbox = await inboxOf(vendorA.userId);
        expect(inbox.some((row) => row.eventType === eventType)).toBe(true);
        expect(inbox.every((row) => row.recipientKind === 'VENDOR')).toBe(true);
      },
    );

    it('never reaches another vendor — Vendor B sees nothing of Vendor A’s decision', async () => {
      const before = await inboxOf(vendorB.userId);

      await deliver('product.rejected', {
        productId: randomUUID(),
        vendorId: vendorA.vendorId,
      });

      expect(await inboxOf(vendorB.userId)).toHaveLength(before.length);
    });

    it('carries no rejection reason and no reviewer note into the stored row', async () => {
      await deliver('product.rejected', {
        productId: randomUUID(),
        vendorId: vendorA.vendorId,
      });

      const rejections = (await inboxOf(vendorA.userId)).filter(
        (row) => row.eventType === 'product.rejected',
      );
      for (const row of rejections) {
        expect(`${row.title} ${row.body}`.toLowerCase()).not.toMatch(
          /reason|note|reviewer|policy_violation/,
        );
      }
    });
  });

  describe('KYC decisions reach the vendor', () => {
    it.each(['kyc.approved', 'kyc.rejected'] as const)(
      '%s creates one VENDOR notification',
      async (eventType) => {
        const result = await deliver(eventType, {
          vendorId: vendorA.vendorId,
          kycId: randomUUID(),
        });

        expect(result).toMatchObject({ created: 1, recipients: 1 });
        expect((await inboxOf(vendorA.userId)).some((row) => row.eventType === eventType)).toBe(
          true,
        );
      },
    );

    it('does not reach a different vendor', async () => {
      const before = await inboxOf(vendorB.userId);

      await deliver('kyc.approved', { vendorId: vendorA.vendorId, kycId: randomUUID() });

      expect(await inboxOf(vendorB.userId)).toHaveLength(before.length);
    });
  });

  describe('customer inboxes are untouched', () => {
    it('creates nothing for a plain customer', async () => {
      const before = await inboxOf(customer.userId);

      await deliver('product.approved', {
        productId: randomUUID(),
        vendorId: vendorA.vendorId,
      });
      await deliver('kyc.rejected', { vendorId: vendorA.vendorId, kycId: randomUUID() });

      expect(await inboxOf(customer.userId)).toHaveLength(before.length);
    });

    it('files a vendor owner’s lifecycle notification in the VENDOR inbox, never their CUSTOMER one', async () => {
      // A vendor owner is also a `users` row who can shop; the two inboxes are
      // separated by `recipient_kind`, and these events belong to only one.
      await deliver('product.approved', {
        productId: randomUUID(),
        vendorId: vendorA.vendorId,
      });

      const customerSide = (await inboxOf(vendorA.userId)).filter(
        (row) => row.recipientKind === 'CUSTOMER',
      );
      expect(customerSide).toHaveLength(0);
    });
  });

  describe('safety under at-least-once delivery', () => {
    it('writes one row when the same lifecycle event is redelivered', async () => {
      const outboxEventId = randomUUID();
      const payload = { productId: randomUUID(), vendorId: vendorA.vendorId };

      const first = await deliver('product.approved', payload, outboxEventId);
      const second = await deliver('product.approved', payload, outboxEventId);

      expect(first).toMatchObject({ created: 1 });
      expect(second).toMatchObject({ created: 0, alreadyPresent: 1 });
      expect(await db.notification.count({ where: { outboxEventId } })).toBe(1);
    });

    it('creates nothing for a vendor that does not exist — never substitutes a recipient', async () => {
      const result = await deliver('kyc.approved', {
        vendorId: randomUUID(),
        kycId: randomUUID(),
      });

      expect(result).toMatchObject({ created: 0, recipients: 0 });
    });

    it('creates nothing when the event names no vendor', async () => {
      const result = await deliver('product.approved', { productId: randomUUID() });

      expect(result).toMatchObject({ created: 0, recipients: 0 });
    });
  });
});
