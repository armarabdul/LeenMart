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

const EMAIL_PREFIX = 'business-hours-';

const VALID_ADDRESS = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  label: 'Home',
};

/** An interval covering the whole of every weekday — "open right now", whenever the suite runs. */
const ALWAYS_OPEN = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  openMinute: 0,
  closeMinute: 1440,
}));
/** Configured, but with a one-minute window at IST midnight — "closed right now" for all but a minute a day. */
const ALWAYS_CLOSED = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  openMinute: 0,
  closeMinute: 1,
}));

interface CreateProductBody {
  readonly data: { product: { id: string } };
}
interface AddressBody {
  readonly data: { id: string };
}
interface ErrorBody {
  readonly error: { code: string; message: string };
}
interface HoursBody {
  readonly data: {
    configured: boolean;
    intervals: { weekday: number; openMinute: number; closeMinute: number }[];
    closures: { weekday: number | null; date: string | null }[];
  };
}

/** Today in IST, as the policy computes it — so closure tests target the right day. */
const istToday = (): { weekday: number; date: string } => {
  const shifted = new Date(Date.now() + (5 * 60 + 30) * 60_000);
  return {
    weekday: shifted.getUTCDay(),
    date: shifted.toISOString().slice(0, 10),
  };
};

/**
 * Vendor business hours (S4-HOURS, SDD 4.2 step 4c, FR-27).
 *
 * The locked decisions are what this file holds in place: an unconfigured
 * vendor still accepts delivery (H4-A), a closed delivery vendor refuses the
 * whole order (H1-A), and PICKUP is never subject to hours at all (H2-A).
 *
 * Rather than manipulating the server's clock, the tests move the *vendor's
 * schedule* around the real current time — which exercises the same policy and
 * keeps the suite honest about what the running server actually does.
 */
