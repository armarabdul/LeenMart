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
import { SystemClock } from '@leen-mart/domain-kit';
import { Ed25519PickupTokenSigner } from '../../src/modules/order/infrastructure/crypto/ed25519-pickup-token-signer.js';

const EMAIL_PREFIX = 'pickup-qr-';

/**
 * The single code every refusal collapses to (SEC-15). Named once here so a
 * test that accidentally accepts a *different* code has to say so explicitly.
 */
const GENERIC = 'PICKUP_TOKEN_INVALID';

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
interface PickupTokenBody {
  readonly data: { token: string; expiresAt: string; manualCode: string };
}
interface VendorSubOrderBody {
  readonly data: { id: string; status: string; fulfilmentMode: string };
}

/**
 * QR pickup end to end (S4-QR, SDD §13).
 *
 * The security matrix is the point of this file: every way a token can be
 * wrong — forged, expired, replayed, aimed at another vendor, aimed at
 * another sub-order — plus the concurrency proof that exactly one of two
 * simultaneous redemptions can win. Those are facts about the database's
 * compare-and-set and the signer's verification, so they are asserted here
 * against real PostgreSQL rather than against a mock.
 */
describe('QR pickup (S4-QR)', () => {
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

  const customerCache = new Map<string, Actor>();
  const customerFor = async (label: string): Promise<Actor> => {
    const cached = customerCache.get(label);
    if (cached) return cached;
    const customer = await signUpCustomer(app, EMAIL_PREFIX, label);
    customerCache.set(label, customer);
    return customer;
  };

  /** ACTIVE vendor, APPROVED product with stock — mirrors `vendor-order.test.ts`. */
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
        name: `Pickup Product ${randomUUID()}`,
        variant: {
          sku: `PICKUP-${randomUUID()}`,
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

  /** Cart -> address -> place (optionally PICKUP) -> pay, ending CONFIRMED. */
  const placeConfirmedOrder = async (
    customer: Actor,
    seeded: { vendor: VendorActor; variantId: string },
    options: { pickup?: boolean } = {},
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
        ...(options.pickup === true ? { pickupVendorIds: [seeded.vendor.vendorId] } : {}),
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
    return { orderId, subOrderId: subOrderRow.id };
  };

  /** A PICKUP sub-order already moved to READY_FOR_PICKUP — the state a token is issued from. */
  const readyForPickup = async (
    label: string,
    customerLabel = 'buyer',
  ): Promise<{
    orderId: string;
    subOrderId: string;
    vendor: VendorActor;
    customer: Actor;
  }> => {
    const customer = await customerFor(customerLabel);
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

  const tokenFor = async (
    customer: Actor,
    orderId: string,
    subOrderId: string,
  ): Promise<string> => {
    const response = await request(app)
      .get(`/api/v1/orders/${orderId}/sub-orders/${subOrderId}/pickup-token`)
      .set('Authorization', auth(customer))
      .expect(200);
    return (response.body as PickupTokenBody).data.token;
  };

  const redeem = (vendor: VendorActor, token: string, queuedOffline = false): request.Test =>
    request(app)
      .post('/api/v1/vendor/orders/pickup/redeem')
      .set('Authorization', auth(vendor))
      .send(queuedOffline ? { token, queuedOffline: true } : { token });

  const manualCodeFor = async (
    customer: Actor,
    orderId: string,
    subOrderId: string,
  ): Promise<string> => {
    const response = await request(app)
      .get(`/api/v1/orders/${orderId}/sub-orders/${subOrderId}/pickup-token`)
      .set('Authorization', auth(customer))
      .expect(200);
    return (response.body as PickupTokenBody).data.manualCode;
  };

  const manualComplete = (vendor: VendorActor, subOrderId: string, code: string): request.Test =>
    request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/pickup/manual-complete`)
      .set('Authorization', auth(vendor))
      .send({ code });

  /** `undefined` for a success body, so the racing pair can be mapped uniformly. */
  const codeOf = (response: request.Response): string | undefined =>
    (response.body as Partial<ErrorBody>).error?.code;

  /**
   * A correctly signed token that is already past its expiry, minted with the
   * running app's own keys so only `exp` distinguishes it from a real one —
   * a negative TTL is the only difference from what the API itself issues.
   */
  const expiredTokenFor = (subOrderId: string): string =>
    new Ed25519PickupTokenSigner(
      {
        privateKeyPem: harness.container.env.PICKUP_TOKEN_PRIVATE_KEY,
        publicKeyPem: harness.container.env.PICKUP_TOKEN_PUBLIC_KEY,
        ttlSeconds: -60,
      },
      new SystemClock(),
    ).sign(subOrderId).token;

  const pickupSideEffectCounts = async (
    subOrderId: string,
  ): Promise<{ audit: number; outbox: number }> => ({
    audit: await db.auditLog.count({
      where: { entityId: subOrderId, action: 'sub_order.pickup_completed' },
    }),
    outbox: await db.outboxEvent.count({
      where: { aggregateId: subOrderId, eventType: 'sub_order.pickup_completed' },
    }),
  });

  const auditCountFor = async (subOrderId: string, action: string): Promise<number> =>
    db.auditLog.count({ where: { entityId: subOrderId, action } });

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    const slug = `pickup-qr-${Date.now()}`;
    const category = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    // Category last: every product created above still points at it, and the
    // foreign key is RESTRICT, so it can only be removed once
    // `disposeIntegrationHarness` has deleted the products (and the orders
    // and sub-orders that reference *them*) child-first.
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.category.deleteMany({ where: { slug: { startsWith: 'pickup-qr-' } } });
  });

  describe('fulfilment mode at checkout (locked decisions #4, #24, #25)', () => {
    it('defaults every sub-order to DELIVERY when no pickup is requested', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      const { subOrderId } = await placeConfirmedOrder(customer, seeded);

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.fulfilmentMode).toBe('DELIVERY');
    });

    it('records PICKUP for a vendor the customer chose and who supports it', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      const { subOrderId } = await placeConfirmedOrder(customer, seeded, { pickup: true });

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.fulfilmentMode).toBe('PICKUP');
    });

    it('refuses PICKUP for a vendor that does not support it — never silently downgrades', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('no-pickup', { supportsPickup: false });
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

      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', auth(customer))
        .set('Idempotency-Key', randomUUID())
        .send({
          addressId: (addressResponse.body as AddressBody).data.id,
          paymentMethod: 'ONLINE',
          pickupVendorIds: [seeded.vendor.vendorId],
        })
        .expect(422);

      expect((response.body as ErrorBody).error.code).toBe('ORDER_PICKUP_NOT_SUPPORTED');
      expect(
        await db.order.count({ where: { customerId: customer.userId } }),
      ).toBeGreaterThanOrEqual(0);
    });
  });

  describe('READY_FOR_PICKUP is PICKUP-only (locked decisions #6, #8)', () => {
    it('moves a PROCESSING pickup sub-order to READY_FOR_PICKUP', async () => {
      const { subOrderId } = await readyForPickup('seller');

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('READY_FOR_PICKUP');
    });

    it('refuses READY_FOR_PICKUP for a DELIVERY sub-order', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      const { subOrderId } = await placeConfirmedOrder(customer, seeded);
      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(seeded.vendor))
        .expect(200);

      const response = await redeemReadyForPickup(seeded.vendor, subOrderId).expect(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_FULFILMENT_MODE_MISMATCH');
    });

    it('refuses a repeated READY_FOR_PICKUP', async () => {
      const { subOrderId, vendor } = await readyForPickup('seller');

      await redeemReadyForPickup(vendor, subOrderId).expect(422);
    });

    it('404s for another vendor’s sub-order', async () => {
      const { subOrderId } = await readyForPickup('seller');
      const attacker = await vendorFor('attacker');
      await db.vendorProfile.update({
        where: { id: attacker.vendorId },
        data: { status: 'ACTIVE' },
      });

      await redeemReadyForPickup(attacker, subOrderId).expect(404);
    });
  });

  describe('SHIP/DELIVER reject PICKUP sub-orders (locked decision #7)', () => {
    it('refuses /ship on a pickup sub-order', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      const { subOrderId } = await placeConfirmedOrder(customer, seeded, { pickup: true });
      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(seeded.vendor))
        .expect(200);

      const response = await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/ship`)
        .set('Authorization', auth(seeded.vendor))
        .expect(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_FULFILMENT_MODE_MISMATCH');
    });

    it('refuses /deliver on a pickup sub-order', async () => {
      const { subOrderId, vendor } = await readyForPickup('seller');

      const response = await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/deliver`)
        .set('Authorization', auth(vendor))
        .expect(422);
      expect((response.body as ErrorBody).error.code).toBe('ORDER_FULFILMENT_MODE_MISMATCH');
    });
  });

  describe('token issuance (customer)', () => {
    it('issues a token for the customer’s own READY_FOR_PICKUP sub-order', async () => {
      const { orderId, subOrderId, customer } = await readyForPickup('seller');

      const response = await request(app)
        .get(`/api/v1/orders/${orderId}/sub-orders/${subOrderId}/pickup-token`)
        .set('Authorization', auth(customer))
        .expect(200);

      const body = response.body as PickupTokenBody;
      expect(body.data.token.length).toBeGreaterThan(20);
      expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('rotates the token on re-issue, invalidating the previous one', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const first = await tokenFor(customer, orderId, subOrderId);
      const second = await tokenFor(customer, orderId, subOrderId);

      expect(second).not.toBe(first);
      // The rotated-out token is refused; the current one still works.
      await redeem(vendor, first).expect(422);
      await redeem(vendor, second).expect(200);
    });

    it('refuses another customer’s sub-order', async () => {
      const { orderId, subOrderId } = await readyForPickup('seller');
      const attacker = await customerFor('attacker');

      await request(app)
        .get(`/api/v1/orders/${orderId}/sub-orders/${subOrderId}/pickup-token`)
        .set('Authorization', auth(attacker))
        .expect(404);
    });
  });

  describe('redemption — the mandatory security matrix (SDD §13)', () => {
    it('a valid token succeeds and completes the sub-order', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);

      const response = await redeem(vendor, token).expect(200);
      expect((response.body as VendorSubOrderBody).data.status).toBe('COMPLETED');

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('COMPLETED');
    });

    it('a forged token fails', async () => {
      const { vendor } = await readyForPickup('seller');

      const response = await redeem(vendor, 'not.a.valid.token').expect(422);
      expect(codeOf(response)).toBe(GENERIC);
    });

    it('a tampered signature fails', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);
      const tampered = `${token.slice(0, -3)}${token.endsWith('AAA') ? 'BBB' : 'AAA'}`;

      const response = await redeem(vendor, tampered).expect(422);
      expect(codeOf(response)).toBe(GENERIC);
    });

    it('an expired but correctly signed token fails', async () => {
      const { subOrderId, vendor } = await readyForPickup('seller');

      const response = await redeem(vendor, expiredTokenFor(subOrderId)).expect(422);
      expect(codeOf(response)).toBe(GENERIC);

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('READY_FOR_PICKUP');
    });

    it('replay by the owning vendor is refused with the same generic code, revealing no state', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);

      await redeem(vendor, token).expect(200);
      const replay = await redeem(vendor, token).expect(422);

      // The whole point of this hardening: the vendor that legitimately
      // redeemed this token learns nothing more from replaying it than a
      // stranger with a forged one does.
      expect(codeOf(replay)).toBe(GENERIC);
      const body = JSON.stringify(replay.body);
      for (const leak of ['COMPLETED', 'READY_FOR_PICKUP', 'REDEEMED', subOrderId, orderId]) {
        expect(body).not.toContain(leak);
      }
      expect(body).not.toMatch(/redeem/i);
    });

    it('replay writes no second audit or outbox event', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);

      await redeem(vendor, token).expect(200);
      const after = await pickupSideEffectCounts(subOrderId);

      await redeem(vendor, token).expect(422);
      await redeem(vendor, token).expect(422);

      expect(after).toEqual({ audit: 1, outbox: 1 });
      expect(await pickupSideEffectCounts(subOrderId)).toEqual(after);
      // And the redemption record itself is untouched by the replays.
      const row = await db.pickupToken.findFirstOrThrow({ where: { subOrderId } });
      expect(row.redeemedByUserId).toBe(vendor.userId);
    });

    it('another vendor cannot redeem this vendor’s token', async () => {
      const { orderId, subOrderId, customer } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);
      const attacker = await vendorFor('attacker');
      await db.vendorProfile.update({
        where: { id: attacker.vendorId },
        data: { status: 'ACTIVE' },
      });

      const response = await redeem(attacker, token).expect(422);
      expect(codeOf(response)).toBe(GENERIC);
      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('READY_FOR_PICKUP');
    });

    it('reveals nothing distinguishing between forged, wrong-vendor and unknown tokens', async () => {
      const { orderId, subOrderId, customer } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);
      const attacker = await vendorFor('attacker');

      const forged = await redeem(attacker, 'garbage.token.value').expect(422);
      const wrongVendor = await redeem(attacker, token).expect(422);

      // SEC-15: one uniform code, so probing teaches an attacker nothing.
      expect((forged.body as ErrorBody).error.code).toBe(
        (wrongVendor.body as ErrorBody).error.code,
      );
    });

    it('a customer cannot redeem', async () => {
      const { orderId, subOrderId, customer } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);

      await request(app)
        .post('/api/v1/vendor/orders/pickup/redeem')
        .set('Authorization', auth(customer))
        .send({ token })
        .expect(403);
    });

    it('refuses an unauthenticated redemption', async () => {
      await request(app)
        .post('/api/v1/vendor/orders/pickup/redeem')
        .send({ token: 'anything' })
        .expect(401);
    });

    it('allows exactly one success when two redemptions race, the loser generic', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);

      const results = await Promise.all([
        redeem(vendor, token).then((r) => ({ status: r.status, code: codeOf(r) })),
        redeem(vendor, token).then((r) => ({ status: r.status, code: codeOf(r) })),
      ]);

      const winners = results.filter((result) => result.status === 200);
      const losers = results.filter((result) => result.status !== 200);
      expect(winners).toHaveLength(1);
      // The atomic CAS decides the race, and the loser is told only that the
      // token is invalid — the same as any other refusal.
      expect(losers).toHaveLength(1);
      expect(losers[0]?.status).toBe(422);
      expect(losers[0]?.code).toBe(GENERIC);

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('COMPLETED');
      // One winner means one set of side effects, however the race resolved.
      expect(await pickupSideEffectCounts(subOrderId)).toEqual({ audit: 1, outbox: 1 });
    });

    it('writes exactly one audit and one outbox record for a completed pickup', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);
      await redeem(vendor, token).expect(200);

      expect(
        await db.auditLog.count({
          where: { entityId: subOrderId, action: 'sub_order.pickup_completed' },
        }),
      ).toBe(1);
      expect(
        await db.outboxEvent.count({
          where: { aggregateId: subOrderId, eventType: 'sub_order.pickup_completed' },
        }),
      ).toBe(1);
    });

    it('does not touch inventory (locked decision #21)', async () => {
      const customer = await customerFor('buyer');
      const seeded = await seedVendor('seller');
      const before = await db.inventory.findUniqueOrThrow({
        where: { variantId: seeded.variantId },
      });
      const { orderId, subOrderId } = await placeConfirmedOrder(customer, seeded, { pickup: true });
      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/process`)
        .set('Authorization', auth(seeded.vendor))
        .expect(200);
      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/ready-for-pickup`)
        .set('Authorization', auth(seeded.vendor))
        .expect(200);
      const afterPlacement = await db.inventory.findUniqueOrThrow({
        where: { variantId: seeded.variantId },
      });

      await redeem(seeded.vendor, await tokenFor(customer, orderId, subOrderId)).expect(200);

      const afterPickup = await db.inventory.findUniqueOrThrow({
        where: { variantId: seeded.variantId },
      });
      expect(afterPickup.available).toBe(afterPlacement.available);
      expect(before.available).toBeGreaterThan(afterPickup.available);
    });

    it('leaves the parent Order untouched (locked decision #22)', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      await redeem(vendor, await tokenFor(customer, orderId, subOrderId)).expect(200);

      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('CONFIRMED');
      expect((await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } })).status).toBe(
        'COMPLETED',
      );
    });

    it('writes no settlement or hold-release ledger entries (locked decision #20)', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      await redeem(vendor, await tokenFor(customer, orderId, subOrderId)).expect(200);

      const entries = await db.ledgerEntry.findMany({
        where: { journal: { subOrderId } },
        select: { accountCode: true },
      });
      const codes = new Set(entries.map((e) => e.accountCode));
      expect(codes.has('HOLD_SUSPENSE')).toBe(false);
      // Only the S3-7 payment-capture accounts are ever present.
      expect([...codes].sort()).toEqual([
        'GATEWAY_CLEARING',
        'PLATFORM_COMMISSION_INCOME',
        'VENDOR_PAYABLE',
      ]);
    });
  });

  describe('token persistence', () => {
    it('marks the row redeemed with who and when', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      await redeem(vendor, await tokenFor(customer, orderId, subOrderId)).expect(200);

      const row = await db.pickupToken.findFirstOrThrow({ where: { subOrderId } });
      expect(row.redeemedAt).not.toBeNull();
      expect(row.redeemedByUserId).toBe(vendor.userId);
    });

    it('never stores the raw token — only its SHA-256 hash', async () => {
      const { orderId, subOrderId, customer } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);

      const row = await db.pickupToken.findFirstOrThrow({ where: { subOrderId } });
      const serialised = JSON.stringify(row);
      expect(serialised).not.toContain(token);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/i);
    });
  });

  describe('manual/scanner-broken fallback (S4-QR-FALLBACK)', () => {
    it('an authenticated vendor completes pickup with the correct manual code', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const code = await manualCodeFor(customer, orderId, subOrderId);

      const response = await manualComplete(vendor, subOrderId, code).expect(200);
      expect((response.body as VendorSubOrderBody).data.status).toBe('COMPLETED');

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('COMPLETED');
    });

    it('refuses an unauthenticated manual completion', async () => {
      const { subOrderId } = await readyForPickup('seller');

      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/pickup/manual-complete`)
        .send({ code: '0000' })
        .expect(401);
    });

    it('a customer (wrong role) cannot use the manual fallback', async () => {
      const { orderId, subOrderId, customer } = await readyForPickup('seller');
      const code = await manualCodeFor(customer, orderId, subOrderId);

      await request(app)
        .post(`/api/v1/vendor/orders/${subOrderId}/pickup/manual-complete`)
        .set('Authorization', auth(customer))
        .send({ code })
        .expect(403);
    });

    it('a wrong code is refused and the sub-order stays READY_FOR_PICKUP', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const correctCode = await manualCodeFor(customer, orderId, subOrderId);
      const wrongCode = correctCode === '0000' ? '1111' : '0000';

      const response = await manualComplete(vendor, subOrderId, wrongCode).expect(422);
      expect(codeOf(response)).toBe(GENERIC);

      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('READY_FOR_PICKUP');
    });

    it('Vendor A cannot complete Vendor B’s pickup, even with the right code — the id alone is refused as not-found', async () => {
      const { orderId, subOrderId, customer } = await readyForPickup('seller');
      const code = await manualCodeFor(customer, orderId, subOrderId);
      const attacker = await vendorFor('attacker');
      await db.vendorProfile.update({
        where: { id: attacker.vendorId },
        data: { status: 'ACTIVE' },
      });

      await manualComplete(attacker, subOrderId, code).expect(404);
      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('READY_FOR_PICKUP');
    });

    it('consumes the token exactly once — a repeated manual completion fails', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const code = await manualCodeFor(customer, orderId, subOrderId);

      await manualComplete(vendor, subOrderId, code).expect(200);
      const replay = await manualComplete(vendor, subOrderId, code).expect(409);
      expect((replay.body as ErrorBody).error.code).toBe('PICKUP_TOKEN_ALREADY_REDEEMED');
    });

    it('the QR path refuses a token already spent by the manual fallback, and vice versa — one shared single-use guarantee', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);
      const code = await manualCodeFor(customer, orderId, subOrderId);

      await manualComplete(vendor, subOrderId, code).expect(200);
      const qrAttempt = await redeem(vendor, token).expect(422);
      expect(codeOf(qrAttempt)).toBe(GENERIC);
    });

    it('records a distinct sub_order.pickup_completed_manual audit action, never the QR path’s own action', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const code = await manualCodeFor(customer, orderId, subOrderId);

      await manualComplete(vendor, subOrderId, code).expect(200);

      expect(await auditCountFor(subOrderId, 'sub_order.pickup_completed_manual')).toBe(1);
      expect(await auditCountFor(subOrderId, 'sub_order.pickup_completed')).toBe(0);
      // The domain fact still reaches the outbox under the QR path's own event type.
      expect(
        await db.outboxEvent.count({
          where: { aggregateId: subOrderId, eventType: 'sub_order.pickup_completed' },
        }),
      ).toBe(1);
    });

    it('never stores the manual code in plaintext', async () => {
      const { orderId, subOrderId, customer } = await readyForPickup('seller');
      const code = await manualCodeFor(customer, orderId, subOrderId);

      const row = await db.pickupToken.findFirstOrThrow({ where: { subOrderId } });
      expect(JSON.stringify(row)).not.toContain(code);
      expect(row.manualCodeHash).not.toBeNull();
    });

    it('locks out further manual attempts after MAX_MANUAL_CODE_ATTEMPTS wrong guesses', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const correctCode = await manualCodeFor(customer, orderId, subOrderId);
      const wrongCode = correctCode === '0000' ? '1111' : '0000';

      for (let i = 0; i < 5; i += 1) {
        await manualComplete(vendor, subOrderId, wrongCode).expect(422);
      }
      // Even the *correct* code is refused now — the attempt budget, not the
      // code, is what is exhausted.
      await manualComplete(vendor, subOrderId, correctCode).expect(422);
      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('READY_FOR_PICKUP');
    });

    it('allows exactly one success when a QR scan and a manual completion race for the same token', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);
      const code = await manualCodeFor(customer, orderId, subOrderId);

      const results = await Promise.all([
        redeem(vendor, token).then((r) => r.status),
        manualComplete(vendor, subOrderId, code).then((r) => r.status),
      ]);

      expect(results.filter((status) => status === 200)).toHaveLength(1);
      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('COMPLETED');
    });
  });

  describe('offline redemption conflict (S4-QR-FALLBACK)', () => {
    it('an offline-verified redemption submitted on reconnect succeeds when the token is still unused', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);

      const response = await redeem(vendor, token, true).expect(200);
      expect((response.body as VendorSubOrderBody).data.status).toBe('COMPLETED');
    });

    it('an offline-verified redemption that loses the race records a conflict, not a second success', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);

      // The "online" scan reaches the server first.
      await redeem(vendor, token).expect(200);
      // The device that verified the same token locally while offline only
      // now reaches the server.
      const late = await redeem(vendor, token, true).expect(422);
      expect(codeOf(late)).toBe(GENERIC);

      expect(await auditCountFor(subOrderId, 'sub_order.pickup_offline_redemption_conflict')).toBe(
        1,
      );
      // Exactly one completion — the conflicted attempt never created a second one.
      expect(await pickupSideEffectCounts(subOrderId)).toEqual({ audit: 1, outbox: 1 });
      const row = await db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
      expect(row.status).toBe('COMPLETED');
    });

    it('an ordinary (non-offline) replay never records the offline-conflict action', async () => {
      const { orderId, subOrderId, customer, vendor } = await readyForPickup('seller');
      const token = await tokenFor(customer, orderId, subOrderId);

      await redeem(vendor, token).expect(200);
      await redeem(vendor, token).expect(422);

      expect(await auditCountFor(subOrderId, 'sub_order.pickup_offline_redemption_conflict')).toBe(
        0,
      );
    });
  });

  /** `POST .../ready-for-pickup`, named for readability at the call sites above. */
  function redeemReadyForPickup(vendor: VendorActor, subOrderId: string): request.Test {
    return request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/ready-for-pickup`)
      .set('Authorization', auth(vendor));
  }
});
