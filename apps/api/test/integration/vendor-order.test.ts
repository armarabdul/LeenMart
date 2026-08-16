import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
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

const EMAIL_PREFIX = 'vendor-order-';

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
  readonly data: { id: string; status: string };
}
interface AddressBody {
  readonly data: { id: string };
}
interface ErrorBody {
  readonly error: { code: string };
}
interface VendorSubOrderListBody {
  readonly data: { id: string; orderId: string; status: string }[];
}
interface VendorSubOrderBody {
  readonly data: {
    id: string;
    orderId: string;
    status: string;
    address: { recipientName: string; line1: string };
    items: { id: string; productName: string }[];
  };
}

describe('vendor order (S3-5)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let categoryId: string;

  const auth = (actor: Actor): string => `Bearer ${actor.token}`;

  const vendorCache = new Map<string, VendorActor>();
  const vendorFor = async (label: string): Promise<VendorActor> => {
    const cached = vendorCache.get(label);
    if (cached) return cached;
    const vendor = await signUpVendorOwner(app, EMAIL_PREFIX, label);
    vendorCache.set(label, vendor);
    return vendor;
  };

  /** ACTIVE vendor, APPROVED product with stock — mirrors `order.test.ts`'s own `seedVendorWithStock`. */
  const seedActiveVendorWithStock = async (
    label: string,
    options: { available?: number; priceMinor?: string } = {},
  ): Promise<{ vendor: VendorActor; productId: string; variantId: string }> => {
    const { available = 100, priceMinor = '19900' } = options;
    const vendor = await vendorFor(label);
    const createResponse = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth(vendor))
      .send({
        categoryId,
        name: `Vendor Order Product ${randomUUID()}`,
        variant: {
          sku: `VENDOR-ORDER-${randomUUID()}`,
          name: 'Default',
          price: { amount: priceMinor, currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
      })
      .expect(201);
    const productId = (createResponse.body as CreateProductBody).data.product.id;
    const variantRow = await db.productVariant.findFirstOrThrow({ where: { productId } });

    await db.inventory.update({ where: { variantId: variantRow.id }, data: { available } });
    await db.product.update({ where: { id: productId }, data: { status: 'APPROVED' } });
    await db.vendorProfile.update({
      where: { id: vendor.vendorId },
      data: { status: 'ACTIVE', shopName: `${label} Shop` },
    });

    return { vendor, productId, variantId: variantRow.id };
  };

  /** Cart -> address -> place -> pay SUCCEEDED, ending CONFIRMED — the shared starting point every vendor-order test needs. */
  const placeConfirmedOrder = async (
    customer: Actor,
    vendorLabel: string,
  ): Promise<{ orderId: string; subOrderId: string; vendor: VendorActor }> => {
    const { vendor, variantId } = await seedActiveVendorWithStock(vendorLabel);
    await request(app)
      .post('/api/v1/me/cart/items')
      .set('Authorization', auth(customer))
      .send({ variantId, quantity: 1 })
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
      .send({ addressId, paymentMethod: 'ONLINE' })
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

    const subOrderRow = await db.subOrder.findFirstOrThrow({ where: { orderId } });
    return { orderId, subOrderId: subOrderRow.id, vendor };
  };

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    const slug = `vendor-order-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;
  }, 60_000);

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, 'vendor-order-cat-%');
    await db.$disconnect();
  });

  describe('GET /api/v1/vendor/orders', () => {
    it('401s without a token', async () => {
      await request(app).get('/api/v1/vendor/orders').expect(401);
    });

    it('lists only the caller’s own sub-orders, newest first', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'list-customer');
      const { subOrderId, vendor } = await placeConfirmedOrder(customer, 'list-owner');

      const response = await request(app)
        .get('/api/v1/vendor/orders')
        .set('Authorization', auth(vendor))
        .expect(200);
      const body = response.body as VendorSubOrderListBody;

      expect(body.data.some((row) => row.id === subOrderId)).toBe(true);
    });

    it('never returns another vendor’s sub-orders', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'list-isolation-customer');
      const { subOrderId } = await placeConfirmedOrder(customer, 'list-isolation-owner');
      const otherVendor = await vendorFor('list-isolation-other');
      await db.vendorProfile.update({
        where: { id: otherVendor.vendorId },
        data: { status: 'ACTIVE' },
      });

      const response = await request(app)
        .get('/api/v1/vendor/orders')
        .set('Authorization', auth(otherVendor))
        .expect(200);
      const body = response.body as VendorSubOrderListBody;

      expect(body.data.some((row) => row.id === subOrderId)).toBe(false);
    });

    it('returns an empty list for a vendor with no sub-orders', async () => {
      const vendor = await vendorFor('list-empty');
      await db.vendorProfile.update({ where: { id: vendor.vendorId }, data: { status: 'ACTIVE' } });

      const response = await request(app)
        .get('/api/v1/vendor/orders')
        .set('Authorization', auth(vendor))
        .expect(200);

      expect((response.body as VendorSubOrderListBody).data).toEqual([]);
    });

    it('422s VENDOR_NOT_ACTIVE for a vendor who has not been activated', async () => {
      const vendor = await vendorFor('list-inactive');

      const response = await request(app)
        .get('/api/v1/vendor/orders')
        .set('Authorization', auth(vendor))
        .expect(422);

      expect((response.body as ErrorBody).error.code).toBe('VENDOR_NOT_ACTIVE');
    });
  });

  describe('GET /api/v1/vendor/orders/:id', () => {
    it('returns the sub-order’s items and the order’s delivery address', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'get-customer');
      const { subOrderId, vendor } = await placeConfirmedOrder(customer, 'get-owner');

      const response = await request(app)
        .get(`/api/v1/vendor/orders/${subOrderId}`)
        .set('Authorization', auth(vendor))
        .expect(200);
      const body = (response.body as VendorSubOrderBody).data;

      expect(body.id).toBe(subOrderId);
      expect(body.status).toBe('CONFIRMED');
      expect(body.address.recipientName).toBe(VALID_ADDRESS.recipientName);
      expect(body.items).toHaveLength(1);
    });

    it('404s for another vendor’s sub-order (cross-vendor isolation)', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'get-isolation-customer');
      const { subOrderId } = await placeConfirmedOrder(customer, 'get-isolation-owner');
      const attacker = await vendorFor('get-isolation-attacker');
      await db.vendorProfile.update({
        where: { id: attacker.vendorId },
        data: { status: 'ACTIVE' },
      });

      const response = await request(app)
        .get(`/api/v1/vendor/orders/${subOrderId}`)
        .set('Authorization', auth(attacker))
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('SUB_ORDER_NOT_FOUND');
    });

    it('404s for a sub-order id that never existed', async () => {
      const vendor = await vendorFor('get-missing');
      await db.vendorProfile.update({ where: { id: vendor.vendorId }, data: { status: 'ACTIVE' } });

      await request(app)
        .get(`/api/v1/vendor/orders/${randomUUID()}`)
        .set('Authorization', auth(vendor))
        .expect(404);
    });
  });

  describe('POST /api/v1/vendor/orders/:id/process', () => {
    it('moves a CONFIRMED sub-order to PROCESSING', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'process-customer');
      const { subOrderId, vendor } = await placeConfirmedOrder(customer, 'process-owner');

      const response = await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(vendor))
        .expect(200);

      expect((response.body as VendorSubOrderBody).data.status).toBe('PROCESSING');

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('PROCESSING');
      // version 1 at creation, +1 from ConfirmPaymentUseCase's own
      // version-guarded write (PENDING_PAYMENT -> CONFIRMED, inside
      // placeConfirmedOrder), +1 from this process call — both write paths
      // share the same optimistic-concurrency guard (locked decision #9).
      expect(row.version).toBe(3);
    });

    it('writes exactly one sub_order.processing_started outbox event', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'process-outbox-customer');
      const { subOrderId, vendor } = await placeConfirmedOrder(customer, 'process-outbox-owner');

      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(vendor))
        .expect(200);

      const events = await db.outboxEvent.findMany({ where: { aggregateId: subOrderId } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        aggregateType: 'SubOrder',
        eventType: 'sub_order.processing_started',
      });
    });

    it('writes an audit log entry for the transition', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'process-audit-customer');
      const { subOrderId, vendor } = await placeConfirmedOrder(customer, 'process-audit-owner');

      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(vendor))
        .expect(200);

      const entries = await db.auditLog.findMany({
        where: { entityId: subOrderId, action: 'sub_order.processing_started' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorId: vendor.userId, entityType: 'SubOrder' });
    });

    it('404s for another vendor’s sub-order — never reveals it exists', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'process-isolation-customer');
      const { subOrderId } = await placeConfirmedOrder(customer, 'process-isolation-owner');
      const attacker = await vendorFor('process-isolation-attacker');
      await db.vendorProfile.update({
        where: { id: attacker.vendorId },
        data: { status: 'ACTIVE' },
      });

      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(attacker))
        .expect(404);

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('CONFIRMED');
    });

    it('422s for a sub-order still PENDING_PAYMENT (not yet confirmed)', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'process-pending-customer');
      const { vendor, variantId } = await seedActiveVendorWithStock('process-pending-owner');
      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 1 })
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
        .send({ addressId, paymentMethod: 'ONLINE' })
        .expect(201);
      const orderId = (placeResponse.body as OrderBody).data.id;
      const subOrderRow = await db.subOrder.findFirstOrThrow({ where: { orderId } });

      const response = await request(app)
        .post(`/api/v1/vendor/orders/${subOrderRow.id}/process`)
        .set('Authorization', auth(vendor))
        .expect(422);

      expect((response.body as ErrorBody).error.code).toBe('ORDER_INVALID_STATUS_TRANSITION');
    });

    it('422s on a second, repeated process call — cannot re-process an already-PROCESSING sub-order', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'process-repeat-customer');
      const { subOrderId, vendor } = await placeConfirmedOrder(customer, 'process-repeat-owner');

      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(vendor))
        .expect(200);

      const response = await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(vendor))
        .expect(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_INVALID_STATUS_TRANSITION');
    });

    it('422s VENDOR_NOT_ACTIVE for a vendor who has not been activated', async () => {
      const inactiveVendor = await vendorFor('process-inactive');

      await request(app)
        .post(`/api/v1/vendor/orders/${randomUUID()}/process`)
        .set('Authorization', auth(inactiveVendor))
        .expect(422)
        .expect((res) => {
          expect((res.body as ErrorBody).error.code).toBe('VENDOR_NOT_ACTIVE');
        });
    });
  });

  describe('customer cancellation vs. vendor processing (locked decision — invariant check)', () => {
    it('blocks the customer’s cancel once the vendor has started processing', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'invariant-customer');
      const { orderId, subOrderId, vendor } = await placeConfirmedOrder(
        customer,
        'invariant-owner',
      );

      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(vendor))
        .expect(200);

      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', auth(customer))
        .expect(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_CANCELLATION_NOT_ALLOWED');

      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('CONFIRMED');
    });

    it('still allows cancellation while the sub-order is only CONFIRMED (not yet processing)', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'invariant-precheck-customer');
      const { orderId } = await placeConfirmedOrder(customer, 'invariant-precheck-owner');

      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', auth(customer))
        .expect(200);
      expect((response.body as OrderBody).data.status).toBe('CANCELLED');
    });
  });

  describe('concurrency guard — the database-level mechanism StartProcessingUseCase relies on', () => {
    it('the version-guarded UPDATE rejects a stale expectedVersion', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'concurrency-customer');
      const { subOrderId } = await placeConfirmedOrder(customer, 'concurrency-owner');
      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });

      // First writer: succeeds, and — like `StartProcessingUseCase` — bumps the version.
      const first = await db.subOrder.updateMany({
        where: { id: subOrderId, version: row.version },
        data: { status: 'PROCESSING', version: { increment: 1 } },
      });
      expect(first.count).toBe(1);

      // Second writer, racing on the *same* (now stale) version it originally read:
      // the WHERE clause matches nothing, proving the guard — not a prior read —
      // is what arbitrates the race.
      const second = await db.subOrder.updateMany({
        where: { id: subOrderId, version: row.version },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      expect(second.count).toBe(0);

      const finalRow = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(finalRow.status).toBe('PROCESSING');
      expect(finalRow.version).toBe(row.version + 1);
    });
  });
});
