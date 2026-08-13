import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductVariantRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-variant.repository.js';
import { Product } from '../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductVariant } from '../../src/modules/catalogue/domain/entities/product-variant.entity.js';
import { Category } from '../../src/modules/catalogue/domain/entities/category.entity.js';
import { ProductVariantSkuConflictError } from '../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { PrismaCategoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category.repository.js';
import { CategoryRiskLevel } from '../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategoryId } from '../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toCategorySlug } from '../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import { toProductId } from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import {
  toVendorId,
  type VendorId,
} from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const SLUG_PREFIX = 'variant-repo-cat-';
const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');

const NO_REQUIREMENTS = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

interface MakeOverrides {
  readonly sku?: string;
  readonly name?: string;
  readonly price?: Money;
  readonly unitOfMeasure?: string;
  readonly quantityStep?: number;
  readonly vendorId?: VendorId;
}

/**
 * Repository-level integration test against real PostgreSQL, following
 * `prisma-product.repository.test.ts` (correctness here; RLS proof in
 * `product-rls-isolation.test.ts`).
 */
describe('PrismaProductVariantRepository', () => {
  const db = new PrismaClient();
  const productRepository = new PrismaProductRepository(db);
  const variantRepository = new PrismaProductVariantRepository(db);
  const categoryRepository = new PrismaCategoryRepository(db);

  const userId = toUserId(ids.generate());
  const vendorId = toVendorId(ids.generate());
  const categoryId = toCategoryId(ids.generate());
  let productId: ReturnType<typeof toProductId>;

  const make = (overrides: MakeOverrides = {}): ProductVariant =>
    ProductVariant.create({
      id: toProductVariantId(ids.generate()),
      productId,
      vendorId: overrides.vendorId ?? vendorId,
      sku: overrides.sku ?? `SKU-${ids.generate()}`,
      name: overrides.name ?? '1 kg pack',
      price: overrides.price ?? Money.fromMajor(199),
      unitOfMeasure: overrides.unitOfMeasure ?? 'kg',
      quantityStep: overrides.quantityStep ?? 1,
      now: NOW,
    });

  beforeAll(async () => {
    const stamp = Date.now();
    await db.user.create({
      data: { id: userId, email: `variant-repo-${stamp}@example.com`, passwordHash: 'hashed:x' },
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
    await db.productVariant.deleteMany({ where: { vendorId } });
    await db.product.deleteMany({ where: { vendorId } });
    await db.category.deleteMany({ where: { id: categoryId } });
    await db.vendorProfile.deleteMany({ where: { id: vendorId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  describe('round trip', () => {
    it('stores and reads back every field, price included', async () => {
      const variant = make({ sku: 'ROHU-1KG', name: '1 kg pack', price: Money.fromMajor(249) });
      await variantRepository.create(variant);

      const found = await variantRepository.findById(variant.id);
      if (!found) throw new Error('expected the variant to round-trip');

      expect(found.id).toBe(variant.id);
      expect(found.productId).toBe(productId);
      expect(found.vendorId).toBe(vendorId);
      expect(found.sku).toBe('ROHU-1KG');
      expect(found.name).toBe('1 kg pack');
      expect(found.price.amountMinor).toBe(24900n);
      expect(found.price.currency).toBe('INR');
      expect(found.unitOfMeasure).toBe('kg');
      expect(found.quantityStep).toBe(1);
      expect(found.deletedAt).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns null for an id that was never created', async () => {
      await expect(
        variantRepository.findById(toProductVariantId(ids.generate())),
      ).resolves.toBeNull();
    });
  });

  describe('SKU uniqueness (S2-3 D-5)', () => {
    it('refuses a second live variant with the same SKU for the same vendor', async () => {
      const first = make({ sku: 'DUP-SKU' });
      await variantRepository.create(first);

      const clash = make({ sku: 'DUP-SKU' });
      await expect(variantRepository.create(clash)).rejects.toBeInstanceOf(
        ProductVariantSkuConflictError,
      );
    });

    it('allows two different vendors to use the same SKU', async () => {
      const otherStamp = Date.now();
      const otherUserId = toUserId(ids.generate());
      const otherVendorId = toVendorId(ids.generate());
      await db.user.create({
        data: {
          id: otherUserId,
          email: `variant-repo-other-${otherStamp}@example.com`,
          passwordHash: 'hashed:x',
        },
      });
      await db.vendorProfile.create({
        data: {
          id: otherVendorId,
          userId: otherUserId,
          status: 'REGISTERED',
          createdAt: NOW,
          updatedAt: NOW,
        },
      });
      const otherProduct = Product.create({
        id: toProductId(ids.generate()),
        vendorId: otherVendorId,
        categoryId,
        name: 'Another vendor’s product',
        brand: null,
        description: null,
        hsnCode: null,
        countryOfOrigin: null,
        netQuantity: null,
        attributeValues: {},
        now: NOW,
      });
      await productRepository.create(otherProduct);

      const mine = make({ sku: 'SHARED-SKU' });
      await variantRepository.create(mine);
      const theirs = ProductVariant.create({
        id: toProductVariantId(ids.generate()),
        productId: otherProduct.id,
        vendorId: otherVendorId,
        sku: 'SHARED-SKU',
        name: 'Their pack',
        price: Money.fromMajor(99),
        unitOfMeasure: 'kg',
        quantityStep: 1,
        now: NOW,
      });

      await expect(variantRepository.create(theirs)).resolves.toBeUndefined();

      await db.productVariant.deleteMany({ where: { vendorId: otherVendorId } });
      await db.product.deleteMany({ where: { vendorId: otherVendorId } });
      await db.vendorProfile.deleteMany({ where: { id: otherVendorId } });
      await db.user.deleteMany({ where: { id: otherUserId } });
    });
  });

  describe('composite foreign key integrity (S2-3a)', () => {
    it('refuses a variant whose vendor_id does not match its product’s own vendor_id', async () => {
      // Proves uq_products_id_vendor + the composite FK actually constrain
      // this — not merely that the domain layer always supplies a matching
      // pair. A vendor cannot be swapped in underneath an existing product id.
      const mismatched = ids.generate();
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO product_variants (id, product_id, vendor_id, sku, name, price_amount, price_currency, unit_of_measure, quantity_step, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'MISMATCH', 'x', 100, 'INR', 'kg', 1, now(), now())`,
          ids.generate(),
          productId,
          mismatched,
        ),
      ).rejects.toThrow(/product_variants_product_id_vendor_id_fkey/);
    });
  });

  describe('database constraints (S2-3a)', () => {
    it('refuses a non-positive quantity_step at the database', async () => {
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO product_variants (id, product_id, vendor_id, sku, name, price_amount, price_currency, unit_of_measure, quantity_step, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'BAD-STEP', 'x', 100, 'INR', 'kg', 0, now(), now())`,
          ids.generate(),
          productId,
          vendorId,
        ),
      ).rejects.toThrow(/chk_product_variants_quantity_step_positive/);
    });

    it('refuses a negative price at the database', async () => {
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO product_variants (id, product_id, vendor_id, sku, name, price_amount, price_currency, unit_of_measure, quantity_step, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'BAD-PRICE', 'x', -1, 'INR', 'kg', 1, now(), now())`,
          ids.generate(),
          productId,
          vendorId,
        ),
      ).rejects.toThrow(/chk_product_variants_price_non_negative/);
    });

    it('refuses a blank sku at the database', async () => {
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO product_variants (id, product_id, vendor_id, sku, name, price_amount, price_currency, unit_of_measure, quantity_step, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, '   ', 'x', 100, 'INR', 'kg', 1, now(), now())`,
          ids.generate(),
          productId,
          vendorId,
        ),
      ).rejects.toThrow(/chk_product_variants_sku_not_blank/);
    });

    it('refuses a blank unit_of_measure at the database', async () => {
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO product_variants (id, product_id, vendor_id, sku, name, price_amount, price_currency, unit_of_measure, quantity_step, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'BAD-UOM', 'x', 100, 'INR', '   ', 1, now(), now())`,
          ids.generate(),
          productId,
          vendorId,
        ),
      ).rejects.toThrow(/chk_product_variants_unit_of_measure_not_blank/);
    });
  });
});
