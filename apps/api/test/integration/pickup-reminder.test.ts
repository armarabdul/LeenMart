import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { FixedClock, NullLogger } from '@leen-mart/domain-kit';
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
import { createOrderSchedulerWorkerModule } from '../../src/modules/order/index.js';
import { PICKUP_REMINDER_LEAD_MS } from '../../src/modules/order/domain/services/pickup-reminder-policy.js';
import { toIst } from '../../src/modules/vendor/domain/value-objects/ist-instant.value-object.js';
import { PostgresAdvisoryLock } from '../../src/shared/infrastructure/persistence/postgres-advisory-lock.js';
import { DeliverNotificationUseCase } from '../../src/modules/notification/application/use-cases/deliver-notification.use-case.js';
import { PrismaNotificationWriteRepository } from '../../src/modules/notification/infrastructure/persistence/prisma-notification.repository.js';
import { PrismaNotificationRecipientResolver } from '../../src/modules/notification/infrastructure/persistence/prisma-notification-recipient-resolver.js';

const EMAIL_PREFIX = 'pickup-reminder-';

const VALID_ADDRESS = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  label: 'Home',
};

interface CreateProductBody {
  readonly data: { product: { id: string } };
}
interface OrderBody {
  readonly data: { id: string };
}
interface AddressBody {
  readonly data: { id: string };
}

/**
 * The pickup T-2h reminder sweep against real PostgreSQL (S7-SCHED).
 *
 * **What this file proves, and what it deliberately leaves to the browser
 * walkthrough.** `outbox-relay.test.ts` already proves the relay's own
 * claim/dispatch/backoff mechanics in isolation, against synthetic rows dated
 * into the past specifically so a real tick never touches the live backlog
 * (see that file's own comment on why). Re-running the full, un-scoped relay
 * here would claim from that same live table and risk exactly the
 * interference that file goes out of its way to avoid. So instead of driving
 * `OutboxRelay.tick()`, `deliverFor()` below takes the exact outbox row the
 * sweep just wrote and feeds it to the real `DeliverNotificationUseCase` —
 * the same call `OutboxRelay.tick()` → the notification outbox handler →
 * BullMQ → `processNotificationJob` would make in production, exercising the
 * real recipient-resolution and idempotency logic against real rows, without
 * touching the shared backlog. The BullMQ hop itself is proven separately
 * end-to-end by the mandatory browser walkthrough.
 */
