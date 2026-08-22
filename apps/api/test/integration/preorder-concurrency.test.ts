import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import { signUpCustomer, signUpVendorOwner, type VendorActor } from '../support/actors.js';
import { toAddressId } from '../../src/modules/customer/index.js';
import { PrismaAddressRepository } from '../../src/modules/customer/infrastructure/persistence/prisma-address.repository.js';
import { toUserId } from '../../src/modules/identity/index.js';
import { CreateReservationUseCase } from '../../src/modules/preorder/application/use-cases/create-reservation.use-case.js';
import { PrismaCampaignRepository } from '../../src/modules/preorder/infrastructure/persistence/prisma-campaign.repository.js';
import { PrismaReservationRepository } from '../../src/modules/preorder/infrastructure/persistence/prisma-reservation.repository.js';
import { RedisCampaignQuotaGate } from '../../src/modules/preorder/infrastructure/cache/redis-campaign-quota-gate.js';
import { PrismaProductVariantRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-variant.repository.js';
import { PrismaOutboxWriter } from '../../src/shared/infrastructure/persistence/prisma-outbox-writer.js';
import { CheckoutTransactionRunner } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { toCampaignId } from '../../src/modules/preorder/domain/value-objects/campaign-id.value-object.js';

const EMAIL_PREFIX = 'preorder-conc-';

interface CreateProductBody {
  readonly data: { product: { id: string } };
}
interface CreateCampaignBody {
  readonly data: { id: string };
}

const authed = (test: request.Test, actor: VendorActor): request.Test =>
  test.set('Authorization', `Bearer ${actor.token}`);

interface RaceCustomer {
  readonly customerId: string;
  readonly addressId: string;
}

/**
 * Every distinct customer fired at the campaign in one race. Real `User` and
 * `Address` rows, created directly (not through `/identity/register` or
 * `POST /me/addresses`) — the FKs on `preorder_reservations.customer_id`
 * (and `CreateReservationUseCase`'s own ownership-scoped address read) need
 * real rows to reference, but the race itself has nothing to do with
 * authentication, and minting hundreds of real sessions would risk the
 * registration rate limiter turning a concurrency failure into a
 * rate-limit failure instead. Deleting the `User` row cascades to its
 * `Address` (`ON DELETE CASCADE`), so cleanup needs to track only the
 * customer id.
 */
const seedRaceCustomers = async (
  db: PrismaClient,
  count: number,
  sink: string[],
): Promise<readonly RaceCustomer[]> => {
  const customers = Array.from({ length: count }, () => ({
    customerId: randomUUID(),
    addressId: randomUUID(),
  }));
  await db.user.createMany({ data: customers.map((c) => ({ id: c.customerId })) });
  await db.address.createMany({
    data: customers.map((c) => ({
      id: c.addressId,
      userId: c.customerId,
      recipientName: 'Concurrency Tester',
      phone: '+919876543210',
      line1: '221B Baker Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      label: 'Home',
    })),
  });
  sink.push(...customers.map((c) => c.customerId));
  return customers;
};

/**
 * Seeds one `APPROVED` product/variant and one `OPEN` campaign of the given
 * capacity, owned by a fresh vendor. `SCHEDULED -> OPEN` and the Redis
 * quota-gate's own `setRemaining` both have no HTTP path yet (the campaign
 * lifecycle sweep is a later milestone) — set directly, the same "no HTTP
 * path to this state" convention `route-manifest.ts`'s own `seedOpenCampaign`
 * already establishes.
 */
const seedOpenCampaign = async (
  ctx: { app: Express; db: PrismaClient },
  quotaGate: RedisCampaignQuotaGate,
  totalQuantity: number,
): Promise<{ campaignId: string; vendor: VendorActor }> => {
  const vendor = await signUpVendorOwner(ctx.app, EMAIL_PREFIX, `vendor-${randomUUID()}`);
  const slug = `preorder-conc-cat-${Date.now()}-${randomUUID()}`;
  const category = await ctx.db.category.create({
    data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
  });

  const productResponse = await authed(request(ctx.app).post('/api/v1/vendor/products'), vendor)
    .send({
      categoryId: category.id,
      name: `Concurrency Product ${randomUUID()}`,
      variant: {
        sku: `PREORDER-CONC-${Date.now()}-${randomUUID()}`,
        name: 'Default',
        price: { amount: '19900', currency: 'INR' },
        unitOfMeasure: 'per piece',
        quantityStep: 1,
      },
    })
    .expect(201);
  const productId = (productResponse.body as CreateProductBody).data.product.id;
  const variantRow = await ctx.db.productVariant.findFirstOrThrow({ where: { productId } });
  await ctx.db.product.update({ where: { id: productId }, data: { status: 'APPROVED' } });

  const now = Date.now();
  const campaignResponse = await authed(
    request(ctx.app).post('/api/v1/vendor/preorder-campaigns'),
    vendor,
  )
    .send({
      variantId: variantRow.id,
      opensAt: new Date(now - 60_000).toISOString(),
      orderCutoffAt: new Date(now + 7 * 86_400_000).toISOString(),
      fulfilmentWindowStart: new Date(now + 8 * 86_400_000).toISOString(),
      fulfilmentWindowEnd: new Date(now + 9 * 86_400_000).toISOString(),
      totalQuantity,
      advancePercent: 20,
      maxPerCustomer: 1,
      fulfilmentMode: 'DELIVERY',
    })
    .expect(201);
  const campaignId = (campaignResponse.body as CreateCampaignBody).data.id;

  await ctx.db.preorderCampaign.update({ where: { id: campaignId }, data: { status: 'OPEN' } });
  // Mirrors what the (not-yet-built) campaign lifecycle sweep's own
  // `SCHEDULED -> OPEN` transition will do: Layer 1's counter only exists
  // once something populates it. Without this the gate has no key at all
  // (`UNKNOWN`), which fails open — correct, but it would mean this test
  // exercises only Layer 2, not both layers together.
  await quotaGate.setRemaining(toCampaignId(campaignId), totalQuantity);

  return { campaignId, vendor };
};

/**
 * Fires `concurrentAttempts` simultaneous, distinct-customer reservation
 * attempts of `quantityPerAttempt` each against one `capacity`-unit campaign,
 * through the real `CreateReservationUseCase` — real Postgres, real Redis,
 * no mocked repository anywhere in the path. Returns the settled outcomes and
 * the post-race campaign row, for the caller to assert on.
 */
interface RunRaceOptions {
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly capacity: number;
  readonly concurrentAttempts: number;
  readonly quantityPerAttempt: number;
  readonly customerIdSink: string[];
}

const runRace = async (
  ctx: { app: Express; db: PrismaClient; useCase: CreateReservationUseCase },
  options: RunRaceOptions,
): Promise<{
  results: PromiseSettledResult<unknown>[];
  campaignId: string;
  campaignRow: { remainingQuantity: number; totalQuantity: number };
}> => {
  const { quotaGate, capacity, concurrentAttempts, quantityPerAttempt, customerIdSink } = options;
  const { campaignId } = await seedOpenCampaign(ctx, quotaGate, capacity);
  const customers = await seedRaceCustomers(ctx.db, concurrentAttempts, customerIdSink);

  const results = await Promise.allSettled(
    customers.map((customer) =>
      ctx.useCase.execute({
        customerId: toUserId(customer.customerId),
        campaignId: toCampaignId(campaignId),
        quantity: quantityPerAttempt,
        fulfilmentMode: 'DELIVERY',
        addressId: toAddressId(customer.addressId),
      }),
    ),
  );

  const campaignRow = await ctx.db.preorderCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { remainingQuantity: true, totalQuantity: true },
  });

  return { results, campaignId, campaignRow };
};

