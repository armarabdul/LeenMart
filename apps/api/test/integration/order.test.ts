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

const EMAIL_PREFIX = 'order-';

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
  readonly data: {
    id: string;
    status: string;
    totalAmount: { amount: string; currency: string };
    subOrders: { id: string; status: string; totalAmount: { amount: string }; items: unknown[] }[];
  };
}
interface AddressBody {
  readonly data: { id: string };
}
interface ErrorBody {
  readonly error: { code: string };
}

describe('order', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let categoryId: string;

  const auth = (actor: Actor): string => `Bearer ${actor.token}`;

  /**
   * One signed-in vendor per label, cached — `LOGIN_PER_IP` caps logins at
   * 20/min (see `admin-kyc-decision.test.ts`'s own `adminFor` for the same
   * reasoning), and `signUpVendorOwner` always ends with a login. A fresh
   * vendor per test would blow that budget well before this file finishes;
   * a small, reused pool does not.
   */
  const vendorCache = new Map<string, VendorActor>();
  const vendorFor = async (label: string): Promise<VendorActor> => {
    const cached = vendorCache.get(label);
    if (cached) return cached;
    const vendor = await signUpVendorOwner(app, EMAIL_PREFIX, label);
    vendorCache.set(label, vendor);
    return vendor;
  };

  /**
   * One `APPROVED` product/variant carrying the given price and stock, for
   * the given (cached) vendor, activated straight to `ACTIVE` with a
   * `shopName` set — the same direct-`db` shortcut `route-manifest.ts`'s
   * `seedOrder` and `cart.test.ts`'s `seedApprovedVariant` already
   * establish, since activation has no HTTP path a customer-facing test can
   * reach (KYC + `requireFullAccess` admin decision first).
   */
  const seedVendorWithStock = async (
    label: string,
    options: { available?: number; priceMinor?: string; shopName?: string } = {},
  ): Promise<{ vendor: VendorActor; productId: string; variantId: string }> => {
    const { available = 100, priceMinor = '19900', shopName = `${label} Shop` } = options;
    const vendor = await vendorFor(label);
    const createResponse = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth(vendor))
      .send({
        categoryId,
        name: `Order Product ${randomUUID()}`,
        variant: {
          sku: `ORDER-${randomUUID()}`,
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
      data: { status: 'ACTIVE', shopName },
    });

    return { vendor, productId, variantId: variantRow.id };
  };

  const addToCart = (customer: Actor, variantId: string, quantity = 1): request.Test =>
    request(app)
      .post('/api/v1/me/cart/items')
      .set('Authorization', auth(customer))
      .send({ variantId, quantity });

  const addAddress = async (
    customer: Actor,
    overrides: Partial<typeof VALID_ADDRESS> = {},
  ): Promise<string> => {
    const response = await request(app)
      .post('/api/v1/me/addresses')
      .set('Authorization', auth(customer))
      .send({ ...VALID_ADDRESS, ...overrides })
      .expect(201);
    return (response.body as AddressBody).data.id;
  };

  const placeOrder = (
    customer: Actor,
    body: Record<string, unknown>,
    idempotencyKey: string = randomUUID(),
  ): request.Test =>
    request(app)
      .post('/api/v1/orders')
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    const slug = `order-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;
  }, 60_000);

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, 'order-cat-%');
    await db.$disconnect();
  });

  describe('POST /api/v1/orders — happy path', () => {
    it('places a single-vendor order, decrements inventory and clears the cart', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-basic');
      const { variantId } = await seedVendorWithStock('shared', { available: 10 });
      await addToCart(customer, variantId, 3).expect(201);
      const addressId = await addAddress(customer);

      const response = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(
        201,
      );
      const body = (response.body as OrderBody).data;

      expect(body.status).toBe('PENDING_PAYMENT');
      expect(body.subOrders).toHaveLength(1);
      expect(body.subOrders[0]?.items).toHaveLength(1);
      expect(body.totalAmount.amount).toBe('59700');

      const inventory = await db.inventory.findUnique({ where: { variantId } });
      expect(inventory?.available).toBe(7);

      const cart = await db.cart.findUnique({ where: { userId: customer.userId } });
      const liveItems = cart
        ? await db.cartItem.findMany({ where: { cartId: cart.id, deletedAt: null } })
        : [];
      expect(liveItems).toHaveLength(0);
    });

    it('writes exactly one OrderPlaced outbox event', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-outbox');
      const { variantId } = await seedVendorWithStock('shared');
      await addToCart(customer, variantId, 1).expect(201);
      const addressId = await addAddress(customer);

      const response = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(
        201,
      );
      const orderId = (response.body as OrderBody).data.id;

      const events = await db.outboxEvent.findMany({ where: { aggregateId: orderId } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ aggregateType: 'Order', eventType: 'order.placed' });
    });

    it('places a genuinely atomic multi-vendor order: two SubOrders, both vendors decremented', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-multi');
      const a = await seedVendorWithStock('multi-a', { available: 20, priceMinor: '10000' });
      const b = await seedVendorWithStock('multi-b', { available: 15, priceMinor: '5000' });
      await addToCart(customer, a.variantId, 2).expect(201);
      await addToCart(customer, b.variantId, 4).expect(201);
      const addressId = await addAddress(customer);

      const response = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(
        201,
      );
      const body = (response.body as OrderBody).data;

      expect(body.subOrders).toHaveLength(2);
      expect(body.totalAmount.amount).toBe('40000'); // 2*10000 + 4*5000

      const vendorIds = body.subOrders.map((s) => s.id);
      expect(new Set(vendorIds).size).toBe(2);

      const inventoryA = await db.inventory.findUnique({ where: { variantId: a.variantId } });
      const inventoryB = await db.inventory.findUnique({ where: { variantId: b.variantId } });
      expect(inventoryA?.available).toBe(18);
      expect(inventoryB?.available).toBe(11);

      const order = await db.order.findUnique({
        where: { id: body.id },
        include: { subOrders: { include: { items: true } } },
      });
      expect(order?.subOrders).toHaveLength(2);
      expect(order?.subOrders.every((s) => s.items.length === 1)).toBe(true);
    });

    it('rolls back the entire transaction when one of several vendors is out of stock', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-rollback');
      const ok = await seedVendorWithStock('multi-a', { available: 50 });
      const short = await seedVendorWithStock('multi-b', { available: 5 });
      await addToCart(customer, ok.variantId, 5).expect(201);
      await addToCart(customer, short.variantId, 2).expect(201);
      // Stock drops out from under the cart *after* it was added but *before*
      // checkout — the exact race PlaceOrderUseCase's fresh atomic decrement
      // (not the cart's own add-time check) exists to catch.
      await db.inventory.update({ where: { variantId: short.variantId }, data: { available: 1 } });
      const addressId = await addAddress(customer);

      const response = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(
        422,
      );
      expect((response.body as ErrorBody).error.code).toBe('ORDER_INSUFFICIENT_STOCK');

      // The vendor that *did* have stock must show no partial decrement —
      // proof the whole multi-line transaction rolled back, not just the
      // failing line.
      const inventoryOk = await db.inventory.findUnique({ where: { variantId: ok.variantId } });
      expect(inventoryOk?.available).toBe(50);

      const orders = await db.order.findMany({ where: { customerId: customer.userId } });
      expect(orders).toHaveLength(0);
    });
  });

  describe('POST /api/v1/orders — validation and eligibility', () => {
    it('rejects an empty cart', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-empty');
      const addressId = await addAddress(customer);

      const response = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(
        422,
      );
      expect((response.body as ErrorBody).error.code).toBe('ORDER_EMPTY_CART');
    });

    it('rejects when the vendor is not ACTIVE, even with an APPROVED product', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-inactive');
      const { vendor, variantId } = await seedVendorWithStock('inactive');
      await db.vendorProfile.update({
        where: { id: vendor.vendorId },
        data: { status: 'KYC_APPROVED' },
      });
      await addToCart(customer, variantId, 1).expect(201);
      const addressId = await addAddress(customer);

      const response = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(
        422,
      );
      expect((response.body as ErrorBody).error.code).toBe('ORDER_VENDOR_NOT_ELIGIBLE');
    });

    it('rejects when the ACTIVE vendor has never set a shopName', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-noshop');
      const { vendor, variantId } = await seedVendorWithStock('noshop');
      await db.vendorProfile.update({ where: { id: vendor.vendorId }, data: { shopName: null } });
      await addToCart(customer, variantId, 1).expect(201);
      const addressId = await addAddress(customer);

      const response = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(
        422,
      );
      expect((response.body as ErrorBody).error.code).toBe('ORDER_VENDOR_NOT_ELIGIBLE');
    });

    it("404s an address that belongs to a different customer, never distinguishing 'missing' from 'not yours'", async () => {
      const owner = await signUpCustomer(app, EMAIL_PREFIX, 'place-addr-owner');
      const attacker = await signUpCustomer(app, EMAIL_PREFIX, 'place-addr-attacker');
      const { variantId } = await seedVendorWithStock('shared');
      await addToCart(attacker, variantId, 1).expect(201);
      const addressId = await addAddress(owner);

      const response = await placeOrder(attacker, { addressId, paymentMethod: 'ONLINE' }).expect(
        404,
      );
      expect((response.body as ErrorBody).error.code).toBe('ORDER_ADDRESS_NOT_FOUND');
    });

    it('rejects anything other than the literal ONLINE payment method at the contract layer (400, COD excluded)', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-cod');
      const { variantId } = await seedVendorWithStock('shared');
      await addToCart(customer, variantId, 1).expect(201);
      const addressId = await addAddress(customer);

      await placeOrder(customer, { addressId, paymentMethod: 'COD' }).expect(400);
    });
  });

  describe('POST /api/v1/orders — idempotency', () => {
    it('requires the Idempotency-Key header (400, before any use case runs)', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-idem-missing');
      const { variantId } = await seedVendorWithStock('shared');
      await addToCart(customer, variantId, 1).expect(201);
      const addressId = await addAddress(customer);

      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', auth(customer))
        .send({ addressId, paymentMethod: 'ONLINE' })
        .expect(400);
    });

    it('replays the original order for a repeated key with the same payload — no second decrement', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-idem-replay');
      const { variantId } = await seedVendorWithStock('shared', { available: 10 });
      await addToCart(customer, variantId, 2).expect(201);
      const addressId = await addAddress(customer);
      const key = `replay-${randomUUID()}`;
      const body = { addressId, paymentMethod: 'ONLINE' };

      const first = await placeOrder(customer, body, key).expect(201);
      const second = await placeOrder(customer, body, key).expect(201);

      expect((second.body as OrderBody).data.id).toBe((first.body as OrderBody).data.id);
      const inventory = await db.inventory.findUnique({ where: { variantId } });
      expect(inventory?.available).toBe(8); // decremented exactly once
      const orders = await db.order.findMany({ where: { customerId: customer.userId } });
      expect(orders).toHaveLength(1);
    });

    it('rejects the same key reused with a different payload (409, not a silent overwrite)', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'place-idem-conflict');
      const { variantId } = await seedVendorWithStock('shared');
      await addToCart(customer, variantId, 1).expect(201);
      const addressA = await addAddress(customer, { label: 'Home' });
      const addressB = await addAddress(customer, { label: 'Office' });
      const key = `conflict-${randomUUID()}`;

      await placeOrder(customer, { addressId: addressA, paymentMethod: 'ONLINE' }, key).expect(201);
      const response = await placeOrder(
        customer,
        { addressId: addressB, paymentMethod: 'ONLINE' },
        key,
      ).expect(409);
      expect((response.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('GET /api/v1/orders/:id', () => {
    it('returns the order to its owner', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'get-basic');
      const { variantId } = await seedVendorWithStock('shared');
      await addToCart(customer, variantId, 1).expect(201);
      const addressId = await addAddress(customer);
      const placeResponse = await placeOrder(customer, {
        addressId,
        paymentMethod: 'ONLINE',
      }).expect(201);
      const orderId = (placeResponse.body as OrderBody).data.id;

      const response = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', auth(customer))
        .expect(200);
      expect((response.body as OrderBody).data.id).toBe(orderId);
    });

    it("404s for an order that belongs to a different customer (SEC-06: never distinguishes 'missing' from 'not yours')", async () => {
      const owner = await signUpCustomer(app, EMAIL_PREFIX, 'get-owner');
      const attacker = await signUpCustomer(app, EMAIL_PREFIX, 'get-attacker');
      const { variantId } = await seedVendorWithStock('shared');
      await addToCart(owner, variantId, 1).expect(201);
      const addressId = await addAddress(owner);
      const placeResponse = await placeOrder(owner, { addressId, paymentMethod: 'ONLINE' }).expect(
        201,
      );
      const orderId = (placeResponse.body as OrderBody).data.id;

      const response = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', auth(attacker))
        .expect(404);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_NOT_FOUND');
    });

    it('404s for an order id that never existed', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'get-missing');

      await request(app)
        .get(`/api/v1/orders/${randomUUID()}`)
        .set('Authorization', auth(customer))
        .expect(404);
    });
  });

  describe('POST /api/v1/orders/:id/cancel', () => {
    it('cancels a PENDING_PAYMENT order and restores inventory', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'cancel-basic');
      const { variantId } = await seedVendorWithStock('shared', { available: 10 });
      await addToCart(customer, variantId, 3).expect(201);
      const addressId = await addAddress(customer);
      const placeResponse = await placeOrder(customer, {
        addressId,
        paymentMethod: 'ONLINE',
      }).expect(201);
      const orderId = (placeResponse.body as OrderBody).data.id;
      expect((await db.inventory.findUnique({ where: { variantId } }))?.available).toBe(7);

      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', auth(customer))
        .expect(200);
      expect((response.body as OrderBody).data.status).toBe('CANCELLED');

      const inventory = await db.inventory.findUnique({ where: { variantId } });
      expect(inventory?.available).toBe(10);
    });

    it("404s for another customer's order and leaves inventory untouched", async () => {
      const owner = await signUpCustomer(app, EMAIL_PREFIX, 'cancel-owner');
      const attacker = await signUpCustomer(app, EMAIL_PREFIX, 'cancel-attacker');
      const { variantId } = await seedVendorWithStock('shared', { available: 10 });
      await addToCart(owner, variantId, 1).expect(201);
      const addressId = await addAddress(owner);
      const placeResponse = await placeOrder(owner, { addressId, paymentMethod: 'ONLINE' }).expect(
        201,
      );
      const orderId = (placeResponse.body as OrderBody).data.id;

      await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', auth(attacker))
        .expect(404);

      const inventory = await db.inventory.findUnique({ where: { variantId } });
      expect(inventory?.available).toBe(9);
    });

    it('refuses to cancel once a sub-order has reached PROCESSING, and does not restore inventory', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'cancel-processing');
      const { variantId } = await seedVendorWithStock('shared', { available: 10 });
      await addToCart(customer, variantId, 2).expect(201);
      const addressId = await addAddress(customer);
      const placeResponse = await placeOrder(customer, {
        addressId,
        paymentMethod: 'ONLINE',
      }).expect(201);
      const orderId = (placeResponse.body as OrderBody).data.id;

      // No HTTP path reaches PROCESSING in S3-3A (fulfilment is out of
      // scope) — set directly, the same shortcut this file uses for vendor
      // activation, to exercise the domain rule the approved decision named.
      await db.order.update({ where: { id: orderId }, data: { status: 'PROCESSING' } });
      await db.subOrder.updateMany({ where: { orderId }, data: { status: 'PROCESSING' } });

      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', auth(customer))
        .expect(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_CANCELLATION_NOT_ALLOWED');

      const inventory = await db.inventory.findUnique({ where: { variantId } });
      expect(inventory?.available).toBe(8);
    });
  });
});
