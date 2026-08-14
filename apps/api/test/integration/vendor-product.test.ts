import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { NullLogger } from '@leen-mart/domain-kit';
import { CATALOGUE_AUDIT_ACTIONS } from '../../src/modules/catalogue/domain/audit-actions.js';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import { signUpCustomer, signUpVendorOwner, type VendorActor } from '../support/actors.js';
import { AmbientAuditWriter } from '../../src/modules/audit/index.js';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/persistence/prisma-audit-log.repository.js';
import { DecideProductUseCase } from '../../src/modules/catalogue/application/use-cases/decide-product.use-case.js';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductMediaRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-media.repository.js';
import { AdminTransactionRunner } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { toProductId } from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toSessionId } from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { Principal } from '../../src/modules/identity/application/ports/principal.js';

const EMAIL_PREFIX = 'vendor-product-';

interface ErrorBody {
  readonly error: { code: string };
}
interface ProductData {
  id: string;
  categoryId: string;
  name: string;
  brand: string | null;
  status: string;
}
interface VariantData {
  id: string;
  productId: string;
  sku: string;
  name: string;
  price: { amount: string; currency: string };
  unitOfMeasure: string;
  quantityStep: number;
}
interface CreateBody {
  readonly data: { product: ProductData; variant: VariantData };
}
interface ProductBody {
  readonly data: ProductData;
}
interface VariantBody {
  readonly data: VariantData;
}
interface ProductListBody {
  readonly data: ProductData[];
  readonly meta: { pagination: { nextCursor: string | null; hasMore: boolean } };
}
interface VariantListBody {
  readonly data: VariantData[];
  readonly meta: Record<string, unknown>;
}

/**
 * The vendor product surface (S2-3b), end to end.
 *
 * Real authentication, real vendors, real PostgreSQL with RLS — because the
 * half of this feature that matters most is tenant isolation and the
 * last-variant invariant, and neither exists against a fake.
 *
 * Two vendors are minted once for the whole file: `LOGIN_PER_IP` caps logins
 * at 20/min and each vendor costs one, so a fresh pair per test would
 * rate-limit the suite rather than test it. What is fresh per test is the
 * product under attack, which is what the isolation proofs actually need.
 */
