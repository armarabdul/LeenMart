import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { CATALOGUE_AUDIT_ACTIONS } from '../../src/modules/catalogue/domain/audit-actions.js';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import { signUpCustomer, signUpVendorOwner, type VendorActor } from '../support/actors.js';

const EMAIL_PREFIX = 'vendor-inventory-';
const CATEGORY_PREFIX = 'vendor-inventory-cat-';

interface ErrorBody {
  readonly error: { code: string };
}
interface CreateBody {
  readonly data: { product: { id: string }; variant: { id: string } };
}
interface VariantBody {
  readonly data: { id: string };
}
interface InventoryData {
  variantId: string;
  available: number;
  reserved: number;
  version: number;
  updatedAt: string;
}
interface InventoryBody {
  readonly data: InventoryData;
}

/**
 * Per-variant stock (S2-4), end to end.
 *
 * Real authentication, real vendors, real PostgreSQL with RLS. Two vendors are
 * minted once for the file — `LOGIN_PER_IP` caps logins at 20/min — while what
 * is fresh per test is the product under test, which is what the isolation and
 * concurrency proofs actually need.
 */
describe('vendor inventory endpoints', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let vendorA: VendorActor;
  let vendorB: VendorActor;
  let categoryId: string;

  let seq = 0;
  const productsPath = '/api/v1/vendor/products';
  const auth = (actor: VendorActor): string => `Bearer ${actor.token}`;
  const inventoryPath = (productId: string, variantId: string): string =>
    `${productsPath}/${productId}/variants/${variantId}/inventory`;

  const seedProduct = async (
    actor: VendorActor = vendorA,
  ): Promise<{ productId: string; variantId: string }> => {
    const response = await request(app)
      .post(productsPath)
      .set('Authorization', auth(actor))
      .send({
        categoryId,
        name: `Stocked ${(seq += 1)}`,
        variant: {
          sku: `INV-${Date.now()}-${(seq += 1)}`,
          name: 'Default',
          price: { amount: '19900', currency: 'INR' },
          unitOfMeasure: 'per kg',
          quantityStep: 250,
        },
      })
      .expect(201);
    const { data } = response.body as CreateBody;
    return { productId: data.product.id, variantId: data.variant.id };
  };

  const readInventory = async (
    actor: VendorActor,
    productId: string,
    variantId: string,
  ): Promise<InventoryData> => {
    const response = await request(app)
      .get(inventoryPath(productId, variantId))
      .set('Authorization', auth(actor))
      .expect(200);
    return (response.body as InventoryBody).data;
  };

  const setStock = (
    actor: VendorActor,
    productId: string,
    variantId: string,
    body: Record<string, unknown>,
  ): request.Test =>
    request(app)
      .patch(inventoryPath(productId, variantId))
      .set('Authorization', auth(actor))
      .send(body);

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    vendorA = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor-a');
    vendorB = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor-b');
    const slug = `${CATEGORY_PREFIX}${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;
  }, 60_000);

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, `${CATEGORY_PREFIX}%`);
    await db.$disconnect();
  });

  describe('created with the variant (S2-4 D-E)', () => {
    it('gives a new product’s first variant a counter at zero, version 1', async () => {
      const { productId, variantId } = await seedProduct();

      const inventory = await readInventory(vendorA, productId, variantId);

      expect(inventory).toMatchObject({ variantId, available: 0, reserved: 0, version: 1 });
    });

    it('gives an added variant a counter too', async () => {
      const { productId } = await seedProduct();
      const added = await request(app)
        .post(`${productsPath}/${productId}/variants`)
        .set('Authorization', auth(vendorA))
        .send({
          sku: `INV-ADD-${Date.now()}-${(seq += 1)}`,
          name: 'Extra',
          price: { amount: '29900', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        })
        .expect(201);
      const addedId = (added.body as VariantBody).data.id;

      expect(await readInventory(vendorA, productId, addedId)).toMatchObject({
        available: 0,
        version: 1,
      });
    });

    it('leaves no variant without one', async () => {
      const { productId } = await seedProduct();

      const variants = await db.productVariant.findMany({ where: { productId } });
      const counters = await db.inventory.findMany({
        where: { variantId: { in: variants.map((v) => v.id) } },
      });

      expect(counters).toHaveLength(variants.length);
    });
  });

  describe('setting stock', () => {
    it('sets an absolute figure and advances the version', async () => {
      const { productId, variantId } = await seedProduct();

      const response = await setStock(vendorA, productId, variantId, {
        available: 50,
        version: 1,
      }).expect(200);

      expect((response.body as InventoryBody).data).toMatchObject({ available: 50, version: 2 });
    });

    it('accepts zero — how a vendor marks something out of stock', async () => {
      const { productId, variantId } = await seedProduct();
      await setStock(vendorA, productId, variantId, { available: 10, version: 1 }).expect(200);

      const response = await setStock(vendorA, productId, variantId, {
        available: 0,
        version: 2,
      }).expect(200);

      expect((response.body as InventoryBody).data.available).toBe(0);
    });

    it('never moves reserved', async () => {
      const { productId, variantId } = await seedProduct();

      await setStock(vendorA, productId, variantId, { available: 99, version: 1 }).expect(200);

      const row = await db.inventory.findUniqueOrThrow({ where: { variantId } });
      expect(row.reserved).toBe(0);
    });

    it('refuses a stale version with 409 and changes nothing', async () => {
      const { productId, variantId } = await seedProduct();
      await setStock(vendorA, productId, variantId, { available: 50, version: 1 }).expect(200);

      const response = await setStock(vendorA, productId, variantId, {
        available: 999,
        version: 1,
      }).expect(409);

      expect((response.body as ErrorBody).error.code).toBe('INVENTORY_VERSION_CONFLICT');
      const row = await db.inventory.findUniqueOrThrow({ where: { variantId } });
      expect(row.available).toBe(50);
    });

    it.each([
      ['a negative figure', { available: -1, version: 1 }],
      ['a fractional figure', { available: 1.5, version: 1 }],
      ['a missing version', { available: 5 }],
      ['a missing figure', { version: 1 }],
      ['a zero version', { available: 5, version: 0 }],
      ['an unexpected field', { available: 5, version: 1, reserved: 3 }],
      ['a variantId in the body', { available: 5, version: 1, variantId: randomUUID() }],
    ])('returns 400 for %s', async (_label, body) => {
      const { productId, variantId } = await seedProduct();

      await setStock(vendorA, productId, variantId, body).expect(400);
    });

    it('returns 404 for an unknown variant', async () => {
      const { productId } = await seedProduct();

      const response = await setStock(vendorA, productId, randomUUID(), {
        available: 5,
        version: 1,
      }).expect(404);

      expect((response.body as ErrorBody).error.code).toBe('INVENTORY_NOT_FOUND');
    });

    it('returns 404 for a real variant addressed under the wrong product', async () => {
      const first = await seedProduct();
      const second = await seedProduct();

      await setStock(vendorA, second.productId, first.variantId, {
        available: 5,
        version: 1,
      }).expect(404);
    });

    it('records the change against the product', async () => {
      const { productId, variantId } = await seedProduct();

      await setStock(vendorA, productId, variantId, { available: 7, version: 1 }).expect(200);

      const actions = (
        await db.auditLog.findMany({
          where: { entityId: productId, entityType: 'Product' },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => row.action);

      expect(actions).toEqual([
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_CREATED,
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_INVENTORY_UPDATED,
      ]);
    });

    it('records nothing for a read', async () => {
      const { productId, variantId } = await seedProduct();

      await readInventory(vendorA, productId, variantId);

      const rows = await db.auditLog.findMany({
        where: { entityId: productId, entityType: 'Product' },
      });
      expect(rows).toHaveLength(1);
    });

    it('never exposes vendorId or createdAt', async () => {
      const { productId, variantId } = await seedProduct();

      const response = await request(app)
        .get(inventoryPath(productId, variantId))
        .set('Authorization', auth(vendorA))
        .expect(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain(vendorA.vendorId);
      expect(body).not.toContain('createdAt');
    });
  });

  describe('removed with the variant', () => {
    it('goes when its variant is removed', async () => {
      const { productId, variantId } = await seedProduct();
      const added = await request(app)
        .post(`${productsPath}/${productId}/variants`)
        .set('Authorization', auth(vendorA))
        .send({
          sku: `INV-DEL-${Date.now()}-${(seq += 1)}`,
          name: 'Extra',
          price: { amount: '10000', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        })
        .expect(201);
      const addedId = (added.body as VariantBody).data.id;

      await request(app)
        .delete(`${productsPath}/${productId}/variants/${addedId}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      // Genuinely gone, not soft-deleted: a counter has no lifecycle of its own.
      expect(await db.inventory.findUnique({ where: { variantId: addedId } })).toBeNull();
      expect(await db.inventory.findUnique({ where: { variantId } })).not.toBeNull();
    });

    it('leaves the counter alone when a last-variant removal is refused', async () => {
      const { productId, variantId } = await seedProduct();

      await request(app)
        .delete(`${productsPath}/${productId}/variants/${variantId}`)
        .set('Authorization', auth(vendorA))
        .expect(409);

      expect(await db.inventory.findUnique({ where: { variantId } })).not.toBeNull();
    });

    it('goes when the whole product is deleted', async () => {
      const { productId, variantId } = await seedProduct();

      await request(app)
        .delete(`${productsPath}/${productId}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      expect(await db.inventory.findUnique({ where: { variantId } })).toBeNull();
      // The variant itself is only soft-deleted — the counter is the one row
      // that goes outright.
      const variantRow = await db.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      expect(variantRow.deletedAt).not.toBeNull();
    });
  });

  describe('authorization', () => {
    it('refuses an unauthenticated caller', async () => {
      const { productId, variantId } = await seedProduct();

      await request(app).get(inventoryPath(productId, variantId)).expect(401);
    });

    it('refuses a customer — no MANAGE_INVENTORY grant', async () => {
      const { productId, variantId } = await seedProduct();
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'plain');

      const response = await request(app)
        .get(inventoryPath(productId, variantId))
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('lets a vendor owner read and write their own stock', async () => {
      const { productId, variantId } = await seedProduct(vendorB);

      await readInventory(vendorB, productId, variantId);
      await setStock(vendorB, productId, variantId, { available: 3, version: 1 }).expect(200);
    });
  });

  describe('tenant isolation', () => {
    it('vendor A cannot read vendor B’s stock — 404, not 403', async () => {
      const { productId, variantId } = await seedProduct(vendorB);

      const response = await request(app)
        .get(inventoryPath(productId, variantId))
        .set('Authorization', auth(vendorA))
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('INVENTORY_NOT_FOUND');
    });

    it('vendor A cannot write vendor B’s stock, and the figure is untouched', async () => {
      const { productId, variantId } = await seedProduct(vendorB);
      await setStock(vendorB, productId, variantId, { available: 42, version: 1 }).expect(200);

      await setStock(vendorA, productId, variantId, { available: 999, version: 2 }).expect(404);

      const row = await db.inventory.findUniqueOrThrow({ where: { variantId } });
      expect(row.available).toBe(42);
    });
  });
});