describe('preorder reservation concurrency (SDD §14.4)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let useCase: CreateReservationUseCase;
  let quotaGate: RedisCampaignQuotaGate;
  /** Every raw customer id created directly via `ctx.db.user.createMany` across this suite — `disposeIntegrationHarness` only knows accounts by email prefix, so these (created with no email) need their own explicit cleanup. */
  const rawCustomerIds: string[] = [];

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    const { prisma, checkoutPrisma, publicPrisma, redis, clock, idGenerator, logger } =
      harness.container;

    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);

    quotaGate = new RedisCampaignQuotaGate(redis);
    const campaignRepository = new PrismaCampaignRepository(checkoutPrisma);
    const reservationRepository = new PrismaReservationRepository(checkoutPrisma);
    const addressRepository = new PrismaAddressRepository(prisma);
    const productVariantRepository = new PrismaProductVariantRepository(publicPrisma);
    const transactionRunner = new CheckoutTransactionRunner(checkoutPrisma);
    const outboxWriter = new PrismaOutboxWriter(checkoutPrisma, idGenerator, clock);

    useCase = new CreateReservationUseCase({
      campaignRepository,
      reservationRepository,
      addressRepository,
      productVariantRepository,
      quotaGate,
      transactionRunner,
      outboxWriter,
      idGenerator,
      clock,
      logger,
      reservationTtlMs: 10 * 60 * 1000,
    });
  }, 60_000);

  beforeEach(async () => {
    const keys = await harness.container.redis.keys('rl:*');
    if (keys.length > 0) await harness.container.redis.del(...keys);
  });

  afterAll(async () => {
    // Order matters: `disposeIntegrationHarness` deletes every reservation
    // owned by these vendors' campaigns (including ones held by the raw
    // customer ids below, via the campaignId branch its own preorder
    // cleanup added) before either FK-RESTRICT'd table is touched — so the
    // raw `users` rows below are safe to delete only *after* it returns.
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    if (rawCustomerIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: rawCustomerIds } } });
    }
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, 'preorder-conc-cat-%');
    await db.$disconnect();
  });

  /**
   * The exact worked example from the implementation brief: capacity 10,
   * 100 concurrent attempts, 1 unit each. Expected: exactly 10 succeed, 90
   * are rejected, remaining quantity lands at 0, exactly 10 `PENDING`
   * reservations exist, and the invariant `0 <= remainingQuantity <=
   * totalQuantity` never breaks.
   */
  it('lets exactly 10 of 100 concurrent 1-unit attempts win against a 10-unit campaign', async () => {
    const { results, campaignId, campaignRow } = await runRace(
      { app, db, useCase },
      {
        quotaGate,
        capacity: 10,
        concurrentAttempts: 100,
        quantityPerAttempt: 1,
        customerIdSink: rawCustomerIds,
      },
    );

    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(succeeded).toHaveLength(10);
    expect(rejected).toHaveLength(90);

    expect(campaignRow.remainingQuantity).toBe(0);
    expect(campaignRow.remainingQuantity).toBeGreaterThanOrEqual(0);
    expect(campaignRow.remainingQuantity).toBeLessThanOrEqual(campaignRow.totalQuantity);

    const pendingCount = await db.preorderReservation.count({
      where: { campaignId, status: 'PENDING' },
    });
    expect(pendingCount).toBe(10);

    // No duplicate successful reservation per customer: 10 winners, 10
    // distinct customer ids, by construction of `seedCustomerIds` (each
    // fired exactly once) — asserted explicitly rather than assumed.
    const distinctCustomers = await db.preorderReservation.findMany({
      where: { campaignId, status: 'PENDING' },
      select: { customerId: true },
    });
    expect(new Set(distinctCustomers.map((row) => row.customerId)).size).toBe(10);
  }, 60_000);

  /**
   * The brief's own "run a heavier concurrency variant if practical" —
   * 25x the base scenario's concurrency, same 10x capacity-to-demand ratio.
   */
  it('holds the same invariant at 25x scale (25-unit campaign, 250 concurrent attempts)', async () => {
    const { results, campaignId, campaignRow } = await runRace(
      { app, db, useCase },
      {
        quotaGate,
        capacity: 25,
        concurrentAttempts: 250,
        quantityPerAttempt: 1,
        customerIdSink: rawCustomerIds,
      },
    );

    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(succeeded).toHaveLength(25);
    expect(rejected).toHaveLength(225);
    expect(campaignRow.remainingQuantity).toBe(0);

    const pendingCount = await db.preorderReservation.count({
      where: { campaignId, status: 'PENDING' },
    });
    expect(pendingCount).toBe(25);
  }, 90_000);

  /**
   * The Idempotency-Key middleware's own retry protection (reused, never a
   * second implementation — the implementation brief's own instruction),
   * exercised through the real HTTP route rather than the bare use case:
   * a completed request, replayed with the same key, must resolve to the
   * same reservation rather than creating a second one — the retry
   * `idempotency()`'s own doc comment names ("a network client that never
   * saw the first response"). A *concurrent* second attempt while the first
   * is still in flight is deliberately a 409 (`idempotency.ts`'s own
   * `IN_PROGRESS` conflict), not this test's concern — that race is
   * `idempotency.ts`'s own unit-level coverage, not preorder's.
   */
  it('never creates two reservations for one customer retrying the same Idempotency-Key', async () => {
    const { campaignId } = await seedOpenCampaign({ app, db }, quotaGate, 5);
    const customer = await signUpCustomer(app, EMAIL_PREFIX, `retry-customer-${randomUUID()}`);
    const addressResponse = await request(app)
      .post('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        recipientName: 'Retry Tester',
        phone: '+919876543210',
        line1: '221B Baker Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        label: 'Home',
      })
      .expect(201);
    const addressId = (addressResponse.body as { data: { id: string } }).data.id;
    const idempotencyKey = `retry-${randomUUID()}`;

    const first = await request(app)
      .post('/api/v1/preorder-reservations')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ campaignId, quantity: 1, fulfilmentMode: 'DELIVERY', addressId });
    const second = await request(app)
      .post('/api/v1/preorder-reservations')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ campaignId, quantity: 1, fulfilmentMode: 'DELIVERY', addressId });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = (first.body as { data: { id: string } }).data.id;
    const secondId = (second.body as { data: { id: string } }).data.id;
    expect(secondId).toBe(firstId);

    const count = await db.preorderReservation.count({ where: { campaignId } });
    expect(count).toBe(1);
  }, 30_000);
});