describe('Vendor business hours (S4-HOURS)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let categoryId: string;

  const auth = (actor: Actor): string => `Bearer ${actor.token}`;

  // Cached actors, for the LOGIN_PER_IP reason every sibling suite documents.
  const vendorCache = new Map<string, VendorActor>();
  const vendorFor = async (label: string): Promise<VendorActor> => {
    const cached = vendorCache.get(label);
    if (cached) return cached;
    const vendor = await signUpVendorOwner(app, EMAIL_PREFIX, label);
    vendorCache.set(label, vendor);
    return vendor;
  };

  const customerCache = new Map<string, Actor>();
  const customerFor = async (label: string): Promise<Actor> => {
    const cached = customerCache.get(label);
    if (cached) return cached;
    const customer = await signUpCustomer(app, EMAIL_PREFIX, label);
    customerCache.set(label, customer);
    return customer;
  };

  const getHours = (actor: Actor): request.Test =>
    request(app).get('/api/v1/vendors/me/business-hours').set('Authorization', auth(actor));

  const putHours = (actor: Actor, body: object): request.Test =>
    request(app)
      .put('/api/v1/vendors/me/business-hours')
      .set('Authorization', auth(actor))
      .send(body);

  const seedVendor = async (label: string): Promise<{ vendor: VendorActor; variantId: string }> => {
    const vendor = await vendorFor(label);
    const createResponse = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth(vendor))
      .send({
        categoryId,
        name: `Hours Product ${randomUUID()}`,
        variant: {
          sku: `HOURS-${randomUUID()}`,
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

  const attemptOrder = async (
    customer: Actor,
    variantIds: readonly string[],
    options: { pickupVendorIds?: readonly string[] } = {},
  ): Promise<request.Response> => {
    for (const variantId of variantIds) {
      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 1 })
        .expect(201);
    }
    const addressResponse = await request(app)
      .post('/api/v1/me/addresses')
      .set('Authorization', auth(customer))
      .send(VALID_ADDRESS)
      .expect(201);

    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        addressId: (addressResponse.body as AddressBody).data.id,
        paymentMethod: 'ONLINE',
        ...(options.pickupVendorIds && options.pickupVendorIds.length > 0
          ? { pickupVendorIds: [...options.pickupVendorIds] }
          : {}),
      });

    await request(app)
      .delete('/api/v1/me/cart')
      .set('Authorization', auth(customer))
      .expect((res) => [200, 204, 404].includes(res.status));
    return response;
  };

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    const slug = `business-hours-${Date.now()}`;
    const category = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.category.deleteMany({ where: { slug: { startsWith: 'business-hours-' } } });
  });

  describe('vendor self-service', () => {
    it('reports an unconfigured vendor as such', async () => {
      const vendor = await vendorFor('virgin');

      const response = await getHours(vendor).expect(200);

      expect((response.body as HoursBody).data).toMatchObject({
        configured: false,
        intervals: [],
        closures: [],
      });
    });

    it('stores and reads back a weekly schedule with split shifts', async () => {
      const vendor = await vendorFor('seller');
      const intervals = [
        { weekday: 1, openMinute: 16 * 60, closeMinute: 20 * 60 },
        { weekday: 1, openMinute: 7 * 60, closeMinute: 11 * 60 },
      ];

      await putHours(vendor, { intervals, closures: [] }).expect(200);

      const response = await getHours(vendor).expect(200);
      const data = (response.body as HoursBody).data;
      expect(data.configured).toBe(true);
      // Sorted, so the stored schedule reads the same way twice.
      expect(data.intervals).toEqual([
        { weekday: 1, openMinute: 7 * 60, closeMinute: 11 * 60 },
        { weekday: 1, openMinute: 16 * 60, closeMinute: 20 * 60 },
      ]);
    });

    it('stores both closure kinds together (H3-C)', async () => {
      const vendor = await vendorFor('seller');

      await putHours(vendor, {
        intervals: ALWAYS_OPEN,
        closures: [
          { weekday: 0, date: null },
          { weekday: null, date: '2026-01-26' },
        ],
      }).expect(200);

      const data = (await getHours(vendor).expect(200)).body as HoursBody;
      expect(data.data.closures).toHaveLength(2);
      expect(data.data.closures).toContainEqual({ weekday: 0, date: null });
      expect(data.data.closures).toContainEqual({ weekday: null, date: '2026-01-26' });
    });

    it('clears the schedule back to unconfigured', async () => {
      const vendor = await vendorFor('other');
      await putHours(vendor, { intervals: ALWAYS_OPEN, closures: [] }).expect(200);

      const response = await putHours(vendor, { intervals: [], closures: [] }).expect(200);

      expect((response.body as HoursBody).data.configured).toBe(false);
    });

    it('is idempotent — the same configuration applied twice yields the same state', async () => {
      const vendor = await vendorFor('other');
      const body = { intervals: ALWAYS_OPEN, closures: [{ weekday: 2, date: null }] };

      const first = await putHours(vendor, body).expect(200);
      const second = await putHours(vendor, body).expect(200);

      expect((second.body as HoursBody).data).toEqual((first.body as HoursBody).data);
    });

    it('rejects a malformed time', async () => {
      const vendor = await vendorFor('seller');

      await putHours(vendor, {
        intervals: [{ weekday: 1, openMinute: -1, closeMinute: 60 }],
        closures: [],
      }).expect(400);
      await putHours(vendor, {
        intervals: [{ weekday: 1, openMinute: 0, closeMinute: 1441 }],
        closures: [],
      }).expect(400);
    });

    it('rejects an interval that closes before it opens (no overnight spans)', async () => {
      const vendor = await vendorFor('seller');

      await putHours(vendor, {
        intervals: [{ weekday: 1, openMinute: 22 * 60, closeMinute: 2 * 60 }],
        closures: [],
      }).expect(400);
    });

    it('rejects an invalid weekday', async () => {
      const vendor = await vendorFor('seller');

      await putHours(vendor, {
        intervals: [{ weekday: 7, openMinute: 0, closeMinute: 60 }],
        closures: [],
      }).expect(400);
    });

    it('rejects a malformed closure date', async () => {
      const vendor = await vendorFor('seller');

      await putHours(vendor, {
        intervals: ALWAYS_OPEN,
        closures: [{ weekday: null, date: '26-01-2026' }],
      }).expect(400);
    });

    it('rejects a closure that is neither recurring nor dated, and one that is both', async () => {
      const vendor = await vendorFor('seller');

      await putHours(vendor, {
        intervals: ALWAYS_OPEN,
        closures: [{ weekday: null, date: null }],
      }).expect(400);
      await putHours(vendor, {
        intervals: ALWAYS_OPEN,
        closures: [{ weekday: 1, date: '2026-01-26' }],
      }).expect(400);
    });

    it('rejects unknown fields rather than silently ignoring them', async () => {
      const vendor = await vendorFor('seller');

      await putHours(vendor, {
        intervals: ALWAYS_OPEN,
        closures: [],
        timezone: 'Asia/Kolkata',
      }).expect(400);
    });
  });

  describe('isolation', () => {
    it('a vendor editing its hours never touches another vendor’s', async () => {
      const vendorA = await vendorFor('seller');
      const vendorB = await vendorFor('other');
      await putHours(vendorA, { intervals: ALWAYS_OPEN, closures: [] }).expect(200);
      await putHours(vendorB, {
        intervals: [{ weekday: 4, openMinute: 60, closeMinute: 120 }],
        closures: [],
      }).expect(200);

      await putHours(vendorA, { intervals: ALWAYS_CLOSED, closures: [] }).expect(200);

      const rowsB = await db.businessHour.findMany({ where: { vendorId: vendorB.vendorId } });
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0]?.openMinute).toBe(60);
    });

    it('a customer cannot read or write the vendor hours surface', async () => {
      const customer = await customerFor('buyer');

      await getHours(customer).expect(403);
      await putHours(customer, { intervals: [], closures: [] }).expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app).get('/api/v1/vendors/me/business-hours').expect(401);
      await request(app)
        .put('/api/v1/vendors/me/business-hours')
        .send({ intervals: [], closures: [] })
        .expect(401);
    });
  });

  describe('order placement (H1-A, H4-A)', () => {
    it('allows DELIVERY from an unconfigured vendor at any time (H4-A)', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('fresh');
      await db.businessHour.deleteMany({ where: { vendorId: seeded.vendor.vendorId } });

      const response = await attemptOrder(customer, [seeded.variantId]);

      // The backward-compatibility rule: no existing vendor is taken offline.
      expect(response.status).toBe(201);
    });

    it('allows DELIVERY while the vendor is open', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putHours(seeded.vendor, { intervals: ALWAYS_OPEN, closures: [] }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId]);

      expect(response.status).toBe(201);
    });

    it('refuses DELIVERY while the vendor is closed', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putHours(seeded.vendor, { intervals: ALWAYS_CLOSED, closures: [] }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId]);

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_VENDOR_CLOSED');
    });

    it('refuses DELIVERY from a vendor who trades only on other weekdays', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      // Configured, but for every day except today. This separates "has no
      // hours" (H4-A, open) from "has hours, none of them now" (closed) at the
      // repository level: a lookup narrowed to today's weekday would read this
      // vendor as unconfigured and wrongly let the order through.
      const today = istToday().weekday;
      await putHours(seeded.vendor, {
        intervals: [0, 1, 2, 3, 4, 5, 6]
          .filter((weekday) => weekday !== today)
          .map((weekday) => ({ weekday, openMinute: 0, closeMinute: 1440 })),
        closures: [],
      }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId]);

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_VENDOR_CLOSED');
    });

    it('refuses DELIVERY on a recurring weekly holiday', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putHours(seeded.vendor, {
        intervals: ALWAYS_OPEN,
        closures: [{ weekday: istToday().weekday, date: null }],
      }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId]);

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_VENDOR_CLOSED');
    });

    it('refuses DELIVERY on a dated closure', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putHours(seeded.vendor, {
        intervals: ALWAYS_OPEN,
        closures: [{ weekday: null, date: istToday().date }],
      }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId]);

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_VENDOR_CLOSED');
    });

    it('names no vendor, weekday or opening time in the refusal', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putHours(seeded.vendor, { intervals: ALWAYS_CLOSED, closures: [] }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId]);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain(seeded.vendor.vendorId);
      expect(body).not.toContain('weekday');
      expect(body).not.toContain('openMinute');
    });

    it('refuses the ENTIRE order when one of two delivery vendors is closed (H1-A)', async () => {
      const customer = await customerFor('buyer');
      const open = await seedVendor('seller');
      const closed = await seedVendor('other');
      await putHours(open.vendor, { intervals: ALWAYS_OPEN, closures: [] }).expect(200);
      await putHours(closed.vendor, { intervals: ALWAYS_CLOSED, closures: [] }).expect(200);

      const ordersBefore = await db.order.count({ where: { customerId: customer.userId } });
      const response = await attemptOrder(customer, [open.variantId, closed.variantId]);

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_VENDOR_CLOSED');
      // No partial placement — the open vendor's half is not placed either.
      expect(await db.order.count({ where: { customerId: customer.userId } })).toBe(ordersBefore);
    });
  });

  describe('PICKUP exemption (H2-A)', () => {
    it('allows a PICKUP order from a vendor that is closed', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putHours(seeded.vendor, { intervals: ALWAYS_CLOSED, closures: [] }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId], {
        pickupVendorIds: [seeded.vendor.vendorId],
      });

      expect(response.status).toBe(201);
    });

    it('allows PICKUP even on a recurring holiday and a dated closure', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      const today = istToday();
      await putHours(seeded.vendor, {
        intervals: ALWAYS_OPEN,
        closures: [
          { weekday: today.weekday, date: null },
          { weekday: null, date: today.date },
        ],
      }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId], {
        pickupVendorIds: [seeded.vendor.vendorId],
      });

      expect(response.status).toBe(201);
    });

    it('allows a mixed cart where PICKUP is closed and the DELIVERY half is open', async () => {
      const customer = await customerFor('buyer');
      const pickupVendor = await seedVendor('seller');
      const deliveryVendor = await seedVendor('other');
      await putHours(pickupVendor.vendor, { intervals: ALWAYS_CLOSED, closures: [] }).expect(200);
      await putHours(deliveryVendor.vendor, { intervals: ALWAYS_OPEN, closures: [] }).expect(200);

      const response = await attemptOrder(
        customer,
        [pickupVendor.variantId, deliveryVendor.variantId],
        { pickupVendorIds: [pickupVendor.vendor.vendorId] },
      );

      expect(response.status).toBe(201);
    });

    it('refuses a mixed cart when the DELIVERY half is closed, despite the PICKUP exemption', async () => {
      const customer = await customerFor('buyer');
      const pickupVendor = await seedVendor('seller');
      const deliveryVendor = await seedVendor('other');
      await putHours(pickupVendor.vendor, { intervals: ALWAYS_OPEN, closures: [] }).expect(200);
      await putHours(deliveryVendor.vendor, { intervals: ALWAYS_CLOSED, closures: [] }).expect(200);

      const response = await attemptOrder(
        customer,
        [pickupVendor.variantId, deliveryVendor.variantId],
        { pickupVendorIds: [pickupVendor.vendor.vendorId] },
      );

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_VENDOR_CLOSED');
    });
  });
});
