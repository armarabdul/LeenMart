import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaClient } from '@prisma/client';
import { PrismaInventoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-inventory.repository.js';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductVariantRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-variant.repository.js';
import { PrismaCategoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category.repository.js';
import { Category } from '../../src/modules/catalogue/domain/entities/category.entity.js';
import { Inventory } from '../../src/modules/catalogue/domain/entities/inventory.entity.js';
import { Product } from '../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductVariant } from '../../src/modules/catalogue/domain/entities/product-variant.entity.js';
import { toCategoryId } from '../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import {
  toProductId,
  type ProductId,
} from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import {
  toProductVariantId,
  type ProductVariantId,
} from '../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import {
  toVendorId,
  type VendorId,
} from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const SLUG_PREFIX = 'inv-repo-cat-';
const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');

let seq = 0;

/**
 * Inventory against real PostgreSQL.
 *
 * The point of this suite is the half of the design that only exists in the
 * database: the three `CHECK` constraints SDD 14.4 leans on, the composite
 * foreign key that pins `vendor_id` to the variant's, and the version-guarded
 * conditional write — including the concurrent case, which is the one that
 * decides whether the guard is real.
 */
describe('PrismaInventoryRepository', () => {
  const db = new PrismaClient();
  const repository = new PrismaInventoryRepository(db);
  const products = new PrismaProductRepository(db);
  const variants = new PrismaProductVariantRepository(db);
  const categories = new PrismaCategoryRepository(db);

  const userA = toUserId(ids.generate());
  const userB = toUserId(ids.generate());
  const vendorA = toVendorId(ids.generate());
  const vendorB = toVendorId(ids.generate());
  const categoryId = toCategoryId(ids.generate());

  const seedVariant = async (
    vendorId: VendorId = vendorA,
  ): Promise<{ productId: ProductId; variantId: ProductVariantId }> => {
    const product = Product.create({
      id: toProductId(ids.generate()),
      vendorId,
      categoryId,
      name: `Product ${(seq += 1)}`,
      brand: null,
      description: null,
      hsnCode: null,
      countryOfOrigin: null,
      netQuantity: null,
      attributeValues: {},
      now: NOW,
    });
    await products.create(product);

    const variant = ProductVariant.create({
      id: toProductVariantId(ids.generate()),
      productId: product.id,
      vendorId,
      sku: `INV-REPO-${(seq += 1)}`,
      name: 'Default',
      price: Money.fromMinor(19900n, 'INR'),
      unitOfMeasure: 'per kg',
      quantityStep: 250,
      now: NOW,
    });
    await variants.create(variant);
    await repository.create(Inventory.initial({ variantId: variant.id, vendorId, now: NOW }));

    return { productId: product.id, variantId: variant.id };
  };

  beforeAll(async () => {
    const stamp = Date.now();
    await db.user.createMany({
      data: [
        { id: userA, email: `inv-repo-a-${stamp}@example.com`, passwordHash: 'hashed:x' },
        { id: userB, email: `inv-repo-b-${stamp}@example.com`, passwordHash: 'hashed:x' },
      ],
    });
    await db.vendorProfile.createMany({
      data: [
        { id: vendorA, userId: userA, status: 'REGISTERED', createdAt: NOW, updatedAt: NOW },
        { id: vendorB, userId: userB, status: 'REGISTERED', createdAt: NOW, updatedAt: NOW },
      ],
    });
    const slug = `${SLUG_PREFIX}${stamp}`;
    await categories.create(
      Category.create({
        id: categoryId,
        parent: null,
        name: slug,
        slug: toCategorySlug(slug),
        riskLevel: CategoryRiskLevel.LOW,
        requirements: {
          requiresHsn: false,
          requiresCountryOfOrigin: false,
          requiresNetQuantity: false,
        },
        now: NOW,
      }),
    );
  });

  afterAll(async () => {
    await db.inventory.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await db.productVariant.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await db.product.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await db.vendorProfile.deleteMany({ where: { id: { in: [vendorA, vendorB] } } });
    await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await db.category.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
    await db.$disconnect();
  });

  describe('round trip', () => {
    it('stores and reads back a counter scoped by product and variant', async () => {
      const { productId, variantId } = await seedVariant();

      const found = await repository.findByProductAndVariant(productId, variantId);

      expect(found?.variantId).toBe(variantId);
      expect(found?.vendorId).toBe(vendorA);
      expect(found?.available).toBe(0);
      expect(found?.reserved).toBe(0);
      expect(found?.version).toBe(1);
    });

    it('returns null for a variant addressed under the wrong product', async () => {
      const owner = await seedVariant();
      const other = await seedVariant();

      expect(await repository.findByProductAndVariant(other.productId, owner.variantId)).toBeNull();
    });

    it('hides a counter whose variant is soft-deleted', async () => {
      const { productId, variantId } = await seedVariant();
      await db.productVariant.update({ where: { id: variantId }, data: { deletedAt: LATER } });

      expect(await repository.findByProductAndVariant(productId, variantId)).toBeNull();
    });
  });

  describe('database constraints', () => {
    const rawInsert = (variantId: string, vendorId: string, values: string): Promise<number> =>
      db.$executeRawUnsafe(
        `INSERT INTO inventory (variant_id, vendor_id, available, reserved, version, created_at, updated_at)
         VALUES ('${variantId}', '${vendorId}', ${values}, now(), now())`,
      );

    it('refuses negative available — the constraint SDD 14.4 names', async () => {
      const { variantId } = await seedVariant();
      await db.inventory.delete({ where: { variantId } });

      await expect(rawInsert(variantId, vendorA, '-1, 0, 1')).rejects.toThrow(
        /chk_inventory_available_non_negative/,
      );
    });

    it('refuses negative reserved', async () => {
      const { variantId } = await seedVariant();
      await db.inventory.delete({ where: { variantId } });

      await expect(rawInsert(variantId, vendorA, '0, -1, 1')).rejects.toThrow(
        /chk_inventory_reserved_non_negative/,
      );
    });

    it('refuses a version below one', async () => {
      const { variantId } = await seedVariant();
      await db.inventory.delete({ where: { variantId } });

      await expect(rawInsert(variantId, vendorA, '0, 0, 0')).rejects.toThrow(
        /chk_inventory_version_positive/,
      );
    });

    it('refuses a second counter for the same variant', async () => {
      const { variantId } = await seedVariant();

      // PostgreSQL reports the primary-key violation by column rather than by
      // constraint name (SQLSTATE 23505).
      await expect(rawInsert(variantId, vendorA, '0, 0, 1')).rejects.toThrow(
        /\(variant_id\).*already exists/i,
      );
    });

    it('refuses a counter whose vendor does not match its variant’s', async () => {
      const { variantId } = await seedVariant(vendorA);
      await db.inventory.delete({ where: { variantId } });

      // The composite foreign key is what makes this impossible in the
      // database rather than merely unlikely in code.
      await expect(rawInsert(variantId, vendorB, '0, 0, 1')).rejects.toThrow(
        /inventory_variant_id_vendor_id_fkey|foreign key/i,
      );
    });

    it('refuses a counter for a variant that does not exist', async () => {
      await expect(rawInsert(ids.generate(), vendorA, '0, 0, 1')).rejects.toThrow(
        /inventory_variant_id_vendor_id_fkey|foreign key/i,
      );
    });

    it('refuses removing a variant while its counter still exists', async () => {
      const { variantId } = await seedVariant();

      // `Restrict`, so the use cases must remove the counter in the same
      // transaction rather than relying on a cascade.
      await expect(db.productVariant.delete({ where: { id: variantId } })).rejects.toThrow(
        /foreign key|Restrict/i,
      );
    });
  });

  describe('version-guarded write', () => {
    it('lands when the version matches, and advances it', async () => {
      const { productId, variantId } = await seedVariant();
      const current = await repository.findByProductAndVariant(productId, variantId);

      expect(await repository.setIfVersionMatches(current!.set(25, LATER), 1)).toBe(true);

      const after = await repository.findByProductAndVariant(productId, variantId);
      expect(after?.available).toBe(25);
      expect(after?.version).toBe(2);
    });

    it('is refused when the version is stale, and changes nothing', async () => {
      const { productId, variantId } = await seedVariant();
      const current = await repository.findByProductAndVariant(productId, variantId);
      await repository.setIfVersionMatches(current!.set(10, LATER), 1);

      expect(await repository.setIfVersionMatches(current!.set(99, LATER), 1)).toBe(false);

      expect((await repository.findByProductAndVariant(productId, variantId))?.available).toBe(10);
    });

    it('lets exactly one of two concurrent writers win', async () => {
      const { productId, variantId } = await seedVariant();
      const current = await repository.findByProductAndVariant(productId, variantId);

      // Both read version 1 and both write against it. The conditional
      // `WHERE version = 1` is the arbiter — without it the second would
      // silently overwrite the first.
      const results = await Promise.all([
        repository.setIfVersionMatches(current!.set(100, LATER), 1),
        repository.setIfVersionMatches(current!.set(200, LATER), 1),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      const after = await repository.findByProductAndVariant(productId, variantId);
      expect([100, 200]).toContain(after?.available);
      expect(after?.version).toBe(2);
    });

    it('keeps a single writer’s sequential updates monotonic', async () => {
      const { productId, variantId } = await seedVariant();

      for (let expected = 1; expected <= 5; expected += 1) {
        const current = await repository.findByProductAndVariant(productId, variantId);
        expect(current?.version).toBe(expected);
        expect(
          await repository.setIfVersionMatches(current!.set(expected * 10, LATER), expected),
        ).toBe(true);
      }

      expect((await repository.findByProductAndVariant(productId, variantId))?.version).toBe(6);
    });
  });

  describe('removal', () => {
    it('deletes counters for the named variants only', async () => {
      const target = await seedVariant();
      const bystander = await seedVariant();

      expect(await repository.deleteForVariants([target.variantId])).toBe(1);

      expect(await db.inventory.findUnique({ where: { variantId: target.variantId } })).toBeNull();
      expect(
        await db.inventory.findUnique({ where: { variantId: bystander.variantId } }),
      ).not.toBeNull();
    });

    it('is a no-op for an empty list', async () => {
      expect(await repository.deleteForVariants([])).toBe(0);
    });

    it('deletes every counter belonging to one product', async () => {
      const { productId, variantId } = await seedVariant();
      const second = ProductVariant.create({
        id: toProductVariantId(ids.generate()),
        productId,
        vendorId: vendorA,
        sku: `INV-REPO-${(seq += 1)}`,
        name: 'Extra',
        price: Money.fromMinor(1000n, 'INR'),
        unitOfMeasure: 'per piece',
        quantityStep: 1,
        now: NOW,
      });
      await variants.create(second);
      await repository.create(
        Inventory.initial({ variantId: second.id, vendorId: vendorA, now: NOW }),
      );

      expect(await repository.deleteForProduct(productId)).toBe(2);
      expect(await db.inventory.findUnique({ where: { variantId } })).toBeNull();
    });
  });
});
