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

const EMAIL_PREFIX = 'serviceability-';

/** The address every order below ships to unless a test says otherwise. */
const ADDRESS_560001 = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  label: 'Home',
};
const ADDRESS_560999 = { ...ADDRESS_560001, pincode: '560999', label: 'Elsewhere' };

interface CreateProductBody {
  readonly data: { product: { id: string } };
}
interface AddressBody {
  readonly data: { id: string };
}
interface ErrorBody {
  readonly error: { code: string; message: string };
}
interface PincodesBody {
  readonly data: { configured: boolean; pincodes: string[] };
}

/**
 * Vendor-declared delivery serviceability (S4-SERV, SDD 4.2 step 4b, ASM-17).
 *
 * The locked decisions are what this file exists to hold in place: an
 * unconfigured vendor still serves everywhere (D7), one unserviceable delivery
 * vendor refuses the whole order (D4), and a PICKUP sub-order is never subject
 * to the check at all (D6). Those are facts about real rows and a real
 * transaction, so they are asserted against PostgreSQL rather than a mock.
 */
describe('Delivery serviceability (S4-SERV)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let categoryId: string;

  const auth = (actor: Actor): string => `Bearer ${actor.token}`;

  // Four cached vendors and two customers, for the reason pickup.test.ts and
  // shop-address.test.ts both document: every sign-up spends from the shared
  // LOGIN_PER_IP budget, and a vendor-per-test suite trips the limiter.
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

  const getPincodes = (actor: Actor): request.Test =>
    request(app).get('/api/v1/vendors/me/serviceable-pincodes').set('Authorization', auth(actor));

  const putPincodes = (actor: Actor, body: object): request.Test =>
    request(app)
      .put('/api/v1/vendors/me/serviceable-pincodes')
      .set('Authorization', auth(actor))
      .send(body);

  const seedVendor = async (
    label: string,
    options: { supportsPickup?: boolean } = {},
  ): Promise<{ vendor: VendorActor; variantId: string }> => {
    const { supportsPickup = true } = options;
    const vendor = await vendorFor(label);
    const createResponse = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth(vendor))
      .send({
        categoryId,
        name: `Serviceability Product ${randomUUID()}`,
        variant: {
          sku: `SERV-${randomUUID()}`,
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
      data: { status: 'ACTIVE', shopName: `${label} Shop`, supportsPickup },
    });
    return { vendor, variantId: variantRow.id };
  };

  /** Adds every variant to the cart, then attempts placement. Returns the raw response. */
  const attemptOrder = async (
    customer: Actor,
    variantIds: readonly string[],
    options: { address?: typeof ADDRESS_560001; pickupVendorIds?: readonly string[] } = {},
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
      .send(options.address ?? ADDRESS_560001)
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
    const slug = `serviceability-${Date.now()}`;
    const category = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.category.deleteMany({ where: { slug: { startsWith: 'serviceability-' } } });
  });

  describe('vendor self-service', () => {
    it('reports an unconfigured vendor as serve-everywhere', async () => {
      const vendor = await vendorFor('virgin');

      const response = await getPincodes(vendor).expect(200);

      expect((response.body as PincodesBody).data).toMatchObject({
        configured: false,
        pincodes: [],
      });
    });

    it('replaces the set and reads it back sorted', async () => {
      const vendor = await vendorFor('seller');

      await putPincodes(vendor, { pincodes: ['560002', '560001'] }).expect(200);

      const response = await getPincodes(vendor).expect(200);
      expect((response.body as PincodesBody).data).toMatchObject({
        configured: true,
        pincodes: ['560001', '560002'],
      });
    });

    it('collapses duplicates rather than rejecting them', async () => {
      const vendor = await vendorFor('seller');

      const response = await putPincodes(vendor, {
        pincodes: ['560001', '560001', '560002'],
      }).expect(200);

      expect((response.body as PincodesBody).data.pincodes).toEqual(['560001', '560002']);
    });

    it('clears the set back to serve-everywhere', async () => {
      const vendor = await vendorFor('other');
      await putPincodes(vendor, { pincodes: ['560001'] }).expect(200);

      const response = await putPincodes(vendor, { pincodes: [] }).expect(200);

      expect((response.body as PincodesBody).data).toMatchObject({
        configured: false,
        pincodes: [],
      });
    });

    it('rejects a malformed pincode', async () => {
      const vendor = await vendorFor('seller');

      await putPincodes(vendor, { pincodes: ['12'] }).expect(400);
      await putPincodes(vendor, { pincodes: ['000001'] }).expect(400);
      await putPincodes(vendor, { pincodes: ['abcdef'] }).expect(400);
    });

    it('rejects unknown fields rather than silently ignoring them', async () => {
      const vendor = await vendorFor('seller');

      await putPincodes(vendor, { pincodes: ['560001'], radiusKm: 5 }).expect(400);
    });
  });

  describe('isolation', () => {
    it('a vendor editing its set never touches another vendor’s', async () => {
      const vendorA = await vendorFor('seller');
      const vendorB = await vendorFor('other');
      await putPincodes(vendorA, { pincodes: ['560001'] }).expect(200);
      await putPincodes(vendorB, { pincodes: ['700001'] }).expect(200);

      await putPincodes(vendorA, { pincodes: ['560003'] }).expect(200);

      const rowsB = await db.serviceablePincode.findMany({ where: { vendorId: vendorB.vendorId } });
      expect(rowsB.map((row) => row.pincode)).toEqual(['700001']);
    });

    it('a customer cannot read or write the vendor serviceability surface', async () => {
      const customer = await customerFor('buyer');

      await getPincodes(customer).expect(403);
      await putPincodes(customer, { pincodes: ['560001'] }).expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app).get('/api/v1/vendors/me/serviceable-pincodes').expect(401);
      await request(app)
        .put('/api/v1/vendors/me/serviceable-pincodes')
        .send({ pincodes: ['560001'] })
        .expect(401);
    });
  });

  describe('order placement (D4, D7)', () => {
    it('places the order for an unconfigured vendor — serve-everywhere (D7)', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('fresh');
      await db.serviceablePincode.deleteMany({ where: { vendorId: seeded.vendor.vendorId } });

      const response = await attemptOrder(customer, [seeded.variantId]);

      expect(response.status).toBe(201);
    });

    it('places the order when the configured vendor declared the address pincode', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putPincodes(seeded.vendor, { pincodes: ['560001'] }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId]);

      expect(response.status).toBe(201);
    });

    it('refuses the order when the configured vendor did not declare the pincode', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putPincodes(seeded.vendor, { pincodes: ['560001'] }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId], {
        address: ADDRESS_560999,
      });

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_ADDRESS_NOT_SERVICEABLE');
    });

    it('names no vendor and no pincode in the refusal', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putPincodes(seeded.vendor, { pincodes: ['560001'] }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId], {
        address: ADDRESS_560999,
      });

      const body = JSON.stringify(response.body);
      expect(body).not.toContain(seeded.vendor.vendorId);
      expect(body).not.toContain('560999');
      expect(body).not.toContain('560001');
    });

    it('places a multi-vendor order when every delivery vendor is serviceable', async () => {
      const customer = await customerFor('buyer');
      const a = await seedVendor('seller');
      const b = await seedVendor('other');
      await putPincodes(a.vendor, { pincodes: ['560001'] }).expect(200);
      await putPincodes(b.vendor, { pincodes: ['560001'] }).expect(200);

      const response = await attemptOrder(customer, [a.variantId, b.variantId]);

      expect(response.status).toBe(201);
    });

    it('refuses the ENTIRE order when one of two delivery vendors is unserviceable (D4)', async () => {
      const customer = await customerFor('buyer');
      const a = await seedVendor('seller');
      const b = await seedVendor('other');
      await putPincodes(a.vendor, { pincodes: ['560001'] }).expect(200);
      await putPincodes(b.vendor, { pincodes: ['700001'] }).expect(200);

      const ordersBefore = await db.order.count({ where: { customerId: customer.userId } });
      const response = await attemptOrder(customer, [a.variantId, b.variantId]);

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_ADDRESS_NOT_SERVICEABLE');
      // All-or-nothing: the serviceable vendor's half is not placed either.
      expect(await db.order.count({ where: { customerId: customer.userId } })).toBe(ordersBefore);
    });
  });

  describe('PICKUP exemption (D6)', () => {
    it('places a PICKUP order from a vendor that serves no pincodes at all', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      // Declares a pincode the customer's address is nowhere near.
      await putPincodes(seeded.vendor, { pincodes: ['700001'] }).expect(200);

      const response = await attemptOrder(customer, [seeded.variantId], {
        pickupVendorIds: [seeded.vendor.vendorId],
      });

      expect(response.status).toBe(201);
    });

    it('checks the DELIVERY half of a mixed cart while the PICKUP half bypasses', async () => {
      const customer = await customerFor('buyer');
      const pickupVendor = await seedVendor('seller');
      const deliveryVendor = await seedVendor('other');
      await putPincodes(pickupVendor.vendor, { pincodes: ['700001'] }).expect(200);
      await putPickupSafe(deliveryVendor.vendor, ['560001']);

      const ok = await attemptOrder(customer, [pickupVendor.variantId, deliveryVendor.variantId], {
        pickupVendorIds: [pickupVendor.vendor.vendorId],
      });
      expect(ok.status).toBe(201);

      // Now make the DELIVERY vendor unserviceable: the pickup half must not
      // rescue the order.
      await putPincodes(deliveryVendor.vendor, { pincodes: ['700001'] }).expect(200);
      const refused = await attemptOrder(
        customer,
        [pickupVendor.variantId, deliveryVendor.variantId],
        { pickupVendorIds: [pickupVendor.vendor.vendorId] },
      );
      expect(refused.status).toBe(422);
      expect((refused.body as ErrorBody).error.code).toBe('ORDER_ADDRESS_NOT_SERVICEABLE');
    });
  });

  describe('customer cannot influence the decision', () => {
    it('ignores a pincode supplied in the order request body', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await putPincodes(seeded.vendor, { pincodes: ['560001'] }).expect(200);

      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId: seeded.variantId, quantity: 1 })
        .expect(201);
      const addressResponse = await request(app)
        .post('/api/v1/me/addresses')
        .set('Authorization', auth(customer))
        .send(ADDRESS_560999)
        .expect(201);

      // The body claims a serviceable pincode; the stored address says
      // otherwise. `.strict()` refuses the unknown field outright, which is
      // the strongest possible form of "the client cannot state this".
      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', auth(customer))
        .set('Idempotency-Key', randomUUID())
        .send({
          addressId: (addressResponse.body as AddressBody).data.id,
          paymentMethod: 'ONLINE',
          pincode: '560001',
        })
        .expect(400);

      await request(app).delete('/api/v1/me/cart').set('Authorization', auth(customer));
    });

    it('refuses an address the caller does not own', async () => {
      const customer = await customerFor('buyer');
      const attacker = await customerFor('attacker');
      const seeded = await seedVendor('seller');
      await putPincodes(seeded.vendor, { pincodes: ['560001'] }).expect(200);

      const addressResponse = await request(app)
        .post('/api/v1/me/addresses')
        .set('Authorization', auth(customer))
        .send(ADDRESS_560001)
        .expect(201);

      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(attacker))
        .send({ variantId: seeded.variantId, quantity: 1 })
        .expect(201);

      // The victim's address id buys the attacker nothing — ownership is
      // checked before serviceability is ever consulted.
      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', auth(attacker))
        .set('Idempotency-Key', randomUUID())
        .send({
          addressId: (addressResponse.body as AddressBody).data.id,
          paymentMethod: 'ONLINE',
        })
        .expect(404);

      await request(app).delete('/api/v1/me/cart').set('Authorization', auth(attacker));
    });
  });

  /** Small helper so the mixed-cart test reads in the order it happens. */
  async function putPickupSafe(vendor: VendorActor, pincodes: readonly string[]): Promise<void> {
    await putPincodes(vendor, { pincodes: [...pincodes] }).expect(200);
  }
});
