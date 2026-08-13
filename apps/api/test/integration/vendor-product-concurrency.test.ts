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
import { signUpVendorOwner, type VendorActor } from '../support/actors.js';

const EMAIL_PREFIX = 'vendor-product-conc-';

interface CreateBody {
  readonly data: { product: { id: string }; variant: { id: string } };
}
interface VariantBody {
  readonly data: { id: string };
}

/** The status of every settled request, so a race can be asserted on exactly. */
const statusesOf = (results: PromiseSettledResult<request.Response>[]): number[] =>
  results
    .map((result) => (result.status === 'fulfilled' ? result.value.status : 0))
    .sort((a, b) => a - b);

/**
 * The two races S2-3b has to survive, against real PostgreSQL.
 *
 * Both are the kind of bug a single-threaded test can never see and a mocked
 * database cannot have: they depend on two transactions interleaving on the
 * same rows. Nothing here is skipped for being awkward — these are the tests
 * that decide whether the invariants are real.
 */
describe('vendor product concurrency', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let vendor: VendorActor;
  let categoryId: string;

  let seq = 0;
  const productsPath = '/api/v1/vendor/products';
  const auth = (): string => `Bearer ${vendor.token}`;

  const seedProduct = async (): Promise<{ productId: string; variantId: string }> => {
    const response = await request(app)
      .post(productsPath)
      .set('Authorization', auth())
      .send({
        categoryId,
        name: `Concurrent ${(seq += 1)}`,
        variant: {
          sku: `CONC-${Date.now()}-${(seq += 1)}`,
          name: 'Default',
          price: { amount: '10000', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
      })
      .expect(201);
    const { data } = response.body as CreateBody;
    return { productId: data.product.id, variantId: data.variant.id };
  };

  const addVariant = async (productId: string): Promise<string> => {
    const response = await request(app)
      .post(`${productsPath}/${productId}/variants`)
      .set('Authorization', auth())
      .send({
        sku: `CONC-${Date.now()}-${(seq += 1)}`,
        name: 'Extra',
        price: { amount: '20000', currency: 'INR' },
        unitOfMeasure: 'per piece',
        quantityStep: 1,
      })
      .expect(201);
    return (response.body as VariantBody).data.id;
  };

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    vendor = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor');
    const slug = `vendor-product-conc-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;
  }, 60_000);

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(
      `DELETE FROM categories WHERE slug LIKE $1`,
      'vendor-product-conc-cat-%',
    );
    await db.$disconnect();
  });

  describe('duplicate SKU', () => {
    it('lets exactly one of two simultaneous creates win, and answers the other with 409', async () => {
      const sku = `CONC-RACE-${Date.now()}`;
      const body = (name: string): Record<string, unknown> => ({
        categoryId,
        name,
        variant: {
          sku,
          name: 'Default',
          price: { amount: '10000', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
      });

      const results = await Promise.allSettled([
        request(app).post(productsPath).set('Authorization', auth()).send(body('Race A')),
        request(app).post(productsPath).set('Authorization', auth()).send(body('Race B')),
      ]);

      // `uq_product_variants_vendor_sku` is the arbiter — never a
      // read-then-write check, which both callers would have passed.
      expect(statusesOf(results)).toEqual([201, 409]);
      expect(await db.productVariant.count({ where: { sku, vendorId: vendor.vendorId } })).toBe(1);
    });

    it('lets exactly one of two simultaneous variant additions win', async () => {
      const { productId } = await seedProduct();
      const sku = `CONC-ADD-${Date.now()}`;
      const body = {
        sku,
        name: 'Extra',
        price: { amount: '20000', currency: 'INR' },
        unitOfMeasure: 'per piece',
        quantityStep: 1,
      };

      const results = await Promise.allSettled([
        request(app)
          .post(`${productsPath}/${productId}/variants`)
          .set('Authorization', auth())
          .send(body),
        request(app)
          .post(`${productsPath}/${productId}/variants`)
          .set('Authorization', auth())
          .send(body),
      ]);

      expect(statusesOf(results)).toEqual([201, 409]);
      expect(await db.productVariant.count({ where: { sku, vendorId: vendor.vendorId } })).toBe(1);
    });
  });

  describe('the last live variant', () => {
    it('never lets two simultaneous deletes empty a two-variant product', async () => {
      const { productId, variantId } = await seedProduct();
      const secondId = await addVariant(productId);

      // The classic interleaving: both transactions count two live variants,
      // both delete, and the product is left with none. The parent-row lock in
      // `lockForVariantChange` is what serialises them so the second sees the
      // first's committed result.
      const results = await Promise.allSettled([
        request(app)
          .delete(`${productsPath}/${productId}/variants/${variantId}`)
          .set('Authorization', auth()),
        request(app)
          .delete(`${productsPath}/${productId}/variants/${secondId}`)
          .set('Authorization', auth()),
      ]);

      expect(statusesOf(results)).toEqual([200, 409]);
      expect(await db.productVariant.count({ where: { productId, deletedAt: null } })).toBe(1);
    });

    it('keeps the invariant across three simultaneous deletes of a three-variant product', async () => {
      const { productId, variantId } = await seedProduct();
      const second = await addVariant(productId);
      const third = await addVariant(productId);

      const results = await Promise.allSettled(
        [variantId, second, third].map((id) =>
          request(app)
            .delete(`${productsPath}/${productId}/variants/${id}`)
            .set('Authorization', auth()),
        ),
      );

      // Two may go; the third must be refused. Whichever loses, one survives.
      expect(statusesOf(results)).toEqual([200, 200, 409]);
      expect(await db.productVariant.count({ where: { productId, deletedAt: null } })).toBe(1);
    });

    it('never drops below one when an addition and a last-variant deletion race', async () => {
      const { productId, variantId } = await seedProduct();

      const results = await Promise.allSettled([
        request(app)
          .delete(`${productsPath}/${productId}/variants/${variantId}`)
          .set('Authorization', auth()),
        request(app)
          .post(`${productsPath}/${productId}/variants`)
          .set('Authorization', auth())
          .send({
            sku: `CONC-MIX-${Date.now()}`,
            name: 'Extra',
            price: { amount: '20000', currency: 'INR' },
            unitOfMeasure: 'per piece',
            quantityStep: 1,
          }),
      ]);

      // The add always succeeds. The delete succeeds only if it was ordered
      // after it — either way the product is never left empty, which is the
      // only thing the invariant actually promises.
      const live = await db.productVariant.count({ where: { productId, deletedAt: null } });
      expect(live).toBeGreaterThanOrEqual(1);
      expect(statusesOf(results)).toContain(201);
    });

    it('always leaves the product itself reachable after the races', async () => {
      const { productId, variantId } = await seedProduct();
      const secondId = await addVariant(productId);

      await Promise.allSettled([
        request(app)
          .delete(`${productsPath}/${productId}/variants/${variantId}`)
          .set('Authorization', auth()),
        request(app)
          .delete(`${productsPath}/${productId}/variants/${secondId}`)
          .set('Authorization', auth()),
      ]);

      await request(app)
        .get(`${productsPath}/${productId}`)
        .set('Authorization', auth())
        .expect(200);
      const listed = await request(app)
        .get(`${productsPath}/${productId}/variants`)
        .set('Authorization', auth())
        .expect(200);
      expect((listed.body as { data: unknown[] }).data).toHaveLength(1);
    });
  });
});
