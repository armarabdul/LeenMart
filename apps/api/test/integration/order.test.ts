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
interface PaymentInitiationBody {
  readonly data: { orderId: string; status: string };
}
interface OrderSummaryListBody {
  readonly data: {
    id: string;
    status: string;
    totalAmount: { amount: string };
    createdAt: string;
  }[];
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

  const initiatePayment = (
    customer: Actor,
    orderId: string,
    idempotencyKey: string = randomUUID(),
  ): request.Test =>
    request(app)
      .post(`/api/v1/orders/${orderId}/payment/initiate`)
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', idempotencyKey);

  const confirmPayment = (
    customer: Actor,
    orderId: string,
    testScenario: 'SUCCEEDED' | 'FAILED',
    idempotencyKey: string = randomUUID(),
  ): request.Test =>
    request(app)
      .post(`/api/v1/orders/${orderId}/payment/confirm`)
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', idempotencyKey)
      .send({ testScenario });

  /** Cart -> address -> `POST /orders`, ending PENDING_PAYMENT — the shared starting point every payment test needs. */
  const placeReadyOrder = async (
    customer: Actor,
    options: { available?: number; priceMinor?: string; quantity?: number } = {},
  ): Promise<{ orderId: string; variantId: string }> => {
    const { quantity = 1, ...stockOptions } = options;
    const { variantId } = await seedVendorWithStock('shared', stockOptions);
    await addToCart(customer, variantId, quantity).expect(201);
    const addressId = await addAddress(customer);
    const placeResponse = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(
      201,
    );
    return { orderId: (placeResponse.body as OrderBody).data.id, variantId };
  };

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

  describe('GET /api/v1/orders — My Orders (S3-4)', () => {
    it('returns the caller’s own orders, newest first', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'list-basic');
      const { variantId } = await seedVendorWithStock('shared');
      const addressId = await addAddress(customer);

      await addToCart(customer, variantId, 1).expect(201);
      const first = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(201);
      await addToCart(customer, variantId, 1).expect(201);
      const second = await placeOrder(customer, { addressId, paymentMethod: 'ONLINE' }).expect(201);

      const response = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', auth(customer))
        .expect(200);
      const body = (response.body as OrderSummaryListBody).data;

      const firstId = (first.body as OrderBody).data.id;
      const secondId = (second.body as OrderBody).data.id;
      expect(body[0]?.id).toBe(secondId);
      expect(body[1]?.id).toBe(firstId);
      expect(body.every((row) => row.status === 'PENDING_PAYMENT')).toBe(true);
      expect(body[0]?.totalAmount.amount).toBe('19900');
      expect(typeof body[0]?.createdAt).toBe('string');
    });

    it('returns an empty list for a customer with no orders', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'list-empty');

      const response = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', auth(customer))
        .expect(200);

