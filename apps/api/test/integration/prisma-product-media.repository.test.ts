import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductMediaRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-media.repository.js';
import { Product } from '../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductMedia } from '../../src/modules/catalogue/domain/entities/product-media.entity.js';
import { Category } from '../../src/modules/catalogue/domain/entities/category.entity.js';
import { PrismaCategoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category.repository.js';
import { CategoryRiskLevel } from '../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategoryId } from '../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toCategorySlug } from '../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import { toProductId } from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductMediaId } from '../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const SLUG_PREFIX = 'media-repo-cat-';
const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');

const NO_REQUIREMENTS = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

/**
 * Repository-level integration test against real PostgreSQL, following
 * `prisma-product-variant.repository.test.ts` (correctness here; RLS proof
 * in `product-media-rls-isolation.test.ts`, concurrency proof in
 * `vendor-product-media-concurrency.test.ts`).
 */
describe('PrismaProductMediaRepository', () => {
  const db = new PrismaClient();
  const productRepository = new PrismaProductRepository(db);
  const mediaRepository = new PrismaProductMediaRepository(db);
  const categoryRepository = new PrismaCategoryRepository(db);

  const userId = toUserId(ids.generate());
  const vendorId = toVendorId(ids.generate());
  const categoryId = toCategoryId(ids.generate());
  let productId: ReturnType<typeof toProductId>;

  const make = (
    overrides: { objectKey?: string; contentType?: string; sizeBytes?: number } = {},
  ): ProductMedia =>
    ProductMedia.create({
      id: toProductMediaId(ids.generate()),
      productId,
      vendorId,
      objectKey:
        overrides.objectKey ?? `product-media/${vendorId}/${productId}/${ids.generate()}.jpg`,
      contentType: overrides.contentType ?? 'image/jpeg',
      sizeBytes: overrides.sizeBytes ?? 2048,
      now: NOW,
    });

  beforeAll(async () => {
    const stamp = Date.now();
    await db.user.create({
      data: { id: userId, email: `media-repo-${stamp}@example.com`, passwordHash: 'hashed:x' },
    });
    await db.vendorProfile.create({
      data: { id: vendorId, userId, status: 'REGISTERED', createdAt: NOW, updatedAt: NOW },
    });
    const category = Category.create({
      id: categoryId,
      parent: null,
      name: `${SLUG_PREFIX}${stamp}`,
      slug: toCategorySlug(`${SLUG_PREFIX}${stamp}`),
      riskLevel: CategoryRiskLevel.LOW,
      requirements: NO_REQUIREMENTS,
      now: NOW,
    });
    await categoryRepository.create(category);

    const product = Product.create({
      id: toProductId(ids.generate()),
      vendorId,
      categoryId,
      name: 'Fresh Rohu Fish',
      brand: null,
      description: null,
      hsnCode: null,
      countryOfOrigin: null,
      netQuantity: null,
      attributeValues: {},
      now: NOW,
    });
    await productRepository.create(product);
    productId = product.id;
  });

  afterAll(async () => {
    await db.productMedia.deleteMany({ where: { vendorId } });
    await db.product.deleteMany({ where: { vendorId } });
    await db.category.deleteMany({ where: { id: categoryId } });
    await db.vendorProfile.deleteMany({ where: { id: vendorId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  describe('round trip', () => {
    it('stores and reads back every field', async () => {
      const media = make({ objectKey: 'product-media/x/y/round-trip.jpg', sizeBytes: 4096 });
      await mediaRepository.create(media);

      const found = await mediaRepository.findById(media.id);
      if (!found) throw new Error('expected the media item to round-trip');

      expect(found.id).toBe(media.id);
      expect(found.productId).toBe(productId);
      expect(found.vendorId).toBe(vendorId);
      expect(found.objectKey).toBe('product-media/x/y/round-trip.jpg');
      expect(found.contentType).toBe('image/jpeg');
      expect(found.sizeBytes).toBe(4096);
      expect(found.status).toBe('AWAITING_UPLOAD');
      expect(found.deletedAt).toBeNull();
    });
  });

  describe('findById / findByProductAndId', () => {
    it('returns null for an id that was never created', async () => {
      await expect(mediaRepository.findById(toProductMediaId(ids.generate()))).resolves.toBeNull();
    });

    it('returns null when the id belongs to a different product', async () => {
      const media = make();
      await mediaRepository.create(media);

      const otherProductId = toProductId(ids.generate());
      await expect(
        mediaRepository.findByProductAndId(otherProductId, media.id),
      ).resolves.toBeNull();
    });

    it('finds it under its own product', async () => {
      const media = make();
      await mediaRepository.create(media);

      await expect(mediaRepository.findByProductAndId(productId, media.id)).resolves.not.toBeNull();
    });
  });

  describe('listByProductId / countLiveForProduct', () => {
    it('lists only live items of one product, oldest first', async () => {
      const isolatedProduct = Product.create({
        id: toProductId(ids.generate()),
        vendorId,
        categoryId,
        name: 'Isolated for listing',
        brand: null,
        description: null,
        hsnCode: null,
        countryOfOrigin: null,
        netQuantity: null,
        attributeValues: {},
        now: NOW,
      });
      await productRepository.create(isolatedProduct);

      const forIsolated = (): ProductMedia =>
        ProductMedia.create({
          id: toProductMediaId(ids.generate()),
          productId: isolatedProduct.id,
          vendorId,
          objectKey: `product-media/${vendorId}/${isolatedProduct.id}/${ids.generate()}.jpg`,
          contentType: 'image/jpeg',
          sizeBytes: 2048,
          now: NOW,
        });

      const first = forIsolated();
      await mediaRepository.create(first);
      const second = forIsolated();
      await mediaRepository.create(second);
      const deleted = forIsolated();
      await mediaRepository.create(deleted);
      await mediaRepository.softDelete(deleted.softDelete(LATER));

      const listed = await mediaRepository.listByProductId(isolatedProduct.id);
      expect(listed.map((m) => m.id)).toEqual([first.id, second.id]);

      await expect(mediaRepository.countLiveForProduct(isolatedProduct.id)).resolves.toBe(2);
    });
  });

  describe('completeIfAwaitingUpload', () => {
    it('completes an AWAITING_UPLOAD item', async () => {
      const media = make();
      await mediaRepository.create(media);

      const completed = media.completeUpload(LATER);
      await expect(mediaRepository.completeIfAwaitingUpload(completed)).resolves.toBe(true);

      const found = await mediaRepository.findById(media.id);
      expect(found?.status).toBe('PROCESSING');
    });

    it('refuses a second completion of the same row — the arbiter is the WHERE clause, not a prior read', async () => {
      const media = make();
      await mediaRepository.create(media);
      const completed = media.completeUpload(LATER);
      await mediaRepository.completeIfAwaitingUpload(completed);

      // Same logical transition, attempted again — the row is no longer
      // AWAITING_UPLOAD, so this must report false without throwing.
      await expect(mediaRepository.completeIfAwaitingUpload(completed)).resolves.toBe(false);
    });

    it('reports false for an id that does not exist', async () => {
      const phantom = make();
      await expect(
        mediaRepository.completeIfAwaitingUpload(phantom.completeUpload(LATER)),
      ).resolves.toBe(false);
    });
  });

  describe('softDelete', () => {
    it('soft-deletes a live item', async () => {
      const media = make();
      await mediaRepository.create(media);

      await expect(mediaRepository.softDelete(media.softDelete(LATER))).resolves.toBe(true);
      await expect(mediaRepository.findById(media.id)).resolves.toBeNull();
    });

    it('reports false for an item already deleted', async () => {
      const media = make();
      await mediaRepository.create(media);
      const deleted = media.softDelete(LATER);
      await mediaRepository.softDelete(deleted);

      await expect(mediaRepository.softDelete(deleted)).resolves.toBe(false);
    });
  });

  describe('composite foreign key integrity (S2-6a)', () => {
    it('refuses a media row whose vendor_id does not match its product’s own vendor_id', async () => {
      const mismatched = ids.generate();
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO product_media (id, product_id, vendor_id, object_key, content_type, size_bytes, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'mismatch.jpg', 'image/jpeg', 1024, now())`,
          ids.generate(),
          productId,
          mismatched,
        ),
      ).rejects.toThrow(/product_media_product_id_vendor_id_fkey/);
    });
  });

  describe('database constraints (S2-6a)', () => {
    it('refuses a blank object_key at the database', async () => {
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO product_media (id, product_id, vendor_id, object_key, content_type, size_bytes, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, '   ', 'image/jpeg', 1024, now())`,
          ids.generate(),
          productId,
          vendorId,
        ),
      ).rejects.toThrow(/chk_product_media_object_key_not_blank/);
    });

    it('refuses a blank content_type at the database', async () => {
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO product_media (id, product_id, vendor_id, object_key, content_type, size_bytes, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'x.jpg', '   ', 1024, now())`,
          ids.generate(),
          productId,
          vendorId,
        ),
      ).rejects.toThrow(/chk_product_media_content_type_not_blank/);
    });

    it('refuses a non-positive size_bytes at the database', async () => {
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO product_media (id, product_id, vendor_id, object_key, content_type, size_bytes, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'x.jpg', 'image/jpeg', 0, now())`,
          ids.generate(),
          productId,
          vendorId,
        ),
      ).rejects.toThrow(/chk_product_media_size_positive/);
    });
  });
});