describe('Pickup reminder sweep (S7-SCHED)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let categoryId: string;
  let orchestrator: DeliverNotificationUseCase;

  const auth = (actor: Actor): string => `Bearer ${actor.token}`;
  const trackedSubOrderIds: string[] = [];
  const trackedUserIds: string[] = [];

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    const slug = `pickup-reminder-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;

    orchestrator = new DeliverNotificationUseCase({
      repository: new PrismaNotificationWriteRepository(
        harness.container.checkoutPrisma,
        harness.container.idGenerator,
        harness.container.clock,
      ),
      recipients: new PrismaNotificationRecipientResolver(harness.container.checkoutPrisma),
      logger: new NullLogger(),
    });
  }, 60_000);

  afterAll(async () => {
    await db.notification.deleteMany({ where: { recipientUserId: { in: trackedUserIds } } });
    await db.outboxEvent.deleteMany({
      where: { aggregateType: 'SubOrder', aggregateId: { in: trackedSubOrderIds } },
    });
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(
      `DELETE FROM categories WHERE slug LIKE $1`,
      'pickup-reminder-cat-%',
    );
    await db.$disconnect();
  });

  /** ACTIVE, pickup-capable vendor with an APPROVED, in-stock product. */
  const seedVendor = async (label: string): Promise<{ vendor: VendorActor; variantId: string }> => {
    const vendor = await signUpVendorOwner(app, EMAIL_PREFIX, label);
    trackedUserIds.push(vendor.userId);
    const createResponse = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth(vendor))
      .send({
        categoryId,
        name: `Pickup Reminder Product ${randomUUID()}`,
        variant: {
          sku: `PICKUP-REM-${randomUUID()}`,
          name: 'Default',
          price: { amount: '19900', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
      })
      .expect(201);
    const productId = (createResponse.body as CreateProductBody).data.product.id;
    const variantRow = await db.productVariant.findFirstOrThrow({ where: { productId } });

    await db.inventory.update({ where: { variantId: variantRow.id }, data: { available: 100 } });
    await db.product.update({ where: { id: productId }, data: { status: 'APPROVED' } });
    await db.vendorProfile.update({
      where: { id: vendor.vendorId },
      data: { status: 'ACTIVE', shopName: `${label} Shop`, supportsPickup: true },
    });

    return { vendor, variantId: variantRow.id };
  };

  /** Cart -> address -> place (pickup) -> pay, ending CONFIRMED. */
  const placeConfirmedOrder = async (
    customer: Actor,
    seeded: { vendor: VendorActor; variantId: string },
    options: { pickup: boolean },
  ): Promise<{ orderId: string; subOrderId: string }> => {
    await request(app)
      .post('/api/v1/me/cart/items')
      .set('Authorization', auth(customer))
      .send({ variantId: seeded.variantId, quantity: 1 })
      .expect(201);
    const addressResponse = await request(app)
      .post('/api/v1/me/addresses')
      .set('Authorization', auth(customer))
      .send(VALID_ADDRESS)
      .expect(201);
    const addressId = (addressResponse.body as AddressBody).data.id;

    const placeResponse = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        addressId,
        paymentMethod: 'ONLINE',
        ...(options.pickup ? { pickupVendorIds: [seeded.vendor.vendorId] } : {}),
      })
      .expect(201);
    const orderId = (placeResponse.body as OrderBody).data.id;

    await request(app)
      .post(`/api/v1/orders/${orderId}/payment/initiate`)
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${orderId}/payment/confirm`)
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send({ testScenario: 'SUCCEEDED' })
      .expect(200);

    const subOrderRow = await db.subOrder.findFirstOrThrow({
      where: { orderId, vendorId: seeded.vendor.vendorId },
    });
    trackedSubOrderIds.push(subOrderRow.id);
    return { orderId, subOrderId: subOrderRow.id };
  };

  /** Sets `slot_date`/`slot_start_minute` so the sub-order's pickup instant is exactly `offsetFromNow` away from `now`. */
  const setSlot = async (subOrderId: string, now: Date, offsetFromNow: number): Promise<void> => {
    const ist = toIst(new Date(now.getTime() + offsetFromNow));
    await db.subOrder.update({
      where: { id: subOrderId },
      data: {
        slotDate: new Date(`${ist.date}T00:00:00.000Z`),
        slotStartMinute: ist.minuteOfDay,
        slotEndMinute: ist.minuteOfDay + 30,
      },
    });
  };

  /** A PICKUP sub-order, seeded, confirmed, and moved to READY_FOR_PICKUP — no slot yet. */
  const readyForPickupSubOrder = async (
    label: string,
  ): Promise<{ orderId: string; subOrderId: string; vendor: VendorActor; customer: Actor }> => {
    const customer = await signUpCustomer(app, EMAIL_PREFIX, `${label}-buyer`);
    trackedUserIds.push(customer.userId);
    const seeded = await seedVendor(label);
    const { orderId, subOrderId } = await placeConfirmedOrder(customer, seeded, { pickup: true });
    await request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/process`)
      .set('Authorization', auth(seeded.vendor))
      .expect(200);
    await request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/ready-for-pickup`)
      .set('Authorization', auth(seeded.vendor))
      .expect(200);
    return { orderId, subOrderId, vendor: seeded.vendor, customer };
  };

  const buildJob = (
    now: Date,
  ): ReturnType<typeof createOrderSchedulerWorkerModule>['pickupReminderJob'] =>
    createOrderSchedulerWorkerModule({
      checkoutPrisma: harness.container.checkoutPrisma,
      prisma: harness.container.prisma,
      idGenerator: harness.container.idGenerator,
      clock: new FixedClock(now),
      logger: new NullLogger(),
    }).pickupReminderJob;

  const outboxRowFor = (
    subOrderId: string,
  ): Promise<{ id: string; eventType: string; payload: unknown } | null> =>
    db.outboxEvent.findFirst({
      where: {
        aggregateType: 'SubOrder',
        aggregateId: subOrderId,
        eventType: 'sub_order.pickup_reminder',
      },
      select: { id: true, eventType: true, payload: true },
    });

  const inboxOf = (
    userId: string,
  ): Promise<{ eventType: string; title: string; body: string; recipientKind: string }[]> =>
    db.notification.findMany({
      where: { recipientUserId: userId },
      select: { eventType: true, title: true, body: true, recipientKind: true },
    }) as Promise<{ eventType: string; title: string; body: string; recipientKind: string }[]>;

  /** Feeds one already-fetched outbox row to the real orchestrator — see the file's own top comment for why this stands in for the relay's BullMQ hop. */
  const deliverRow = (
    row: { id: string; eventType: string; payload: unknown } | null,
  ): ReturnType<DeliverNotificationUseCase['execute']> =>
    orchestrator.execute({
      outboxEventId: row === null ? '' : row.id,
      eventType: row === null ? '' : row.eventType,
      payload: (row === null ? {} : row.payload) as Record<string, unknown>,
    });

  describe('a due pickup produces one reminder that reaches the right customer', () => {
    it('creates exactly one outbox event, the relay delivers exactly one CUSTOMER notification, and re-running is idempotent', async () => {
      const now = new Date('2026-08-20T09:00:00.000Z');
      const { subOrderId, orderId, vendor, customer } = await readyForPickupSubOrder('due');
      await setSlot(subOrderId, now, PICKUP_REMINDER_LEAD_MS);

      await buildJob(now).run();

      const row = await outboxRowFor(subOrderId);
      expect(row).not.toBeNull();
      expect(row?.payload).toMatchObject({
        subOrderId,
        orderId,
        vendorId: vendor.vendorId,
        customerId: customer.userId,
      });

      const result = await deliverRow(row);
      expect(result).toMatchObject({ created: 1, recipients: 1 });

      const inbox = await inboxOf(customer.userId);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({
        eventType: 'sub_order.pickup_reminder',
        recipientKind: 'CUSTOMER',
      });
      expect(inbox[0]?.body).not.toMatch(/₹|pincode|address|\d{1,2}:\d{2}/i);

      // Re-running the tick must not write a second outbox event.
      await buildJob(now).run();
      const rowsAfterSecondTick = await db.outboxEvent.count({
        where: {
          aggregateType: 'SubOrder',
          aggregateId: subOrderId,
          eventType: 'sub_order.pickup_reminder',
        },
      });
      expect(rowsAfterSecondTick).toBe(1);

      // Re-delivering the same outbox event must not write a second notification.
      const secondDelivery = await deliverRow(row);
      expect(secondDelivery).toMatchObject({ created: 0, alreadyPresent: 1 });
      expect(await inboxOf(customer.userId)).toHaveLength(1);
    });

    it('never notifies the vendor for this event type', async () => {
      const now = new Date('2026-08-20T09:00:00.000Z');
      const { subOrderId, vendor } = await readyForPickupSubOrder('vendor-check');
      await setSlot(subOrderId, now, PICKUP_REMINDER_LEAD_MS);

      await buildJob(now).run();
      const row = await outboxRowFor(subOrderId);
      await deliverRow(row);

      expect(await inboxOf(vendor.userId)).toHaveLength(0);
    });
  });

  describe('real concurrency', () => {
    it('two concurrent scheduler ticks under the real advisory lock produce exactly one outbox event', async () => {
      const now = new Date('2026-08-20T09:00:00.000Z');
      const { subOrderId } = await readyForPickupSubOrder('concurrent');
      await setSlot(subOrderId, now, PICKUP_REMINDER_LEAD_MS);

      const lockA = new PostgresAdvisoryLock(harness.container.prisma);
      const lockB = new PostgresAdvisoryLock(harness.container.prisma);
      const jobA = buildJob(now);
      const jobB = buildJob(now);

      const [resultA, resultB] = await Promise.all([
        lockA.runExclusive('pickup-reminder', () => jobA.run()),
        lockB.runExclusive('pickup-reminder', () => jobB.run()),
      ]);

      // One of the two lost the lock race outright (`null`); Postgres itself
      // decided which, under real transaction-scoped contention.
      const outcomes = [resultA, resultB];
      expect(outcomes.filter((outcome) => outcome === null)).toHaveLength(1);

      const count = await db.outboxEvent.count({
        where: {
          aggregateType: 'SubOrder',
          aggregateId: subOrderId,
          eventType: 'sub_order.pickup_reminder',
        },
      });
      expect(count).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it('Vendor A’s reminder reaches only Vendor A’s customer, never Vendor B’s customer', async () => {
      const now = new Date('2026-08-20T09:00:00.000Z');
      const a = await readyForPickupSubOrder('tenant-a');
      const b = await readyForPickupSubOrder('tenant-b');
      await setSlot(a.subOrderId, now, PICKUP_REMINDER_LEAD_MS);
      await setSlot(b.subOrderId, now, PICKUP_REMINDER_LEAD_MS);

      await buildJob(now).run();

      const rowA = await outboxRowFor(a.subOrderId);
      const rowB = await outboxRowFor(b.subOrderId);
      await deliverRow(rowA);
      await deliverRow(rowB);

      const aInbox = await inboxOf(a.customer.userId);
      const bInbox = await inboxOf(b.customer.userId);
      expect(aInbox).toHaveLength(1);
      expect(bInbox).toHaveLength(1);
      // Neither customer's row names the other order.
      expect(JSON.stringify(aInbox)).not.toContain(b.orderId.slice(-8).toUpperCase());
      expect(JSON.stringify(bInbox)).not.toContain(a.orderId.slice(-8).toUpperCase());
    });
  });

  describe('scope exclusions', () => {
    it('leaves a DELIVERY-mode order untouched, even with a due-looking slot', async () => {
      const now = new Date('2026-08-20T09:00:00.000Z');
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'delivery-buyer');
      trackedUserIds.push(customer.userId);
      const seeded = await seedVendor('delivery');
      const { subOrderId } = await placeConfirmedOrder(customer, seeded, { pickup: false });
      await setSlot(subOrderId, now, PICKUP_REMINDER_LEAD_MS);

      await buildJob(now).run();

      expect(await outboxRowFor(subOrderId)).toBeNull();
    });

    it('leaves a PICKUP order that has not reached READY_FOR_PICKUP untouched', async () => {
      const now = new Date('2026-08-20T09:00:00.000Z');
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'notready-buyer');
      trackedUserIds.push(customer.userId);
      const seeded = await seedVendor('notready');
      const { subOrderId } = await placeConfirmedOrder(customer, seeded, { pickup: true });
      // Moved to PROCESSING, deliberately not to READY_FOR_PICKUP.
      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(seeded.vendor))
        .expect(200);
      await setSlot(subOrderId, now, PICKUP_REMINDER_LEAD_MS);

      await buildJob(now).run();

      expect(await outboxRowFor(subOrderId)).toBeNull();
    });

    it('ignores a pickup sub-order whose slot is well outside the T-2h sweep window', async () => {
      const now = new Date('2026-08-20T09:00:00.000Z');
      const { subOrderId } = await readyForPickupSubOrder('far-future');
      await setSlot(subOrderId, now, PICKUP_REMINDER_LEAD_MS + 6 * 60 * 60 * 1000);

      await buildJob(now).run();

      expect(await outboxRowFor(subOrderId)).toBeNull();
    });
  });
});
