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

const EMAIL_PREFIX = 'delivery-slots-';

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
interface AddressBody {
  readonly data: { id: string };
}
interface ErrorBody {
  readonly error: { code: string; message: string };
}
interface SlotsBody {
  readonly data: {
    configured: boolean;
    slots: { weekday: number; startMinute: number; endMinute: number; capacity: number }[];
    bookings: { date: string; startMinute: number; booked: number }[];
  };
}
interface AvailabilityBody {
  readonly data: {
    vendors: {
      vendorId: string;
      shopName: string | null;
      slots: {
        date: string;
        startMinute: number;
        endMinute: number;
        capacity: number;
        booked: number;
        remaining: number;
      }[];
    }[];
  };
}
interface OrderBody {
  readonly data: { id: string; subOrders: { slot: unknown }[] };
}

/** Today in IST, as the policy computes it — so a slot offered "today" really is today. */
const istToday = (): { weekday: number; date: string; minuteOfDay: number } => {
  const shifted = new Date(Date.now() + (5 * 60 + 30) * 60_000);
  return {
    weekday: shifted.getUTCDay(),
    date: shifted.toISOString().slice(0, 10),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
};

/**
 * A window that is still open right now, whatever the time of day: it runs to
 * the end of the IST day. Tests that need a *bookable* slot use this, so the
 * suite passes at 23:00 as readily as at 09:00.
 */
const openNowSlot = (capacity: number): { slots: object[]; date: string; startMinute: number } => {
  const ist = istToday();
  const startMinute = 0;
  return {
    slots: [{ weekday: ist.weekday, startMinute, endMinute: 1440, capacity }],
    date: ist.date,
    startMinute,
  };
};

/**
 * Vendor slots and capacity (S4-SLOTS, SDD 4.2 step 4c, FR-27, SC-13).
 *
 * The locked decisions are what this file exists to hold in place: capacity is
 * a vendor-declared integer (S1) consumed one unit per sub-order (S2), taken
 * at placement inside the checkout transaction (S5) and returned on
 * cancellation (S8), applying to PICKUP as much as to DELIVERY (S4). Those are
 * facts about real rows under a real transaction, so they are asserted against
 * PostgreSQL rather than a mock — including the concurrency case, which is the
 * only place the atomic conditional UPDATE can actually be proved.
 */
describe('Delivery slots (S4-SLOTS)', () => {
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

  const getSlots = (actor: Actor): request.Test =>
    request(app).get('/api/v1/vendors/me/delivery-slots').set('Authorization', auth(actor));

  const putSlots = (actor: Actor, body: object): request.Test =>
    request(app)
      .put('/api/v1/vendors/me/delivery-slots')
      .set('Authorization', auth(actor))
      .send(body);

  const getAvailability = (actor: Actor): request.Test =>
    request(app).get('/api/v1/orders/slot-availability').set('Authorization', auth(actor));

  /** Creates a product for a cached vendor and returns its variant id. */
  const seedVendor = async (label: string): Promise<{ vendor: VendorActor; variantId: string }> => {
    const vendor = await vendorFor(label);
    const createResponse = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth(vendor))
      .send({
        categoryId,
        name: `Slot Product ${randomUUID()}`,
        variant: {
          sku: `SLOT-${randomUUID()}`,
          name: 'Default',
          price: { amount: '19900', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
      })
      .expect(201);
    const productId = (createResponse.body as CreateProductBody).data.product.id;
    const variantRow = await db.productVariant.findFirstOrThrow({ where: { productId } });

    await db.inventory.update({ where: { variantId: variantRow.id }, data: { available: 1000 } });
    await db.product.update({ where: { id: productId }, data: { status: 'APPROVED' } });
    await db.vendorProfile.update({
      where: { id: vendor.vendorId },
      data: { status: 'ACTIVE', shopName: `${label} Shop`, supportsPickup: true },
    });
    return { vendor, variantId: variantRow.id };
  };

  /**
   * Returns a shared vendor to a known state.
   *
   * The actor pool is deliberately small — every sign-up spends from the same
   * LOGIN_PER_IP budget that `pickup.test.ts` and `business-hours.test.ts`
   * both document — so tests share vendors and reset them rather than each
   * minting one.
   */
  const resetVendor = async (vendor: VendorActor, slots: readonly object[]): Promise<void> => {
    await db.slotCapacity.deleteMany({ where: { vendorId: vendor.vendorId } });
    await putSlots(vendor, { slots: [...slots] }).expect(200);
  };

  const addressFor = async (customer: Actor): Promise<string> => {
    const response = await request(app)
      .post('/api/v1/me/addresses')
      .set('Authorization', auth(customer))
      .send(VALID_ADDRESS)
      .expect(201);
    return (response.body as AddressBody).data.id;
  };

  const attemptOrder = async (
    customer: Actor,
    variantIds: readonly string[],
    options: {
      slotSelections?: readonly object[];
      pickupVendorIds?: readonly string[];
    } = {},
  ): Promise<request.Response> => {
    for (const variantId of variantIds) {
      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 1 })
        .expect(201);
    }
    const addressId = await addressFor(customer);

    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        addressId,
        paymentMethod: 'ONLINE',
        ...(options.pickupVendorIds && options.pickupVendorIds.length > 0
          ? { pickupVendorIds: [...options.pickupVendorIds] }
          : {}),
        ...(options.slotSelections && options.slotSelections.length > 0
          ? { slotSelections: [...options.slotSelections] }
          : {}),
      });

    // A refused placement leaves the cart intact, which would leak into the
    // next test in this file; clear it either way.
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
    const slug = `delivery-slots-${Date.now()}`;
    const category = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    // Resolved from the database rather than from `vendorCache`, so a run
    // that died mid-suite still gets cleaned up on the next one — `dispose`
    // itself matches on the email prefix, and this must match the same set.
    const vendors = await db.vendorProfile.findMany({
      where: { user: { email: { startsWith: EMAIL_PREFIX } } },
      select: { id: true },
    });
    await db.slotCapacity.deleteMany({
      where: { vendorId: { in: vendors.map((vendor) => vendor.id) } },
    });
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.category.deleteMany({ where: { slug: { startsWith: 'delivery-slots-' } } });
  });

  describe('vendor self-service', () => {
    it('reports an unconfigured vendor as offering no slots', async () => {
      const vendor = await vendorFor('alpha');
      await resetVendor(vendor, []);

      const response = await getSlots(vendor).expect(200);

      expect((response.body as SlotsBody).data).toMatchObject({ configured: false, slots: [] });
    });

    it('stores and reads back an offer, sorted', async () => {
      const vendor = await vendorFor('alpha');
      await resetVendor(vendor, []);

      await putSlots(vendor, {
        slots: [
          { weekday: 3, startMinute: 960, endMinute: 1080, capacity: 4 },
          { weekday: 1, startMinute: 420, endMinute: 540, capacity: 8 },
        ],
      }).expect(200);

      const response = await getSlots(vendor).expect(200);
      expect((response.body as SlotsBody).data.slots).toEqual([
        { weekday: 1, startMinute: 420, endMinute: 540, capacity: 8 },
        { weekday: 3, startMinute: 960, endMinute: 1080, capacity: 4 },
      ]);
    });

    it('clears the offer back to unconfigured', async () => {
      const vendor = await vendorFor('alpha');

      await putSlots(vendor, { slots: [] }).expect(200);

      const response = await getSlots(vendor).expect(200);
      expect((response.body as SlotsBody).data.configured).toBe(false);
    });

    it('rejects a window that ends before it starts', async () => {
      const vendor = await vendorFor('alpha');

      await putSlots(vendor, {
        slots: [{ weekday: 1, startMinute: 600, endMinute: 540, capacity: 2 }],
      }).expect(400);
    });

    it('rejects a capacity of zero, which the absence of a window already expresses', async () => {
      const vendor = await vendorFor('alpha');

      await putSlots(vendor, {
        slots: [{ weekday: 1, startMinute: 540, endMinute: 600, capacity: 0 }],
      }).expect(400);
    });

    it('rejects an invalid weekday', async () => {
      const vendor = await vendorFor('alpha');

      await putSlots(vendor, {
        slots: [{ weekday: 7, startMinute: 540, endMinute: 600, capacity: 2 }],
      }).expect(400);
    });

    it('rejects unknown fields rather than silently ignoring them', async () => {
      const vendor = await vendorFor('alpha');

      await putSlots(vendor, {
        slots: [{ weekday: 1, startMinute: 540, endMinute: 600, capacity: 2, vendorId: 'x' }],
      }).expect(400);
    });
  });

  describe('isolation', () => {
    it('a vendor editing its offer never touches another vendor’s', async () => {
      const first = await vendorFor('alpha');
      const second = await vendorFor('beta');

      await resetVendor(first, [{ weekday: 1, startMinute: 540, endMinute: 600, capacity: 3 }]);
      await resetVendor(second, [{ weekday: 2, startMinute: 900, endMinute: 960, capacity: 9 }]);

      const firstResponse = await getSlots(first).expect(200);
      expect((firstResponse.body as SlotsBody).data.slots).toEqual([
        { weekday: 1, startMinute: 540, endMinute: 600, capacity: 3 },
      ]);
    });

    it('a customer cannot read or write the vendor slot surface', async () => {
      const customer = await customerFor('outsider');

      await getSlots(customer).expect(403);
      await putSlots(customer, { slots: [] }).expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app).get('/api/v1/vendors/me/delivery-slots').expect(401);
      await request(app).get('/api/v1/orders/slot-availability').expect(401);
    });
  });

  describe('customer availability', () => {
    it('returns nothing for an empty cart', async () => {
      const customer = await customerFor('buyer');

      const response = await getAvailability(customer).expect(200);

      expect((response.body as AvailabilityBody).data.vendors).toEqual([]);
    });

    it('returns the cart vendor’s own windows, with remaining capacity', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(3);
      await resetVendor(seeded.vendor, offer.slots);

      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId: seeded.variantId, quantity: 1 })
        .expect(201);

      const response = await getAvailability(customer).expect(200);
      const vendors = (response.body as AvailabilityBody).data.vendors;

      expect(vendors).toHaveLength(1);
      expect(vendors[0]?.slots[0]).toMatchObject({
        date: offer.date,
        startMinute: offer.startMinute,
        capacity: 3,
        booked: 0,
        remaining: 3,
      });

      await request(app)
        .delete('/api/v1/me/cart')
        .set('Authorization', auth(customer))
        .expect((res) => [200, 204, 404].includes(res.status));
    });

    it('names no vendor in the request, so there is no id to substitute', async () => {
      const customer = await customerFor('buyer');

      // The route accepts only `days`; anything else is refused rather than
      // ignored, which is what keeps this surface un-enumerable.
      await request(app)
        .get('/api/v1/orders/slot-availability?vendorId=' + randomUUID())
        .set('Authorization', auth(customer))
        .expect(400);
    });

    it('bounds the horizon rather than accepting any number of days', async () => {
      const customer = await customerFor('buyer');

      await request(app)
        .get('/api/v1/orders/slot-availability?days=90')
        .set('Authorization', auth(customer))
        .expect(400);
    });
  });

  describe('order placement', () => {
    it('places without a slot when the vendor offers none', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      await resetVendor(seeded.vendor, []);

      const response = await attemptOrder(customer, [seeded.variantId]);

      expect(response.status).toBe(201);
      expect((response.body as OrderBody).data.subOrders[0]?.slot).toBeNull();
    });

    it('refuses a placement that names no slot for a vendor offering them', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      await resetVendor(seeded.vendor, openNowSlot(5).slots);

      const response = await attemptOrder(customer, [seeded.variantId]);

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_SLOT_REQUIRED');
    });

    it('places into the chosen window and snapshots it on the sub-order', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(5);
      await resetVendor(seeded.vendor, offer.slots);

      const response = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: [
          { vendorId: seeded.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
        ],
      });

      expect(response.status).toBe(201);
      expect((response.body as OrderBody).data.subOrders[0]?.slot).toMatchObject({
        date: offer.date,
        startMinute: offer.startMinute,
        endMinute: 1440,
      });
    });

    it('materialises the capacity row lazily, on the first booking', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(5);
      await resetVendor(seeded.vendor, offer.slots);

      const before = await db.slotCapacity.count({ where: { vendorId: seeded.vendor.vendorId } });
      await attemptOrder(customer, [seeded.variantId], {
        slotSelections: [
          { vendorId: seeded.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
        ],
      });
      const after = await db.slotCapacity.findMany({
        where: { vendorId: seeded.vendor.vendorId },
      });

      expect(before).toBe(0);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ capacity: 5, booked: 1 });
    });

    it('refuses a window the vendor does not offer', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(5);
      await resetVendor(seeded.vendor, offer.slots);

      const response = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: [{ vendorId: seeded.vendor.vendorId, date: offer.date, startMinute: 613 }],
      });

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_SLOT_INVALID');
    });

    it('refuses a date in the past', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(5);
      await resetVendor(seeded.vendor, offer.slots);

      const response = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: [
          { vendorId: seeded.vendor.vendorId, date: '2020-01-01', startMinute: offer.startMinute },
        ],
      });

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_SLOT_INVALID');
    });

    it('refuses a slot named for a vendor who offers none', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      await resetVendor(seeded.vendor, []);

      const response = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: [
          { vendorId: seeded.vendor.vendorId, date: istToday().date, startMinute: 0 },
        ],
      });

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_SLOT_INVALID');
    });

    it('refuses once the window is full, without overbooking it', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(1);
      await resetVendor(seeded.vendor, offer.slots);
      const selection = [
        { vendorId: seeded.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
      ];

      const first = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: selection,
      });
      const second = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: selection,
      });

      expect(first.status).toBe(201);
      expect(second.status).toBe(422);
      expect((second.body as ErrorBody).error.code).toBe('ORDER_SLOT_UNAVAILABLE');

      const row = await db.slotCapacity.findFirstOrThrow({
        where: { vendorId: seeded.vendor.vendorId },
      });
      expect(row.booked).toBe(1);
    });

    it('consumes capacity for a PICKUP sub-order too (S4)', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(5);
      await resetVendor(seeded.vendor, offer.slots);

      const response = await attemptOrder(customer, [seeded.variantId], {
        pickupVendorIds: [seeded.vendor.vendorId],
        slotSelections: [
          { vendorId: seeded.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
        ],
      });

      expect(response.status).toBe(201);
      const row = await db.slotCapacity.findFirstOrThrow({
        where: { vendorId: seeded.vendor.vendorId },
      });
      expect(row.booked).toBe(1);
    });

    it('requires a slot for a PICKUP vendor that offers them', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      await resetVendor(seeded.vendor, openNowSlot(5).slots);

      const response = await attemptOrder(customer, [seeded.variantId], {
        pickupVendorIds: [seeded.vendor.vendorId],
      });

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_SLOT_REQUIRED');
    });
  });

  describe('multi-vendor carts', () => {
    it('books each vendor’s own window independently', async () => {
      const customer = await customerFor('buyer');
      const first = await seedVendor('alpha');
      const second = await seedVendor('beta');
      const offer = openNowSlot(5);
      await resetVendor(first.vendor, offer.slots);
      await resetVendor(second.vendor, offer.slots);

      const response = await attemptOrder(customer, [first.variantId, second.variantId], {
        slotSelections: [
          { vendorId: first.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
          { vendorId: second.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
        ],
      });

      expect(response.status).toBe(201);
      const rows = await db.slotCapacity.findMany({
        where: { vendorId: { in: [first.vendor.vendorId, second.vendor.vendorId] } },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.booked === 1)).toBe(true);
    });

    it('refuses the ENTIRE order when one vendor’s window is full', async () => {
      const customer = await customerFor('buyer');
      const open = await seedVendor('alpha');
      const full = await seedVendor('beta');
      const offer = openNowSlot(5);
      const oneSeat = openNowSlot(1);
      await resetVendor(open.vendor, offer.slots);
      await resetVendor(full.vendor, oneSeat.slots);

      // Fill the second vendor's only seat.
      await attemptOrder(customer, [full.variantId], {
        slotSelections: [
          { vendorId: full.vendor.vendorId, date: oneSeat.date, startMinute: oneSeat.startMinute },
        ],
      });

      const response = await attemptOrder(customer, [open.variantId, full.variantId], {
        slotSelections: [
          { vendorId: open.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
          { vendorId: full.vendor.vendorId, date: oneSeat.date, startMinute: oneSeat.startMinute },
        ],
      });

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_SLOT_UNAVAILABLE');

      // All-or-nothing: the open vendor's window took nothing either.
      const openRow = await db.slotCapacity.findFirst({
        where: { vendorId: open.vendor.vendorId },
      });
      expect(openRow?.booked ?? 0).toBe(0);
    });

    it('requires a slot only from the vendors that offer them', async () => {
      const customer = await customerFor('buyer');
      const withSlots = await seedVendor('alpha');
      const without = await seedVendor('beta');
      const offer = openNowSlot(5);
      await resetVendor(withSlots.vendor, offer.slots);
      await resetVendor(without.vendor, []);

      const response = await attemptOrder(customer, [withSlots.variantId, without.variantId], {
        slotSelections: [
          {
            vendorId: withSlots.vendor.vendorId,
            date: offer.date,
            startMinute: offer.startMinute,
          },
        ],
      });

      expect(response.status).toBe(201);
      const subOrders = (response.body as OrderBody).data.subOrders;
      expect(subOrders.filter((s) => s.slot !== null)).toHaveLength(1);
    });
  });

  describe('concurrency (SC-13)', () => {
    it('never overbooks a window under simultaneous placement', async () => {
      // The only place the atomic conditional UPDATE can actually be proved:
      // ten placements race for three seats against real PostgreSQL.
      const seeded = await seedVendor('gamma');
      const offer = openNowSlot(3);
      await resetVendor(seeded.vendor, offer.slots);

      const customer = await customerFor('buyer');
      const addressId = await addressFor(customer);

      // Each attempt needs its own cart state, so the items are added first
      // and each request carries its own idempotency key.
      const attempts = Array.from({ length: 10 }, async () => {
        await request(app)
          .post('/api/v1/me/cart/items')
          .set('Authorization', auth(customer))
          .send({ variantId: seeded.variantId, quantity: 1 });
        return request(app)
          .post('/api/v1/orders')
          .set('Authorization', auth(customer))
          .set('Idempotency-Key', randomUUID())
          .send({
            addressId,
            paymentMethod: 'ONLINE',
            slotSelections: [
              {
                vendorId: seeded.vendor.vendorId,
                date: offer.date,
                startMinute: offer.startMinute,
              },
            ],
          });
      });

      const responses = await Promise.all(attempts);
      const placed = responses.filter((response) => response.status === 201);

      const row = await db.slotCapacity.findFirstOrThrow({
        where: { vendorId: seeded.vendor.vendorId },
      });
      // The database is the arbiter: however many requests won, `booked` can
      // never exceed the declared capacity, and it must equal the number of
      // orders that actually committed.
      expect(row.booked).toBeLessThanOrEqual(3);
      expect(row.booked).toBe(placed.length);

      await request(app)
        .delete('/api/v1/me/cart')
        .set('Authorization', auth(customer))
        .expect((res) => [200, 204, 404].includes(res.status));
    });

    it('refuses to let the counter exceed capacity even when written directly', async () => {
      // The CHECK constraint, asserted on its own: the guarantee must not
      // depend on the application statement being written correctly.
      const seeded = await seedVendor('gamma');
      const ist = istToday();
      await db.slotCapacity.create({
        data: {
          vendorId: seeded.vendor.vendorId,
          slotDate: new Date(`${ist.date}T00:00:00Z`),
          startMinute: 300,
          endMinute: 360,
          capacity: 1,
          booked: 1,
        },
      });

      await expect(
        db.slotCapacity.update({
          where: {
            vendorId_slotDate_startMinute: {
              vendorId: seeded.vendor.vendorId,
              slotDate: new Date(`${ist.date}T00:00:00Z`),
              startMinute: 300,
            },
          },
          data: { booked: { increment: 1 } },
        }),
      ).rejects.toThrow();
    });

    it('refuses to let the counter fall below zero', async () => {
      const seeded = await seedVendor('gamma');
      const ist = istToday();
      await db.slotCapacity.create({
        data: {
          vendorId: seeded.vendor.vendorId,
          slotDate: new Date(`${ist.date}T00:00:00Z`),
          startMinute: 400,
          endMinute: 460,
          capacity: 2,
          booked: 0,
        },
      });

      await expect(
        db.slotCapacity.update({
          where: {
            vendorId_slotDate_startMinute: {
              vendorId: seeded.vendor.vendorId,
              slotDate: new Date(`${ist.date}T00:00:00Z`),
              startMinute: 400,
            },
          },
          data: { booked: { decrement: 1 } },
        }),
      ).rejects.toThrow();
    });
  });

  describe('cancellation (locked decision S8)', () => {
    it('returns the unit to the window', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(2);
      await resetVendor(seeded.vendor, offer.slots);

      const placed = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: [
          { vendorId: seeded.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
        ],
      });
      expect(placed.status).toBe(201);
      const booked = await db.slotCapacity.findFirstOrThrow({
        where: { vendorId: seeded.vendor.vendorId },
      });
      expect(booked.booked).toBe(1);

      await request(app)
        .post(`/api/v1/orders/${(placed.body as OrderBody).data.id}/cancel`)
        .set('Authorization', auth(customer))
        .expect(200);

      const released = await db.slotCapacity.findFirstOrThrow({
        where: { vendorId: seeded.vendor.vendorId },
      });
      expect(released.booked).toBe(0);
    });

    it('frees the seat for the next customer', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(1);
      await resetVendor(seeded.vendor, offer.slots);
      const selection = [
        { vendorId: seeded.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
      ];

      const first = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: selection,
      });
      await request(app)
        .post(`/api/v1/orders/${(first.body as OrderBody).data.id}/cancel`)
        .set('Authorization', auth(customer))
        .expect(200);

      const second = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: selection,
      });

      expect(second.status).toBe(201);
    });
  });

  describe('vendor edits never disturb bookings already taken', () => {
    it('keeps the booked row’s own capacity when the template changes', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(5);
      await resetVendor(seeded.vendor, offer.slots);

      await attemptOrder(customer, [seeded.variantId], {
        slotSelections: [
          { vendorId: seeded.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
        ],
      });

      // The vendor withdraws the window entirely — editing the offer only,
      // which is what this test exists to prove leaves bookings alone.
      await putSlots(seeded.vendor, { slots: [] }).expect(200);

      const row = await db.slotCapacity.findFirstOrThrow({
        where: { vendorId: seeded.vendor.vendorId },
      });
      expect(row).toMatchObject({ capacity: 5, booked: 1 });
    });

    it('leaves an already-placed order’s snapshot intact', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('alpha');
      const offer = openNowSlot(5);
      await resetVendor(seeded.vendor, offer.slots);

      const placed = await attemptOrder(customer, [seeded.variantId], {
        slotSelections: [
          { vendorId: seeded.vendor.vendorId, date: offer.date, startMinute: offer.startMinute },
        ],
      });
      await putSlots(seeded.vendor, {
        slots: [{ weekday: istToday().weekday, startMinute: 720, endMinute: 780, capacity: 1 }],
      }).expect(200);

      const response = await request(app)
        .get(`/api/v1/orders/${(placed.body as OrderBody).data.id}`)
        .set('Authorization', auth(customer))
        .expect(200);

      expect((response.body as OrderBody).data.subOrders[0]?.slot).toMatchObject({
        startMinute: offer.startMinute,
        endMinute: 1440,
      });
    });
  });
});
