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

const EMAIL_PREFIX = 'vendor-earnings-';

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
interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}
interface EarningsLineBody {
  readonly subOrderId: string;
  readonly orderId: string;
  readonly grossAmount: MoneyBody;
  readonly commissionAmount: MoneyBody;
  readonly netAmount: MoneyBody;
}
/** `net === gross - commission` for one statement line — pulled out purely to keep its caller under this file's complexity budget. */
const netMatches = (line: EarningsLineBody | undefined): boolean =>
  line !== undefined &&
  BigInt(line.netAmount.amount) ===
    BigInt(line.grossAmount.amount) - BigInt(line.commissionAmount.amount);

interface EarningsBody {
  readonly data: {
    readonly summary: {
      readonly vendorId: string;
      readonly grossAccrued: MoneyBody;
      readonly commission: MoneyBody;
      readonly netAccrued: MoneyBody;
    };
    readonly lines: readonly EarningsLineBody[];
  };
  readonly meta: { readonly pagination: { readonly nextCursor: string | null; hasMore: boolean } };
}

/**
 * The vendor earnings statement (S3-8) against real PostgreSQL/HTTP — a
 * read-only ledger consumer sitting on top of S3-7's double-entry ledger.
 * Every ledger row this suite creates comes from a real `PlaceOrderUseCase`
 * -> `ConfirmPaymentUseCase` journey through the HTTP surface, exactly like
 * `vendor-order.test.ts`'s own `placeConfirmedOrder`, so the summary/lines
 * this suite asserts on are proven against ledger rows the application
 * itself posted, not fixtures seeded directly into the database.
 */
