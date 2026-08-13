import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { Product } from '../../src/modules/catalogue/domain/entities/product.entity.js';
import type { ProductAttributeValues } from '../../src/modules/catalogue/domain/entities/product.entity.js';
import { Category } from '../../src/modules/catalogue/domain/entities/category.entity.js';
import { PrismaCategoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category.repository.js';
import { CategoryRiskLevel } from '../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import {
  toCategoryId,
  type CategoryId,
} from '../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toCategorySlug } from '../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import { toProductId } from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const SLUG_PREFIX = 'product-repo-cat-';
const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');

const NO_REQUIREMENTS = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

interface MakeOverrides {
  readonly name?: string;
  readonly brand?: string | null;
  readonly description?: string | null;
  readonly hsnCode?: string | null;
  readonly countryOfOrigin?: string | null;
  readonly netQuantity?: string | null;
  readonly attributeValues?: ProductAttributeValues;
  readonly categoryId?: CategoryId;
}

/**
 * Repository-level integration test against real PostgreSQL, following
 * `prisma-vendor-kyc.repository.test.ts`: run on the owner connection, no RLS
 * assertions here — those live in `product-rls-isolation.test.ts`, the same
 * split `tenant-rls-isolation.test.ts` established for the vendor/KYC tables.
 * This suite proves the mapping round-trips and that the database enforces
 * what S2-3a's migration added.
 */
describe('PrismaProductRepository', () => {
  const db = new PrismaClient();
  const repository = new PrismaProductRepository(db);
  const categoryRepository = new PrismaCategoryRepository(db);

  const userId = toUserId(ids.generate());
  const vendorId = toVendorId(ids.generate());
  const categoryId = toCategoryId(ids.generate());

  const make = (overrides: MakeOverrides = {}): Product =>
    Product.create({
      id: toProductId(ids.generate()),
      vendorId,
      categoryId: overrides.categoryId ?? categoryId,
      name: overrides.name ?? 'Fresh Rohu Fish',
      brand: overrides.brand ?? null,
      description: overrides.description ?? null,
      hsnCode: overrides.hsnCode ?? null,
      countryOfOrigin: overrides.countryOfOrigin ?? null,
      netQuantity: overrides.netQuantity ?? null,
      attributeValues: overrides.attributeValues ?? {},
      now: NOW,
    });

  beforeAll(async () => {
    const stamp = Date.now();
    await db.user.create({
      data: { id: userId, email: `product-repo-${stamp}@example.com`, passwordHash: 'hashed:x' },
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
  });

  afterAll(async () => {
    await db.productVariant.deleteMany({ where: { vendorId } });
    await db.product.deleteMany({ where: { vendorId } });
    await db.category.deleteMany({ where: { id: categoryId } });
    await db.vendorProfile.deleteMany({ where: { id: vendorId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  describe('round trip', () => {
    it('stores and reads back every field', async () => {
      const product = make({
        brand: 'Ocean Fresh',
        description: 'Locally sourced river fish.',
        hsnCode: '0302',
        countryOfOrigin: 'IN',
        netQuantity: '1 kg',
        attributeValues: { freshness: 'daily-catch', isFarmRaised: false },
      });
      await repository.create(product);

      const found = await repository.findById(product.id);
      if (!found) throw new Error('expected the product to round-trip');

      expect(found.id).toBe(product.id);
      expect(found.vendorId).toBe(vendorId);
      expect(found.categoryId).toBe(categoryId);
      expect(found.name).toBe(product.name);
      expect(found.brand).toBe('Ocean Fresh');
      expect(found.hsnCode).toBe('0302');
      expect(found.countryOfOrigin).toBe('IN');
      expect(found.netQuantity).toBe('1 kg');
      expect(found.attributeValues).toEqual({ freshness: 'daily-catch', isFarmRaised: false });
      expect(found.status).toBe('DRAFT');
      expect(found.deletedAt).toBeNull();
    });

    it('defaults nullable statutory fields and attributeValues to their empty forms', async () => {
      const product = make();
      await repository.create(product);

      const found = await repository.findById(product.id);

      expect(found?.brand).toBeNull();
      expect(found?.hsnCode).toBeNull();
      expect(found?.attributeValues).toEqual({});
    });
  });

  describe('findById', () => {
    it('returns null for an id that was never created', async () => {
      await expect(repository.findById(toProductId(ids.generate()))).resolves.toBeNull();
    });
  });

  describe('database constraints (S2-3a)', () => {
    it('refuses a blank name at the database, independent of the domain check', async () => {
      // The domain entity already refuses this (see product.entity.test.ts);
      // this proves chk_products_name_not_blank is real, not merely intended.
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO products (id, vendor_id, category_id, name, attribute_values, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, '   ', '{}'::jsonb, now(), now())`,
          ids.generate(),
          vendorId,
          categoryId,
        ),
      ).rejects.toThrow(/chk_products_name_not_blank/);
    });

    it('refuses a product whose category does not exist', async () => {
      const product = make({ categoryId: toCategoryId(ids.generate()) });

      await expect(repository.create(product)).rejects.toThrow(/products_category_id_fkey/);
    });
  });
});
