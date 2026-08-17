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

const EMAIL_PREFIX = 'shop-address-';

const VALID_ADDRESS = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  label: 'Home',
};

const ADDRESS_A = {
  line1: '12 Market Road',
  line2: 'Near the clock tower',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

const ADDRESS_B = {
  line1: '99 Relocated Avenue',
  line2: null,
  city: 'Mysuru',
  state: 'Karnataka',
  pincode: '570001',
};

interface CreateProductBody {
  readonly data: { product: { id: string } };
}
interface OrderBody {
  readonly data: {
    id: string;
    subOrders: {
      id: string;
      fulfilmentMode: string;
      pickupLocation: Record<string, string | null> | null;
    }[];
  };
}
interface AddressBody {
  readonly data: { id: string };
}
interface ShopAddressBody {
  readonly data: { shopAddress: Record<string, string | null> | null; shopName: string | null };
}

/**
 * Vendor shop address and the immutable pickup-location snapshot (S4-ADDR).
 *
 * The point of this file is the snapshot's independence from the vendor
 * profile: once an order is placed, editing the shop address must not move
 * where that order says to collect. That is a fact about what the database
 * actually stored, so it is asserted here against real PostgreSQL rather
 * than a mock — including a direct row read, not just the API response.
 */
describe('Vendor shop address + pickup snapshot (S4-ADDR)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let categoryId: string;

  const auth = (actor: Actor): string => `Bearer ${actor.token}`;

  // Four cached vendors, not one per test: every `signUpVendorOwner` spends
  // from the shared LOGIN_PER_IP budget, and a label-per-test suite trips the
  // limiter partway through. `virgin` never receives an address (it proves the
  // empty state) and neither does `fresh` (it proves a pickup order can be
  // placed without one).
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

  // `object` rather than `unknown`: supertest's `send` accepts a body, and the
  // invalid-payload cases below are still expressible as object literals.
  const setShopAddress = (vendor: VendorActor, body: object): request.Test =>
    request(app)
      .put('/api/v1/vendors/me/shop-address')
      .set('Authorization', auth(vendor))
      .send(body);

  const getShopAddress = (actor: Actor): request.Test =>
    request(app).get('/api/v1/vendors/me/shop-address').set('Authorization', auth(actor));

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
        name: `Shop Address Product ${randomUUID()}`,
        variant: {
          sku: `ADDR-${randomUUID()}`,
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

  const placeOrder = async (
    customer: Actor,
    seeded: { vendor: VendorActor; variantId: string },
    options: { pickup?: boolean } = {},
  ): Promise<OrderBody['data']> => {
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

    const placeResponse = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        addressId: (addressResponse.body as AddressBody).data.id,
        paymentMethod: 'ONLINE',
        ...(options.pickup === true ? { pickupVendorIds: [seeded.vendor.vendorId] } : {}),
      })
      .expect(201);
    return (placeResponse.body as OrderBody).data;
  };

  const getOrder = (customer: Actor, orderId: string): request.Test =>
    request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', auth(customer));

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    const slug = `shop-address-${Date.now()}`;
    const category = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    // Category last — every product above still points at it and the foreign
    // key is RESTRICT, the same ordering `pickup.test.ts` documents.
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.category.deleteMany({ where: { slug: { startsWith: 'shop-address-' } } });
  });

  describe('vendor self-service', () => {
    it('creates an address on a vendor that had none, and reads it back', async () => {
      const vendor = await vendorFor('virgin');

      const before = await getShopAddress(vendor).expect(200);
      expect((before.body as ShopAddressBody).data.shopAddress).toBeNull();

      await setShopAddress(vendor, ADDRESS_A).expect(200);

      const after = await getShopAddress(vendor).expect(200);
      expect((after.body as ShopAddressBody).data.shopAddress).toEqual(ADDRESS_A);
    });

    it('replaces an existing address wholesale, clearing the optional line', async () => {
      const vendor = await vendorFor('seller');
      await setShopAddress(vendor, ADDRESS_A).expect(200);

      await setShopAddress(vendor, ADDRESS_B).expect(200);

      const after = await getShopAddress(vendor).expect(200);
      // `line2` was set and is now null — proof this replaces rather than merges.
      expect((after.body as ShopAddressBody).data.shopAddress).toEqual(ADDRESS_B);
    });

    it('rejects a partial address', async () => {
      const vendor = await vendorFor('virgin');

      await setShopAddress(vendor, { line1: '1 Only Street' }).expect(400);
    });

    it('rejects a malformed pincode', async () => {
      const vendor = await vendorFor('virgin');

      await setShopAddress(vendor, { ...ADDRESS_A, pincode: '12' }).expect(400);
    });

    it('rejects unknown fields rather than silently ignoring them', async () => {
      const vendor = await vendorFor('virgin');

      // Mass-assignment defence (SEC-12) — `.strict()` on the request schema.
      await setShopAddress(vendor, { ...ADDRESS_A, latitude: 12.97 }).expect(400);
    });
  });

  describe('isolation', () => {
    it('a vendor editing their address never touches another vendor’s', async () => {
      const vendorA = await vendorFor('seller');
      const vendorB = await vendorFor('other');
      await setShopAddress(vendorA, ADDRESS_A).expect(200);
      await setShopAddress(vendorB, ADDRESS_B).expect(200);

      // Each write resolved its own vendor from the authenticated principal —
      // there is no vendor id in the request to point at someone else.
      await setShopAddress(vendorA, { ...ADDRESS_A, city: 'Hubballi' }).expect(200);

      const bRow = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorB.vendorId } });
      expect(bRow.shopAddressCity).toBe(ADDRESS_B.city);
      expect(bRow.shopAddressLine1).toBe(ADDRESS_B.line1);
    });

    it('a customer cannot read or write the vendor shop-address surface', async () => {
      const customer = await customerFor('outsider');

      await getShopAddress(customer).expect(403);
      await request(app)
        .put('/api/v1/vendors/me/shop-address')
        .set('Authorization', auth(customer))
        .send(ADDRESS_A)
        .expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app).get('/api/v1/vendors/me/shop-address').expect(401);
      await request(app).put('/api/v1/vendors/me/shop-address').send(ADDRESS_A).expect(401);
    });
  });

  describe('pickup snapshot at placement', () => {
    it('snapshots the vendor’s address onto a PICKUP sub-order', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await setShopAddress(seeded.vendor, ADDRESS_A).expect(200);

      const order = await placeOrder(customer, seeded, { pickup: true });

      const subOrder = order.subOrders[0];
      expect(subOrder?.fulfilmentMode).toBe('PICKUP');
      expect(subOrder?.pickupLocation).toEqual(ADDRESS_A);

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrder?.id ?? '' } });
      expect(row.pickupLocationLine1).toBe(ADDRESS_A.line1);
      expect(row.pickupLocationPincode).toBe(ADDRESS_A.pincode);
    });

    it('gives a DELIVERY sub-order no pickup location, even when the vendor has an address', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await setShopAddress(seeded.vendor, ADDRESS_A).expect(200);

      const order = await placeOrder(customer, seeded);

      const subOrder = order.subOrders[0];
      expect(subOrder?.fulfilmentMode).toBe('DELIVERY');
      expect(subOrder?.pickupLocation).toBeNull();

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrder?.id ?? '' } });
      expect(row.pickupLocationLine1).toBeNull();
      expect(row.pickupLocationCity).toBeNull();
    });

    it('places a PICKUP order without a location when the vendor set no address', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('fresh');

      const order = await placeOrder(customer, seeded, { pickup: true });

      // Legal, not an error: pickup still works, there is simply no address
      // to show. Nothing is invented to fill the gap.
      expect(order.subOrders[0]?.fulfilmentMode).toBe('PICKUP');
      expect(order.subOrders[0]?.pickupLocation).toBeNull();
    });
  });

  describe('snapshot immutability — the locked decision', () => {
    it('does not change an existing order when the vendor later moves premises', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await setShopAddress(seeded.vendor, ADDRESS_A).expect(200);

      const order = await placeOrder(customer, seeded, { pickup: true });
      const subOrderId = order.subOrders[0]?.id ?? '';
      expect(order.subOrders[0]?.pickupLocation).toEqual(ADDRESS_A);

      // The vendor relocates.
      await setShopAddress(seeded.vendor, ADDRESS_B).expect(200);

      // The already-placed order is unmoved, both on the wire...
      const reread = await getOrder(customer, order.id).expect(200);
      expect((reread.body as OrderBody).data.subOrders[0]?.pickupLocation).toEqual(ADDRESS_A);

      // ...and in the row itself.
      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.pickupLocationLine1).toBe(ADDRESS_A.line1);
      expect(row.pickupLocationCity).toBe(ADDRESS_A.city);
      expect(row.pickupLocationPincode).toBe(ADDRESS_A.pincode);

      // And the vendor profile really did change — otherwise this proves nothing.
      const vendorRow = await db.vendorProfile.findUniqueOrThrow({
        where: { id: seeded.vendor.vendorId },
      });
      expect(vendorRow.shopAddressLine1).toBe(ADDRESS_B.line1);
    });

    it('gives a later order the new address while the earlier one keeps the old', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await setShopAddress(seeded.vendor, ADDRESS_A).expect(200);
      const first = await placeOrder(customer, seeded, { pickup: true });

      await setShopAddress(seeded.vendor, ADDRESS_B).expect(200);
      const second = await placeOrder(customer, seeded, { pickup: true });

      expect(first.subOrders[0]?.pickupLocation).toEqual(ADDRESS_A);
      expect(second.subOrders[0]?.pickupLocation).toEqual(ADDRESS_B);
    });
  });

  describe('customer visibility', () => {
    it('shows the location on the customer’s own pickup order', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      await setShopAddress(seeded.vendor, ADDRESS_A).expect(200);
      const order = await placeOrder(customer, seeded, { pickup: true });

      const response = await getOrder(customer, order.id).expect(200);

      expect((response.body as OrderBody).data.subOrders[0]?.pickupLocation).toEqual(ADDRESS_A);
    });

    it('does not let another customer read the pickup location', async () => {
      const customer = await customerFor('buyer');
      const attacker = await customerFor('attacker');
      const seeded = await seedVendor('seller');
      await setShopAddress(seeded.vendor, ADDRESS_A).expect(200);
      const order = await placeOrder(customer, seeded, { pickup: true });

      // The whole order is refused, so the location is unreachable with it.
      await getOrder(attacker, order.id).expect(404);
    });

    it('never exposes the shop address on the public product contract', async () => {
      const seeded = await seedVendor('other');
      await setShopAddress(seeded.vendor, ADDRESS_A).expect(200);
      const productRow = await db.product.findFirstOrThrow({
        where: { vendorId: seeded.vendor.vendorId },
      });

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${productRow.id}`)
        .expect(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain(ADDRESS_A.line1);
      expect(body).not.toContain(ADDRESS_A.pincode);
      expect(body).not.toContain('shopAddress');
    });
  });
});