describe('vendor earnings (S3-8)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let categoryId: string;
  const postedSubOrderIds: string[] = [];

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

  /** ACTIVE vendor, APPROVED product with stock — mirrors `vendor-order.test.ts`'s own helper. */
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
        name: `Vendor Earnings Product ${randomUUID()}`,
        variant: {
          sku: `VENDOR-EARNINGS-${randomUUID()}`,
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

  /** Cart -> address -> place -> pay SUCCEEDED, ending CONFIRMED — the same shared starting point `vendor-order.test.ts` uses, which is what actually posts the S3-7 ledger journals this suite reads. */
  const placeConfirmedOrder = async (
    customer: Actor,
    vendorLabel: string,
    priceMinor = '19900',
  ): Promise<{ orderId: string; subOrderId: string; vendor: VendorActor }> => {
    const { vendor, variantId } = await seedActiveVendorWithStock(vendorLabel, { priceMinor });
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
    postedSubOrderIds.push(subOrderRow.id);
    return { orderId, subOrderId: subOrderRow.id, vendor };
  };

  /** Independent of `PrismaVendorEarningsQuery` — sums the raw ledger rows directly, so a bug shared between the query class and this assertion cannot hide. */
  const expectedGrossAndCommission = async (
    vendorId: string,
  ): Promise<{ grossMinor: bigint; commissionMinor: bigint }> => {
    const grossRows = await db.ledgerEntry.findMany({
      where: {
        accountCode: 'VENDOR_PAYABLE',
        direction: 'CREDIT',
        journal: { vendorId, kind: 'PAYMENT_CAPTURED' },
      },
      select: { amountMinor: true },
    });
    const commissionRows = await db.ledgerEntry.findMany({
      where: {
        accountCode: 'PLATFORM_COMMISSION_INCOME',
        direction: 'CREDIT',
        journal: { vendorId, kind: 'COMMISSION_ACCRUED' },
      },
      select: { amountMinor: true },
    });
    return {
      grossMinor: grossRows.reduce((sum, row) => sum + row.amountMinor, 0n),
      commissionMinor: commissionRows.reduce((sum, row) => sum + row.amountMinor, 0n),
    };
  };

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    const slug = `vendor-earnings-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;
  }, 60_000);

  afterAll(async () => {
    // The ledger is append-only (S3-7): its own triggers refuse DELETE, so
    // teardown must disable them first, exactly like `ledger.test.ts`'s own
    // `afterAll` — scoped to exactly the sub-order ids this suite posted.
    await db.$executeRawUnsafe(
      'ALTER TABLE "ledger_entries" DISABLE TRIGGER "trg_ledger_entries_immutable"',
    );
    await db.$executeRawUnsafe(
      'ALTER TABLE "ledger_journals" DISABLE TRIGGER "trg_ledger_journals_immutable"',
    );
    await db.ledgerEntry.deleteMany({
      where: { journal: { subOrderId: { in: postedSubOrderIds } } },
    });
    await db.ledgerJournal.deleteMany({ where: { subOrderId: { in: postedSubOrderIds } } });
    await db.$executeRawUnsafe(
      'ALTER TABLE "ledger_entries" ENABLE TRIGGER "trg_ledger_entries_immutable"',
    );
    await db.$executeRawUnsafe(
      'ALTER TABLE "ledger_journals" ENABLE TRIGGER "trg_ledger_journals_immutable"',
    );

    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(
      `DELETE FROM categories WHERE slug LIKE $1`,
      'vendor-earnings-cat-%',
    );
    await db.$disconnect();
  });

  describe('GET /api/v1/vendor/earnings', () => {
    it('401s without a token', async () => {
      await request(app).get('/api/v1/vendor/earnings').expect(401);
    });

    it('403s a customer — VIEW_VENDOR_EARNINGS is not granted to that role', async () => {
      const customer = await customerFor('permission-customer');

      const response = await request(app)
        .get('/api/v1/vendor/earnings')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('422s VENDOR_NOT_ACTIVE for a vendor who has not been activated', async () => {
      const inactiveVendor = await vendorFor('inactive-vendor');

      const response = await request(app)
        .get('/api/v1/vendor/earnings')
        .set('Authorization', auth(inactiveVendor))
        .expect(422);

      expect((response.body as ErrorBody).error.code).toBe('VENDOR_NOT_ACTIVE');
    });

    it('returns a zero summary and an empty statement for a vendor with no ledger activity', async () => {
      // ACTIVE via seedActiveVendorWithStock, but no order is ever placed.
      const { vendor } = await seedActiveVendorWithStock('empty-vendor');

      const response = await request(app)
        .get('/api/v1/vendor/earnings')
        .set('Authorization', auth(vendor))
        .expect(200);
      const body = (response.body as EarningsBody).data;

      expect(body.summary.grossAccrued).toEqual({ amount: '0', currency: 'INR' });
      expect(body.summary.commission).toEqual({ amount: '0', currency: 'INR' });
      expect(body.summary.netAccrued).toEqual({ amount: '0', currency: 'INR' });
      expect(body.lines).toEqual([]);
    });

    it('reports gross/commission/net matching the real ledger rows a confirmed order posted', async () => {
      const customer = await customerFor('shared-customer');
      const { orderId, subOrderId, vendor } = await placeConfirmedOrder(
        customer,
        'single-order-owner',
      );

      const expected = await expectedGrossAndCommission(vendor.vendorId);
      const response = await request(app)
        .get('/api/v1/vendor/earnings')
        .set('Authorization', auth(vendor))
        .expect(200);
      const body = (response.body as EarningsBody).data;
      const line = body.lines[0];

      expect(body.summary.grossAccrued.amount).toBe(expected.grossMinor.toString());
      expect(body.summary.commission.amount).toBe(expected.commissionMinor.toString());
      expect(body.summary.netAccrued.amount).toBe(
        (expected.grossMinor - expected.commissionMinor).toString(),
      );
      expect(body.summary.grossAccrued.currency).toBe('INR');

      expect(body.lines).toHaveLength(1);
      expect(line?.subOrderId).toBe(subOrderId);
      expect(line?.orderId).toBe(orderId);
      expect(line?.grossAmount.amount).toBe(expected.grossMinor.toString());
      expect(line?.commissionAmount.amount).toBe(expected.commissionMinor.toString());
      expect(netMatches(line)).toBe(true);
    });

    it('sums two sub-orders for the same vendor into one summary and lists both lines', async () => {
      const customer = await customerFor('multi-order-customer');
      const first = await placeConfirmedOrder(customer, 'multi-order-owner', '10000');
      const second = await placeConfirmedOrder(customer, 'multi-order-owner', '25000');
      expect(first.vendor.vendorId).toBe(second.vendor.vendorId);

      const expected = await expectedGrossAndCommission(first.vendor.vendorId);
      const response = await request(app)
        .get('/api/v1/vendor/earnings')
        .set('Authorization', auth(first.vendor))
        .expect(200);
      const body = (response.body as EarningsBody).data;

      expect(body.summary.grossAccrued.amount).toBe(expected.grossMinor.toString());
      expect(body.summary.commission.amount).toBe(expected.commissionMinor.toString());
      const subOrderIds = body.lines.map((line) => line.subOrderId);
      expect(subOrderIds).toContain(first.subOrderId);
      expect(subOrderIds).toContain(second.subOrderId);
    });

    it('paginates the statement — two pages of one line each cover both sub-orders with no duplicates', async () => {
      const customer = await customerFor('paged-customer');
      const first = await placeConfirmedOrder(customer, 'paged-owner', '10000');
      const second = await placeConfirmedOrder(customer, 'paged-owner', '15000');

      const page1Response = await request(app)
        .get('/api/v1/vendor/earnings?limit=1')
        .set('Authorization', auth(first.vendor))
        .expect(200);
      const page1 = page1Response.body as EarningsBody;
      expect(page1.data.lines).toHaveLength(1);
      expect(page1.meta.pagination.hasMore).toBe(true);
      expect(page1.meta.pagination.nextCursor).not.toBeNull();

      const page2Response = await request(app)
        .get(`/api/v1/vendor/earnings?limit=1&cursor=${page1.meta.pagination.nextCursor}`)
        .set('Authorization', auth(first.vendor))
        .expect(200);
      const page2 = page2Response.body as EarningsBody;
      expect(page2.data.lines).toHaveLength(1);
      expect(page2.meta.pagination.hasMore).toBe(false);

      const seenSubOrderIds = [...page1.data.lines, ...page2.data.lines].map(
        (line) => line.subOrderId,
      );
      expect(new Set(seenSubOrderIds).size).toBe(2);
      expect(seenSubOrderIds).toContain(first.subOrderId);
      expect(seenSubOrderIds).toContain(second.subOrderId);
    });

    it('never returns another vendor’s earnings — cross-vendor isolation', async () => {
      const customerA = await customerFor('isolation-customer-a');
      const customerB = await customerFor('isolation-customer-b');
      const a = await placeConfirmedOrder(customerA, 'isolation-owner-a', '30000');
      const b = await placeConfirmedOrder(customerB, 'isolation-owner-b', '40000');
      expect(a.vendor.vendorId).not.toBe(b.vendor.vendorId);

      const responseA = await request(app)
        .get('/api/v1/vendor/earnings')
        .set('Authorization', auth(a.vendor))
        .expect(200);
      const bodyA = (responseA.body as EarningsBody).data;

      expect(bodyA.summary.vendorId).toBe(a.vendor.vendorId);
      expect(bodyA.lines.some((line) => line.subOrderId === b.subOrderId)).toBe(false);

      const responseB = await request(app)
        .get('/api/v1/vendor/earnings')
        .set('Authorization', auth(b.vendor))
        .expect(200);
      const bodyB = (responseB.body as EarningsBody).data;

      expect(bodyB.summary.vendorId).toBe(b.vendor.vendorId);
      expect(bodyB.lines.some((line) => line.subOrderId === a.subOrderId)).toBe(false);
    });

    it('has no POST/PUT/PATCH/DELETE route — the surface is read-only', async () => {
      const vendor = await vendorFor('mutation-probe-vendor');

      await request(app)
        .post('/api/v1/vendor/earnings')
        .set('Authorization', auth(vendor))
        .expect(404);
      await request(app)
        .patch('/api/v1/vendor/earnings')
        .set('Authorization', auth(vendor))
        .expect(404);
      await request(app)
        .delete('/api/v1/vendor/earnings')
        .set('Authorization', auth(vendor))
        .expect(404);
    });
  });
});
