import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { createApp } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';

const EMAIL_PREFIX = 'public-product-detail-';
const NOW = new Date('2026-03-01T00:00:00.000Z');

interface VariantItem {
  readonly id: string;
  readonly name: string;
  readonly price: { readonly amount: string; readonly currency: string };
  readonly unitOfMeasure: string;
  readonly quantityStep: number;
  readonly available: number;
  // Only present if a bug ever puts them on the wire — asserted absent below.
  readonly sku?: string;
}

interface DetailBody {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly brand: string | null;
  readonly description: string | null;
  readonly hsnCode: string | null;
  readonly countryOfOrigin: string | null;
  readonly netQuantity: string | null;
  readonly attributeValues: Record<string, unknown>;
  readonly mediaCount: number;
  readonly variants: VariantItem[];
  readonly createdAt: string;
  readonly updatedAt: string;
  // Only present if a bug ever puts them on the wire — asserted absent below.
  readonly vendorId?: string;
  readonly status?: string;
  readonly rejectionReason?: string | null;
  readonly rejectionNote?: string | null;
  readonly deletedAt?: string | null;
}

interface DetailResponseBody {
  readonly data: DetailBody;
  readonly meta: { readonly requestId: string };
}

interface ErrorBody {
  readonly error: { readonly code: string };
}

const requireDatabaseUrl = (): string => {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error('DATABASE_URL must be set for this suite (owner connection for fixtures).');
  }
  return value;
};

/**
 * The public, unauthenticated product-detail surface (S3-3 discovery
 * milestone), end to end.
 *
 * Fixtures are written directly through the **owner** connection, never
 * `container.adminPrisma`/`container.prisma` — the same reasoning
 * `public-search.test.ts` gives for its own `owner` client: seeding an
 * already-`APPROVED` product, its variants and their stock has to bypass the
 * moderation/vendor-write workflow entirely. This suite's job is the public
 * *read* path.
 */