describe('vendor product endpoints', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let vendorA: VendorActor;
  let vendorB: VendorActor;
  let categoryId: string;

  let seq = 0;
  const uniqueSku = (): string => `SKU-${Date.now()}-${(seq += 1)}`;

  const seedCategory = async (): Promise<string> => {
    const slug = `vendor-product-cat-${Date.now()}-${(seq += 1)}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    return row.id;
  };

  const productsPath = '/api/v1/vendor/products';

  const createProduct = (
    actor: VendorActor,
    overrides: Record<string, unknown> = {},
    variantOverrides: Record<string, unknown> = {},
  ): request.Test =>
    request(app)
      .post(productsPath)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        categoryId,
        name: `Product ${(seq += 1)}`,
        variant: {
          sku: uniqueSku(),
          name: 'Default',
          price: { amount: '19900', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
          ...variantOverrides,
        },
        ...overrides,
      });

  const seedProduct = async (
    actor: VendorActor = vendorA,
  ): Promise<{ product: ProductData; variant: VariantData }> => {
    const response = await createProduct(actor).expect(201);
    return (response.body as CreateBody).data;
  };

  const addVariant = (
    actor: VendorActor,
    productId: string,
    overrides: Record<string, unknown> = {},
  ): request.Test =>
    request(app)
      .post(`${productsPath}/${productId}/variants`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        sku: uniqueSku(),
        name: 'Extra',
        price: { amount: '29900', currency: 'INR' },
        unitOfMeasure: 'per kg',
        quantityStep: 250,
        ...overrides,
      });

  const auth = (actor: VendorActor): string => `Bearer ${actor.token}`;

  /**
   * Direct DB insert of one live `READY` media row (S2-8's approval gate) —
   * never the real upload/complete/worker pipeline, which
   * `vendor-product-media.test.ts` already exercises. This suite's job is
   * plain product CRUD and the ASM-14 detail-edit trigger, not the media
   * pipeline that produces a `READY` row in production.
   */
  const seedReadyMedia = async (productId: string, actor: VendorActor): Promise<void> => {
    await db.productMedia.create({
      data: {
        id: randomUUID(),
        productId,
        vendorId: actor.vendorId,
        objectKey: `product-media/${actor.vendorId}/${productId}/${randomUUID()}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        status: 'READY',
      },
    });
  };

  /**
   * Moves a product straight from DRAFT to APPROVED, bypassing the admin MFA
   * flow — the same direct-use-case shortcut `admin-product-decision.test.ts`/
   * `vendor-product-media.test.ts` use.
   */
  const approveProduct = async (actor: VendorActor, productId: string): Promise<void> => {
    await request(app)
      .post(`${productsPath}/${productId}/submit`)
      .set('Authorization', auth(actor))
      .expect(200);
    await seedReadyMedia(productId, actor);

    const decideProductUseCase = new DecideProductUseCase({
      productRepository: new PrismaProductRepository(harness.container.adminPrisma),
      productMediaRepository: new PrismaProductMediaRepository(harness.container.adminPrisma),
      transactionRunner: new AdminTransactionRunner(harness.container.adminPrisma),
      auditWriter: new AmbientAuditWriter({
        auditLogRepository: new PrismaAuditLogRepository(harness.container.adminPrisma),
        idGenerator: harness.container.idGenerator,
        clock: harness.container.clock,
      }),
      clock: harness.container.clock,
      logger: new NullLogger(),
    });
    const principal: Principal = {
      userId: toUserId(randomUUID()),
      sessionId: toSessionId(randomUUID()),
      role: 'CATALOGUE_MODERATOR',
    };
    await decideProductUseCase.execute({
      principal,
      productId: toProductId(productId),
      command: { decision: 'APPROVE' },
    });
  };

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    vendorA = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor-a');
    vendorB = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor-b');
    categoryId = await seedCategory();
  }, 60_000);

  afterAll(async () => {
    // Products first — `products.category_id` is RESTRICT, so a category
    // cannot go while a product still points at it. The harness removes the
    // products (and their variants and vendors) as part of disposing the
    // accounts, which is why the categories wait until after it.
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, 'vendor-product-cat-%');
    await db.$disconnect();
  });

  describe('create', () => {
    it('creates the product and its first variant together, and returns both', async () => {
      const { product, variant } = await seedProduct();

      expect(product.status).toBe('DRAFT');
      expect(variant.productId).toBe(product.id);
      expect(variant.price).toEqual({ amount: '19900', currency: 'INR' });
    });

    it('commits both rows atomically, owned by the calling vendor', async () => {
      const { product, variant } = await seedProduct();

      const productRow = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      const variantRow = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });

      expect(productRow.vendorId).toBe(vendorA.vendorId);
      expect(variantRow.vendorId).toBe(vendorA.vendorId);
      expect(variantRow.productId).toBe(product.id);
    });

    it('records a single created audit entry against the product', async () => {
      const { product } = await seedProduct();

      const rows = await db.auditLog.findMany({
        where: { entityId: product.id, entityType: 'Product' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_CREATED);
      expect(rows[0]?.actorId).toBe(vendorA.userId);
    });

    it('returns 404 for a category that does not exist, and writes nothing', async () => {
      const before = await db.product.count({ where: { vendorId: vendorA.vendorId } });

      const response = await createProduct(vendorA, { categoryId: randomUUID() }).expect(404);

      expect((response.body as ErrorBody).error.code).toBe('CATEGORY_NOT_FOUND');
      expect(await db.product.count({ where: { vendorId: vendorA.vendorId } })).toBe(before);
    });

    it('returns 409 for a SKU this vendor already uses', async () => {
      const { variant } = await seedProduct();

      const response = await createProduct(vendorA, {}, { sku: variant.sku }).expect(409);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_VARIANT_SKU_CONFLICT');
    });

    it('allows two different vendors to use the same SKU', async () => {
      const { variant } = await seedProduct(vendorA);

      // SDD 6.4: a vendor's SKU is unique to them, never globally.
      await createProduct(vendorB, {}, { sku: variant.sku }).expect(201);
    });

    it.each([
      ['a vendorId in the body', { vendorId: randomUUID() }],
      ['a status in the body', { status: 'PUBLISHED' }],
      ['an id in the body', { id: randomUUID() }],
      ['an unexpected field', { colour: 'blue' }],
      ['a malformed categoryId', { categoryId: 'not-a-uuid' }],
      ['no variant at all', { variant: undefined }],
    ])('returns 400 for %s', async (_label, overrides) => {
      await createProduct(vendorA, overrides).expect(400);
    });

    it('returns 400 for a negative price or a zero quantity step', async () => {
      await createProduct(vendorA, {}, { price: { amount: '-1', currency: 'INR' } }).expect(422);
      await createProduct(vendorA, {}, { quantityStep: 0 }).expect(400);
    });
  });

  describe('read', () => {
    it('returns one of the caller’s own products', async () => {
      const { product } = await seedProduct();

      const response = await request(app)
        .get(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      expect((response.body as ProductBody).data.id).toBe(product.id);
    });

    it('never exposes deletedAt or vendorId', async () => {
      const { product } = await seedProduct();

      const response = await request(app)
        .get(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('deletedAt');
      expect(body).not.toContain(vendorA.vendorId);
    });

    it('pages the list on the platform’s cursor envelope', async () => {
      await seedProduct();
      await seedProduct();

      const response = await request(app)
        .get(`${productsPath}?limit=1`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      const body = response.body as ProductListBody;
      expect(body.data).toHaveLength(1);
      expect(body.meta.pagination).toHaveProperty('hasMore');
      expect(body.meta.pagination).toHaveProperty('nextCursor');
    });

    it('lists only the caller’s own products', async () => {
      const mine = await seedProduct(vendorA);
      const theirs = await seedProduct(vendorB);

      const response = await request(app)
        .get(`${productsPath}?limit=100`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      const ids = (response.body as ProductListBody).data.map((product) => product.id);
      expect(ids).toContain(mine.product.id);
      expect(ids).not.toContain(theirs.product.id);
    });

    it('returns 400 for a malformed product id', async () => {
      await request(app)
        .get(`${productsPath}/not-a-uuid`)
        .set('Authorization', auth(vendorA))
        .expect(400);
    });

    it('returns 404 for an unknown product id', async () => {
      const response = await request(app)
        .get(`${productsPath}/${randomUUID()}`)
        .set('Authorization', auth(vendorA))
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('applies only the supplied fields', async () => {
      const { product } = await seedProduct();

      const response = await request(app)
        .patch(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .send({ name: 'Renamed', brand: 'Acme' })
        .expect(200);

      const { data } = response.body as ProductBody;
      expect(data.name).toBe('Renamed');
      expect(data.brand).toBe('Acme');
      expect(data.categoryId).toBe(product.categoryId);
    });

    it.each([
      ['id', { id: randomUUID() }],
      ['vendorId', { vendorId: randomUUID() }],
      ['status', { status: 'PUBLISHED' }],
      ['createdAt', { createdAt: '2026-01-01T00:00:00.000Z' }],
      ['deletedAt', { deletedAt: '2026-01-01T00:00:00.000Z' }],
      ['an unexpected field', { colour: 'blue' }],
    ])('returns 400 when the body carries %s', async (_label, body) => {
      const { product } = await seedProduct();

      await request(app)
        .patch(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .send(body)
        .expect(400);
    });

    it('records an updated audit entry', async () => {
      const { product } = await seedProduct();

      await request(app)
        .patch(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .send({ name: 'Audited' })
        .expect(200);

      const actions = (
        await db.auditLog.findMany({
          where: { entityId: product.id, entityType: 'Product' },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => row.action);

      expect(actions).toEqual([
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_CREATED,
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_UPDATED,
      ]);
    });

    it('returns 404 for an unknown product', async () => {
      await request(app)
        .patch(`${productsPath}/${randomUUID()}`)
        .set('Authorization', auth(vendorA))
        .send({ name: 'x' })
        .expect(404);
    });
  });

  describe('ASM-14 detail-edit re-review (S2-8)', () => {
    it('re-enters PENDING_REVIEW when the name changes on an APPROVED product', async () => {
      const { product } = await seedProduct();
      await approveProduct(vendorA, product.id);

      const response = await request(app)
        .patch(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .send({ name: 'Renamed After Approval' })
        .expect(200);

      expect((response.body as ProductBody).data.status).toBe('PENDING_REVIEW');
    });

    it('re-enters PENDING_REVIEW when the category changes on an APPROVED product', async () => {
      const { product } = await seedProduct();
      await approveProduct(vendorA, product.id);
      const otherCategoryId = await seedCategory();

      const response = await request(app)
        .patch(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .send({ categoryId: otherCategoryId })
        .expect(200);

      expect((response.body as ProductBody).data.status).toBe('PENDING_REVIEW');
    });

    it('re-enters PENDING_REVIEW when the brand changes on an APPROVED product', async () => {
      const { product } = await seedProduct();
      await approveProduct(vendorA, product.id);

      const response = await request(app)
        .patch(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .send({ brand: 'Acme' })
        .expect(200);

      expect((response.body as ProductBody).data.status).toBe('PENDING_REVIEW');
    });

    it('stays APPROVED for a description-only edit', async () => {
      const { product } = await seedProduct();
      await approveProduct(vendorA, product.id);

      const response = await request(app)
        .patch(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .send({ description: 'Updated copy, nothing structural.' })
        .expect(200);

      expect((response.body as ProductBody).data.status).toBe('APPROVED');
    });

    it('records the reopening audit entry alongside PRODUCT_UPDATED', async () => {
      const { product } = await seedProduct();
      await approveProduct(vendorA, product.id);

      await request(app)
        .patch(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .send({ name: 'Renamed Again' })
        .expect(200);

      const actions = (
        await db.auditLog.findMany({
          where: { entityId: product.id, entityType: 'Product' },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => row.action);

      expect(actions).toContain(CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_DETAIL_CHANGE);
      expect(actions).toContain(CATALOGUE_AUDIT_ACTIONS.PRODUCT_UPDATED);
    });

    it('does not trigger for a DRAFT product', async () => {
      const { product } = await seedProduct();

      const response = await request(app)
        .patch(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .send({ name: 'Renamed While Draft' })
        .expect(200);

      expect((response.body as ProductBody).data.status).toBe('DRAFT');
    });
  });

  describe('delete', () => {
    it('soft-deletes the product and its variants together, and hides it from reads', async () => {
      const { product, variant } = await seedProduct();

      await request(app)
        .delete(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      await request(app)
        .get(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .expect(404);

      const productRow = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      const variantRow = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(productRow.deletedAt).not.toBeNull();
      expect(variantRow.deletedAt).not.toBeNull();
    });

    it('never physically deletes a row', async () => {
      const { product } = await seedProduct();

      await request(app)
        .delete(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      expect(await db.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    });

    it('records how many variants went with it', async () => {
      const { product } = await seedProduct();
      await addVariant(vendorA, product.id).expect(201);

      await request(app)
        .delete(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      const row = await db.auditLog.findFirstOrThrow({
        where: { entityId: product.id, action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_DELETED },
      });
      expect(row.before).toMatchObject({ variantsRemoved: 2 });
    });

    it('returns 404 for an already-deleted product', async () => {
      const { product } = await seedProduct();
      await request(app)
        .delete(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      await request(app)
        .delete(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorA))
        .expect(404);
    });
  });

  describe('variants', () => {
    it('adds a variant to an existing product', async () => {
      const { product } = await seedProduct();

      const response = await addVariant(vendorA, product.id).expect(201);

      const { data } = response.body as VariantBody;
      expect(data.productId).toBe(product.id);
      expect(data.unitOfMeasure).toBe('per kg');
      expect(data.quantityStep).toBe(250);
    });

    it('lists variants unpaginated, oldest first', async () => {
      const { product, variant } = await seedProduct();
      const added = await addVariant(vendorA, product.id).expect(201);

      const response = await request(app)
        .get(`${productsPath}/${product.id}/variants`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      const body = response.body as VariantListBody;
      expect(body.data.map((row) => row.id)).toEqual([
        variant.id,
        (added.body as VariantBody).data.id,
      ]);
      expect(body.meta).not.toHaveProperty('pagination');
    });

    it('excludes deleted variants from the list', async () => {
      const { product, variant } = await seedProduct();
      const added = await addVariant(vendorA, product.id).expect(201);
      const addedId = (added.body as VariantBody).data.id;

      await request(app)
        .delete(`${productsPath}/${product.id}/variants/${addedId}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      const response = await request(app)
        .get(`${productsPath}/${product.id}/variants`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      expect((response.body as VariantListBody).data.map((row) => row.id)).toEqual([variant.id]);
    });

    it('reads one variant by id', async () => {
      const { product, variant } = await seedProduct();

      const response = await request(app)
        .get(`${productsPath}/${product.id}/variants/${variant.id}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      expect((response.body as VariantBody).data.id).toBe(variant.id);
    });

    it('returns 404 for a valid variant id under the wrong product', async () => {
      const first = await seedProduct();
      const second = await seedProduct();

      const response = await request(app)
        .get(`${productsPath}/${second.product.id}/variants/${first.variant.id}`)
        .set('Authorization', auth(vendorA))
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_VARIANT_NOT_FOUND');
    });

    it('updates a variant without touching its SKU', async () => {
      const { product, variant } = await seedProduct();

      const response = await request(app)
        .patch(`${productsPath}/${product.id}/variants/${variant.id}`)
        .set('Authorization', auth(vendorA))
        .send({ name: 'Renamed', price: { amount: '50000', currency: 'INR' } })
        .expect(200);

      const { data } = response.body as VariantBody;
      expect(data.name).toBe('Renamed');
      expect(data.price.amount).toBe('50000');
      expect(data.sku).toBe(variant.sku);
    });

    it.each([
      ['sku', { sku: 'NEW-SKU' }],
      ['productId', { productId: randomUUID() }],
      ['vendorId', { vendorId: randomUUID() }],
      ['id', { id: randomUUID() }],
      ['deletedAt', { deletedAt: '2026-01-01T00:00:00.000Z' }],
    ])('returns 400 when the variant body carries %s', async (_label, body) => {
      const { product, variant } = await seedProduct();

      await request(app)
        .patch(`${productsPath}/${product.id}/variants/${variant.id}`)
        .set('Authorization', auth(vendorA))
        .send(body)
        .expect(400);
    });

    it('returns 409 when adding a variant with a SKU this vendor already uses', async () => {
      const { product, variant } = await seedProduct();

      const response = await addVariant(vendorA, product.id, { sku: variant.sku }).expect(409);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_VARIANT_SKU_CONFLICT');
    });

    it('removes a non-last variant', async () => {
      const { product } = await seedProduct();
      const added = await addVariant(vendorA, product.id).expect(201);
      const addedId = (added.body as VariantBody).data.id;

      await request(app)
        .delete(`${productsPath}/${product.id}/variants/${addedId}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      const row = await db.productVariant.findUniqueOrThrow({ where: { id: addedId } });
      expect(row.deletedAt).not.toBeNull();
    });

    it('refuses to remove the last live variant with a 409, and leaves it alone', async () => {
      const { product, variant } = await seedProduct();

      const response = await request(app)
        .delete(`${productsPath}/${product.id}/variants/${variant.id}`)
        .set('Authorization', auth(vendorA))
        .expect(409);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_LAST_VARIANT');
      const row = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(row.deletedAt).toBeNull();
    });

    it('records add, update and remove audit entries against the product', async () => {
      const { product } = await seedProduct();
      const added = await addVariant(vendorA, product.id).expect(201);
      const addedId = (added.body as VariantBody).data.id;

      await request(app)
        .patch(`${productsPath}/${product.id}/variants/${addedId}`)
        .set('Authorization', auth(vendorA))
        .send({ name: 'Renamed' })
        .expect(200);
      await request(app)
        .delete(`${productsPath}/${product.id}/variants/${addedId}`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      const actions = (
        await db.auditLog.findMany({
          where: { entityId: product.id, entityType: 'Product' },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => row.action);

      expect(actions).toEqual([
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_CREATED,
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_VARIANT_ADDED,
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_VARIANT_UPDATED,
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_VARIANT_REMOVED,
      ]);
    });

    it('records nothing for a read', async () => {
      const { product } = await seedProduct();

      await request(app)
        .get(`${productsPath}/${product.id}/variants`)
        .set('Authorization', auth(vendorA))
        .expect(200);

      const rows = await db.auditLog.findMany({
        where: { entityId: product.id, entityType: 'Product' },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe('authorization', () => {
    it('refuses an unauthenticated caller', async () => {
      await request(app).get(productsPath).expect(401);
      await request(app).post(productsPath).send({}).expect(401);
    });

    it('refuses a customer — no CREATE_OR_EDIT_PRODUCT grant', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'plain-customer');

      const response = await request(app)
        .get(productsPath)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('lets a vendor owner operate on their own resources', async () => {
      const { product } = await seedProduct(vendorB);

      await request(app)
        .get(`${productsPath}/${product.id}`)
        .set('Authorization', auth(vendorB))
        .expect(200);
    });
  });

  describe('tenant isolation', () => {
    it.each([
      ['read', 'get'],
      ['update', 'patch'],
      ['delete', 'delete'],
    ] as [string, 'get' | 'patch' | 'delete'][])(
      'vendor A cannot %s vendor B’s product — 404, not 403',
      async (_label, method) => {
        const { product } = await seedProduct(vendorB);

        const response = await request(app)
          [method](`${productsPath}/${product.id}`)
          .set('Authorization', auth(vendorA))
          .send(method === 'patch' ? { name: 'Hijacked' } : undefined)
          .expect(404);

        // The same code a nonexistent id gets: nothing tells A that the
        // product exists, is deleted, or belongs to someone else.
        expect((response.body as ErrorBody).error.code).toBe('PRODUCT_NOT_FOUND');
        const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
        expect(row.name).toBe(product.name);
        expect(row.deletedAt).toBeNull();
      },
    );

    it.each([
      ['read', 'get'],
      ['update', 'patch'],
      ['delete', 'delete'],
    ] as [string, 'get' | 'patch' | 'delete'][])(
      'vendor A cannot %s vendor B’s variant — 404, not 403',
      async (_label, method) => {
        const { product, variant } = await seedProduct(vendorB);

        await request(app)
          [method](`${productsPath}/${product.id}/variants/${variant.id}`)
          .set('Authorization', auth(vendorA))
          .send(method === 'patch' ? { name: 'Hijacked' } : undefined)
          .expect(404);

        const row = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
        expect(row.name).toBe(variant.name);
        expect(row.deletedAt).toBeNull();
      },
    );

    it('vendor A cannot add a variant to vendor B’s product', async () => {
      const { product } = await seedProduct(vendorB);

      const response = await addVariant(vendorA, product.id).expect(404);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_NOT_FOUND');
      expect(await db.productVariant.count({ where: { productId: product.id } })).toBe(1);
    });

    it('vendor A cannot list vendor B’s variants', async () => {
      const { product } = await seedProduct(vendorB);

      await request(app)
        .get(`${productsPath}/${product.id}/variants`)
        .set('Authorization', auth(vendorA))
        .expect(404);
    });
  });
});