      expect((response.body as OrderSummaryListBody).data).toEqual([]);
    });

    it('never returns another customer’s orders (SEC-06)', async () => {
      const owner = await signUpCustomer(app, EMAIL_PREFIX, 'list-owner');
      const attacker = await signUpCustomer(app, EMAIL_PREFIX, 'list-attacker');
      const { variantId } = await seedVendorWithStock('shared');
      await addToCart(owner, variantId, 1).expect(201);
      const addressId = await addAddress(owner);
      await placeOrder(owner, { addressId, paymentMethod: 'ONLINE' }).expect(201);

      const response = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', auth(attacker))
        .expect(200);

      expect((response.body as OrderSummaryListBody).data).toEqual([]);
    });

    it('requires authentication', async () => {
      await request(app).get('/api/v1/orders').expect(401);
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

  describe('POST /api/v1/orders/:id/payment/initiate', () => {
    it('starts a payment attempt for a valid PENDING_PAYMENT order', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-init-basic');
      const { orderId } = await placeReadyOrder(customer);

      const response = await initiatePayment(customer, orderId).expect(201);
      const body = (response.body as PaymentInitiationBody).data;

      expect(body.orderId).toBe(orderId);
      expect(body.status).toBe('PAYMENT_PENDING');

      const attempt = await db.paymentAttempt.findFirst({ where: { orderId } });
      expect(attempt?.status).toBe('INITIATED');
      expect(attempt?.provider).toBe('MOCK');
      expect(attempt?.providerReference).toMatch(/^MOCK-/);
    });

    it('404s for another customer’s order', async () => {
      const owner = await signUpCustomer(app, EMAIL_PREFIX, 'pay-init-owner');
      const attacker = await signUpCustomer(app, EMAIL_PREFIX, 'pay-init-attacker');
      const { orderId } = await placeReadyOrder(owner);

      await initiatePayment(attacker, orderId).expect(404);

      const attempts = await db.paymentAttempt.findMany({ where: { orderId } });
      expect(attempts).toHaveLength(0);
    });

    it('404s for an order id that never existed', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-init-missing');

      await initiatePayment(customer, randomUUID()).expect(404);
    });

    it('rejects initiating a second attempt while one is already INITIATED', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-init-twice');
      const { orderId } = await placeReadyOrder(customer);

      await initiatePayment(customer, orderId).expect(201);
      const response = await initiatePayment(customer, orderId).expect(409);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_PAYMENT_ALREADY_INITIATED');

      const attempts = await db.paymentAttempt.findMany({ where: { orderId } });
      expect(attempts).toHaveLength(1);
    });

    it('requires the Idempotency-Key header', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-init-idem-missing');
      const { orderId } = await placeReadyOrder(customer);

      await request(app)
        .post(`/api/v1/orders/${orderId}/payment/initiate`)
        .set('Authorization', auth(customer))
        .expect(400);
    });

    it('replays the original attempt for a repeated key — no second row created', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-init-idem-replay');
      const { orderId } = await placeReadyOrder(customer);
      const key = `pay-init-replay-${randomUUID()}`;

      const first = await initiatePayment(customer, orderId, key).expect(201);
      const second = await initiatePayment(customer, orderId, key).expect(201);

      expect((second.body as PaymentInitiationBody).data).toEqual(
        (first.body as PaymentInitiationBody).data,
      );
      const attempts = await db.paymentAttempt.findMany({ where: { orderId } });
      expect(attempts).toHaveLength(1);
    });
  });

  describe('POST /api/v1/orders/:id/payment/confirm', () => {
    it('confirms a successful mock payment and flips the order to CONFIRMED', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-success');
      const { orderId } = await placeReadyOrder(customer);
      await initiatePayment(customer, orderId).expect(201);

      const response = await confirmPayment(customer, orderId, 'SUCCEEDED').expect(200);
      const body = (response.body as OrderBody).data;

      expect(body.id).toBe(orderId);
      expect(body.status).toBe('CONFIRMED');
      expect(body.subOrders.every((s) => s.status === 'CONFIRMED')).toBe(true);

      const order = await db.order.findUnique({ where: { id: orderId } });
      expect(order?.status).toBe('CONFIRMED');
      const attempt = await db.paymentAttempt.findFirst({ where: { orderId } });
      expect(attempt?.status).toBe('SUCCEEDED');
    });

    it('does not confirm the order on a failed mock payment, and records the attempt as FAILED', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-fail');
      const { orderId } = await placeReadyOrder(customer);
      await initiatePayment(customer, orderId).expect(201);

      const response = await confirmPayment(customer, orderId, 'FAILED').expect(422);
      expect((response.body as ErrorBody).error.code).toBe('PAYMENT_FAILED');

      const order = await db.order.findUnique({ where: { id: orderId } });
      expect(order?.status).toBe('PENDING_PAYMENT');
      const attempt = await db.paymentAttempt.findFirst({ where: { orderId } });
      expect(attempt?.status).toBe('FAILED');
    });

    it('allows a fresh attempt after a failure, and that retry can succeed', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-retry');
      const { orderId } = await placeReadyOrder(customer);
      await initiatePayment(customer, orderId).expect(201);
      await confirmPayment(customer, orderId, 'FAILED').expect(422);

      await initiatePayment(customer, orderId).expect(201);
      const response = await confirmPayment(customer, orderId, 'SUCCEEDED').expect(200);
      expect((response.body as OrderBody).data.status).toBe('CONFIRMED');

      const attempts = await db.paymentAttempt.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(attempts).toHaveLength(2);
      expect(attempts.map((a) => a.status)).toEqual(['FAILED', 'SUCCEEDED']);
    });

    it('rejects confirmation when no attempt was ever initiated', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-noattempt');
      const { orderId } = await placeReadyOrder(customer);

      const response = await confirmPayment(customer, orderId, 'SUCCEEDED').expect(404);
      expect((response.body as ErrorBody).error.code).toBe('PAYMENT_ATTEMPT_NOT_FOUND');
    });

    it('404s for another customer’s order, regardless of whether a payment was ever initiated', async () => {
      const owner = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-owner');
      const attacker = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-attacker');
      const { orderId } = await placeReadyOrder(owner);
      await initiatePayment(owner, orderId).expect(201);

      await confirmPayment(attacker, orderId, 'SUCCEEDED').expect(404);

      const order = await db.order.findUnique({ where: { id: orderId } });
      expect(order?.status).toBe('PENDING_PAYMENT');
    });

    it('404s for an order id that never existed', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-missing');

      await confirmPayment(customer, randomUUID(), 'SUCCEEDED').expect(404);
    });

    it('cannot confirm an order that is already CONFIRMED (no double-confirmation)', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-twice');
      const { orderId } = await placeReadyOrder(customer);
      await initiatePayment(customer, orderId).expect(201);
      await confirmPayment(customer, orderId, 'SUCCEEDED').expect(200);

      const response = await confirmPayment(customer, orderId, 'SUCCEEDED').expect(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_NOT_PENDING_PAYMENT');
    });

    it('requires the Idempotency-Key header', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-idem-missing');
      const { orderId } = await placeReadyOrder(customer);
      await initiatePayment(customer, orderId).expect(201);

      await request(app)
        .post(`/api/v1/orders/${orderId}/payment/confirm`)
        .set('Authorization', auth(customer))
        .send({ testScenario: 'SUCCEEDED' })
        .expect(400);
    });

    it('replays the original confirmation for a repeated key — order confirmed exactly once', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-idem-replay');
      const { orderId } = await placeReadyOrder(customer);
      await initiatePayment(customer, orderId).expect(201);
      const key = `pay-confirm-replay-${randomUUID()}`;

      const first = await confirmPayment(customer, orderId, 'SUCCEEDED', key).expect(200);
      const second = await confirmPayment(customer, orderId, 'SUCCEEDED', key).expect(200);

      expect((second.body as OrderBody).data).toEqual((first.body as OrderBody).data);
      const attempts = await db.paymentAttempt.findMany({ where: { orderId } });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.status).toBe('SUCCEEDED');
    });

    it('rejects a confirm request carrying an amount/status field the contract does not define', async () => {
      // `confirmPaymentRequestSchema` is `.strict()` (SEC-02): there is no
      // field on this request the client could use to smuggle an amount,
      // a status, or anything else — a request that tries is rejected by
      // validation before the use case ever runs, never silently ignored.
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-strict');
      const { orderId } = await placeReadyOrder(customer);
      await initiatePayment(customer, orderId).expect(201);

      await request(app)
        .post(`/api/v1/orders/${orderId}/payment/confirm`)
        .set('Authorization', auth(customer))
        .set('Idempotency-Key', randomUUID())
        .send({ testScenario: 'SUCCEEDED', amount: '1' })
        .expect(400);
    });

    it('confirms using the order’s own persisted total, regardless of the price at confirmation time', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'pay-confirm-amount');
      const { orderId } = await placeReadyOrder(customer, { priceMinor: '12345', quantity: 2 });
      await initiatePayment(customer, orderId).expect(201);

      const response = await confirmPayment(customer, orderId, 'SUCCEEDED').expect(200);

      const body = (response.body as OrderBody).data;
      expect(body.totalAmount.amount).toBe('24690'); // 2 * 12345, the order's own persisted total
    });
  });
});