describe('public product detail endpoint (S3-3 discovery milestone)', () => {
  let container: Container;
  let app: Express;
  let owner: PrismaClient;
  const ids = new UuidV7Generator();

  const userIds: string[] = [];
  const vendorIds: string[] = [];
  const categoryIds: string[] = [];

  const seedVendor = async (label: string): Promise<string> => {
    const userId = ids.generate();
    const vendorId = ids.generate();
    await owner.user.create({
      data: {
        id: userId,
        email: `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      },
    });
    await owner.vendorProfile.create({
      data: { id: vendorId, userId, createdAt: NOW, updatedAt: NOW },
    });
    userIds.push(userId);
    vendorIds.push(vendorId);
    return vendorId;
  };

  const seedCategory = async (label: string): Promise<string> => {
    const categoryId = ids.generate();
    const slug = `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await owner.category.create({
      data: {
        id: categoryId,
        path: [],
        depth: 1,
        name: slug,
        slug,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    categoryIds.push(categoryId);
    return categoryId;
  };

  const seedProduct = async (params: {
    vendorId: string;
    categoryId: string;
    name: string;
    status?: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
    deleted?: boolean;
  }): Promise<string> => {
    const id = ids.generate();
    await owner.product.create({
      data: {
        id,
        vendorId: params.vendorId,
        categoryId: params.categoryId,
        name: params.name,
        attributeValues: {},
        status: params.status ?? 'APPROVED',
        rejectionReason: params.status === 'REJECTED' ? 'OTHER' : null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: params.deleted ? NOW : null,
      },
    });
    return id;
  };

  const seedVariant = async (params: {
    productId: string;
    vendorId: string;
    name: string;
    priceAmount: bigint;
    unitOfMeasure?: string;
    quantityStep?: number;
    deleted?: boolean;
  }): Promise<string> => {
    const id = ids.generate();
    await owner.productVariant.create({
      data: {
        id,
        productId: params.productId,
        vendorId: params.vendorId,
        // The full id, not a slice: UUIDv7's time-based prefix means two
        // variants created within the same millisecond can share their
        // first several characters, which previously collided on
        // `(vendor_id, sku)` — the id itself is unique by construction.
        sku: `SKU-${id}`,
        name: params.name,
        priceAmount: params.priceAmount,
        priceCurrency: 'INR',
        unitOfMeasure: params.unitOfMeasure ?? 'kg',
        quantityStep: params.quantityStep ?? 1,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: params.deleted ? NOW : null,
      },
    });
    return id;
  };

  const seedInventory = async (params: {
    variantId: string;
    vendorId: string;
    available: number;
  }): Promise<void> => {
    await owner.inventory.create({
      data: {
        variantId: params.variantId,
        vendorId: params.vendorId,
        available: params.available,
        reserved: 3,
        version: 5,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  };

  const seedMedia = async (params: {
    productId: string;
    vendorId: string;
    status?: 'AWAITING_UPLOAD' | 'PROCESSING' | 'READY' | 'FAILED';
    deleted?: boolean;
  }): Promise<void> => {
    await owner.productMedia.create({
      data: {
        id: ids.generate(),
        productId: params.productId,
        vendorId: params.vendorId,
        objectKey: `product-media/${params.vendorId}/${params.productId}/${ids.generate()}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        status: params.status ?? 'READY',
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: params.deleted ? NOW : null,
      },
    });
  };

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    owner = new PrismaClient({ datasources: { db: { url: requireDatabaseUrl() } } });
  });

  afterAll(async () => {
    await owner.inventory.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await owner.productVariant.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await owner.productMedia.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await owner.product.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await owner.category.deleteMany({ where: { id: { in: categoryIds } } });
    await owner.vendorProfile.deleteMany({ where: { id: { in: vendorIds } } });
    await owner.user.deleteMany({ where: { id: { in: userIds } } });
    await owner.$disconnect();
    await container.dispose();
  });

  describe('a fully-formed approved product', () => {
    it('answers 200 with no Authorization header and the platform envelope', async () => {
      const vendorId = await seedVendor('happy-path');
      const categoryId = await seedCategory('happy-path');
      const productId = await seedProduct({
        vendorId,
        categoryId,
        name: `HappyPath-${Date.now()}`,
      });
      const variantId = await seedVariant({
        productId,
        vendorId,
        name: '1 kg pack',
        priceAmount: 19900n,
      });
      await seedInventory({ variantId, vendorId, available: 42 });
      await seedMedia({ productId, vendorId });

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${productId}`)
        .expect(200);
      const body = response.body as DetailResponseBody;

      expect(body.data.id).toBe(productId);
      expect(body.data.categoryId).toBe(categoryId);
      expect(typeof body.meta.requestId).toBe('string');
      expect(body.data.mediaCount).toBe(1);
      expect(body.data.variants).toHaveLength(1);
      expect(body.data.variants[0]).toEqual({
        id: variantId,
        name: '1 kg pack',
        price: { amount: '19900', currency: 'INR' },
        unitOfMeasure: 'kg',
        quantityStep: 1,
        available: 42,
      });
    });

    it('reports multiple variants, each with its own price and availability', async () => {
      const vendorId = await seedVendor('multi-variant');
      const categoryId = await seedCategory('multi-variant');
      const productId = await seedProduct({
        vendorId,
        categoryId,
        name: `MultiVariant-${Date.now()}`,
      });
      const smallId = await seedVariant({
        productId,
        vendorId,
        name: '500 g pack',
        priceAmount: 9900n,
      });
      const largeId = await seedVariant({
        productId,
        vendorId,
        name: '1 kg pack',
        priceAmount: 18900n,
      });
      await seedInventory({ variantId: smallId, vendorId, available: 10 });
      await seedInventory({ variantId: largeId, vendorId, available: 0 });

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${productId}`)
        .expect(200);
      const body = response.body as DetailResponseBody;

      const bySmall = body.data.variants.find((item) => item.id === smallId);
      const byLarge = body.data.variants.find((item) => item.id === largeId);
      expect(bySmall?.available).toBe(10);
      expect(bySmall?.price.amount).toBe('9900');
      expect(byLarge?.available).toBe(0);
    });

    it('treats a variant with no inventory row as zero available', async () => {
      const vendorId = await seedVendor('no-inventory');
      const categoryId = await seedCategory('no-inventory');
      const productId = await seedProduct({
        vendorId,
        categoryId,
        name: `NoInventory-${Date.now()}`,
      });
      await seedVariant({ productId, vendorId, name: 'Single pack', priceAmount: 5000n });

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${productId}`)
        .expect(200);
      const body = response.body as DetailResponseBody;

      expect(body.data.variants).toHaveLength(1);
      expect(body.data.variants[0]?.available).toBe(0);
    });

    it('counts only READY, non-deleted media toward mediaCount', async () => {
      const vendorId = await seedVendor('media-count');
      const categoryId = await seedCategory('media-count');
      const productId = await seedProduct({
        vendorId,
        categoryId,
        name: `MediaCount-${Date.now()}`,
      });
      await seedMedia({ productId, vendorId, status: 'READY' });
      await seedMedia({ productId, vendorId, status: 'READY' });
      await seedMedia({ productId, vendorId, status: 'PROCESSING' });
      await seedMedia({ productId, vendorId, status: 'AWAITING_UPLOAD' });
      await seedMedia({ productId, vendorId, status: 'FAILED' });
      await seedMedia({ productId, vendorId, status: 'READY', deleted: true });

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${productId}`)
        .expect(200);
      const body = response.body as DetailResponseBody;

      expect(body.data.mediaCount).toBe(2);
    });
  });

  describe('response field exposure', () => {
    it('never exposes vendorId, status, rejection detail, sku, or internal inventory fields', async () => {
      const vendorId = await seedVendor('exposure');
      const categoryId = await seedCategory('exposure');
      const productId = await seedProduct({ vendorId, categoryId, name: `Exposure-${Date.now()}` });
      const variantId = await seedVariant({
        productId,
        vendorId,
        name: 'Pack',
        priceAmount: 12345n,
      });
      await seedInventory({ variantId, vendorId, available: 7 });

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${productId}`)
        .expect(200);
      const body = response.body as DetailResponseBody;

      expect(body.data).not.toHaveProperty('vendorId');
      expect(body.data).not.toHaveProperty('status');
      expect(body.data).not.toHaveProperty('rejectionReason');
      expect(body.data).not.toHaveProperty('rejectionNote');
      expect(body.data).not.toHaveProperty('deletedAt');
      const [variant] = body.data.variants;
      expect(variant).not.toHaveProperty('sku');
      expect(variant).not.toHaveProperty('reserved');
      expect(variant).not.toHaveProperty('version');
    });
  });

  describe('visibility', () => {
    it('answers 404 PRODUCT_NOT_FOUND for an id that was never created', async () => {
      const response = await request(app)
        .get(`/api/v1/catalogue/products/${ids.generate()}`)
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_NOT_FOUND');
    });

    it.each(['DRAFT', 'PENDING_REVIEW', 'REJECTED'] as const)(
      'answers 404 for a %s product',
      async (status) => {
        // Category slugs are lowercase-hyphenated only (`chk_categories_slug_format`) — underscores in the enum name must not leak through.
        const label = `lifecycle-${status.toLowerCase().replace(/_/g, '-')}`;
        const vendorId = await seedVendor(label);
        const categoryId = await seedCategory(label);
        const productId = await seedProduct({
          vendorId,
          categoryId,
          name: `Lifecycle-${status}-${Date.now()}`,
          status,
        });

        const response = await request(app)
          .get(`/api/v1/catalogue/products/${productId}`)
          .expect(404);

        expect((response.body as ErrorBody).error.code).toBe('PRODUCT_NOT_FOUND');
      },
    );

    it('answers 404 for a soft-deleted APPROVED product', async () => {
      const vendorId = await seedVendor('lifecycle-deleted');
      const categoryId = await seedCategory('lifecycle-deleted');
      const productId = await seedProduct({
        vendorId,
        categoryId,
        name: `LifecycleDeleted-${Date.now()}`,
        status: 'APPROVED',
        deleted: true,
      });

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${productId}`)
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('excludes a soft-deleted variant from the response but still returns the product', async () => {
      const vendorId = await seedVendor('deleted-variant');
      const categoryId = await seedCategory('deleted-variant');
      const productId = await seedProduct({
        vendorId,
        categoryId,
        name: `DeletedVariant-${Date.now()}`,
      });
      await seedVariant({
        productId,
        vendorId,
        name: 'Gone',
        priceAmount: 1000n,
        deleted: true,
      });
      const liveId = await seedVariant({
        productId,
        vendorId,
        name: 'Still here',
        priceAmount: 2000n,
      });

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${productId}`)
        .expect(200);
      const body = response.body as DetailResponseBody;

      expect(body.data.variants.map((item) => item.id)).toEqual([liveId]);
    });
  });

  describe('malformed input', () => {
    it('rejects a non-UUID id with 400', async () => {
      await request(app).get('/api/v1/catalogue/products/not-a-uuid').expect(400);
    });
  });
});
