import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaClient } from '@prisma/client';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductVariantRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-variant.repository.js';
import { PrismaCategoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category.repository.js';
import { Category } from '../../src/modules/catalogue/domain/entities/category.entity.js';
import { Product } from '../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductVariant } from '../../src/modules/catalogue/domain/entities/product-variant.entity.js';
import { ProductVariantSkuConflictError } from '../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { toCategoryId } from '../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import {
  toProductId,
  type ProductId,
} from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import {
  toVendorId,
  type VendorId,
} from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const SLUG_PREFIX = 'product-mut-cat-';
const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');

let seq = 0;

/**
 * The S2-3b repository methods against real PostgreSQL.
 *
 * Run on the owner connection, like `prisma-product.repository.test.ts` — RLS
 * lives in `product-rls-isolation.test.ts`, the same split S2-3a established.
 * What this proves is the half of the design that only exists in the database:
 * the `(vendor_id, sku)` unique index, soft-delete filtering on every read,
 * keyset pagination, and the composite foreign key that pins a variant's
 * vendor to its product's.
 */
describe('product and variant repository mutations (S2-3b)', () => {
  const db = new PrismaClient();
  const repository = new PrismaProductRepository(db);
  const variants = new PrismaProductVariantRepository(db);
  const categories = new PrismaCategoryRepository(db);

  const userA = toUserId(ids.generate());
  const userB = toUserId(ids.generate());
  const vendorA = toVendorId(ids.generate());
  const vendorB = toVendorId(ids.generate());
  const categoryId = toCategoryId(ids.generate());

  const makeProduct = (vendorId: VendorId = vendorA): Product =>
    Product.create({
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

  const makeVariant = (
    productId: ProductId,
    vendorId: VendorId = vendorA,
    sku = `SKU-${(seq += 1)}`,
    now = NOW,
  ): ProductVariant =>
    ProductVariant.create({
      id: toProductVariantId(ids.generate()),
      productId,
      vendorId,
      sku,
      name: 'Default',
      price: Money.fromMinor(19900n, 'INR'),
      unitOfMeasure: 'per kg',
      quantityStep: 250,
      now,
    });

  const persistProduct = async (vendorId: VendorId = vendorA): Promise<Product> => {
    const product = makeProduct(vendorId);
    await repository.create(product);
    return product;
  };

  beforeAll(async () => {
    const stamp = Date.now();
    await db.user.createMany({
      data: [
        { id: userA, email: `product-mut-a-${stamp}@example.com`, passwordHash: 'hashed:x' },
        { id: userB, email: `product-mut-b-${stamp}@example.com`, passwordHash: 'hashed:x' },
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
    await db.productVariant.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await db.product.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await db.vendorProfile.deleteMany({ where: { id: { in: [vendorA, vendorB] } } });
    await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await db.category.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
    await db.$disconnect();
  });

  describe('product update', () => {
    it('persists an edit and leaves ownership and identity alone', async () => {
      const product = await persistProduct();

      expect(await repository.update(product.updateDetails({ name: 'Renamed' }, LATER))).toBe(true);

      const found = await repository.findById(product.id);
      expect(found?.name).toBe('Renamed');
      expect(found?.vendorId).toBe(vendorA);
      expect(found?.id).toBe(product.id);
    });

    it('reports false for a product already soft-deleted', async () => {
      const product = await persistProduct();
      await repository.softDelete(product.softDelete(LATER));

      expect(await repository.update(product.updateDetails({ name: 'x' }, LATER))).toBe(false);
    });
  });

  describe('product soft delete', () => {
    it('hides the product from every read but keeps the row', async () => {
      const product = await persistProduct();

      expect(await repository.softDelete(product.softDelete(LATER))).toBe(true);
      expect(await repository.findById(product.id)).toBeNull();
      expect(await db.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    });

    it('reports false the second time, so a lost race is visible', async () => {
      const product = await persistProduct();
      await repository.softDelete(product.softDelete(LATER));

      expect(await repository.softDelete(product.softDelete(LATER))).toBe(false);
    });
  });

  describe('lockForVariantChange', () => {
    it('reports true for a live product and false for a deleted one', async () => {
      const product = await persistProduct();

      expect(await repository.lockForVariantChange(product.id, LATER)).toBe(true);

      await repository.softDelete(product.softDelete(LATER));
      expect(await repository.lockForVariantChange(product.id, LATER)).toBe(false);
    });

    it('reports false for a product that never existed', async () => {
      expect(await repository.lockForVariantChange(toProductId(ids.generate()), LATER)).toBe(false);
    });
  });

  describe('pagination', () => {
    it('pages without repeating or skipping a row', async () => {
      const created = [await persistProduct(), await persistProduct(), await persistProduct()];
      const createdIds = new Set(created.map((product) => product.id));

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 30; guard += 1) {
        const page = await repository.listPage({ limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...page.items.map((item) => item.id).filter((id) => createdIds.has(id)));
        if (!page.hasMore) break;
        cursor = page.nextCursor ?? undefined;
      }

      expect(new Set(seen).size).toBe(seen.length);
      expect(new Set(seen)).toEqual(createdIds);
    });

    it('excludes soft-deleted products', async () => {
      const product = await persistProduct();
      await repository.softDelete(product.softDelete(LATER));

      const page = await repository.listPage({ limit: 100 });

      expect(page.items.map((item) => item.id)).not.toContain(product.id);
    });
  });

  describe('variant SKU uniqueness', () => {
    it('refuses a duplicate SKU for the same vendor', async () => {
      const product = await persistProduct();
      const first = makeVariant(product.id, vendorA, 'DUP-SKU-1');
      await variants.create(first);

      await expect(
        variants.create(makeVariant(product.id, vendorA, 'DUP-SKU-1')),
      ).rejects.toBeInstanceOf(ProductVariantSkuConflictError);
    });

    it('allows the same SKU for two different vendors', async () => {
      const productA = await persistProduct(vendorA);
      const productB = await persistProduct(vendorB);
      await variants.create(makeVariant(productA.id, vendorA, 'SHARED-SKU'));

      // SDD 6.4: unique to the vendor, never globally.
      await expect(
        variants.create(makeVariant(productB.id, vendorB, 'SHARED-SKU')),
      ).resolves.toBeUndefined();
    });

    it('keeps the SKU reserved after a soft delete', async () => {
      // Unlike `categories.slug`, `uq_product_variants_vendor_sku` is a full
      // index rather than a partial one — S2-3a's decision, recorded here so
      // the behaviour is asserted rather than assumed.
      const product = await persistProduct();
      const first = makeVariant(product.id, vendorA, 'HELD-SKU');
      await variants.create(first);
      await variants.softDelete(first.softDelete(LATER));

      await expect(
        variants.create(makeVariant(product.id, vendorA, 'HELD-SKU')),
      ).rejects.toBeInstanceOf(ProductVariantSkuConflictError);
    });
  });

  describe('variant scoping and listing', () => {
    it('finds a variant only under its own product', async () => {
      const owner = await persistProduct();
      const other = await persistProduct();
      const created = makeVariant(owner.id);
      await variants.create(created);

      expect((await variants.findByProductAndId(owner.id, created.id))?.id).toBe(created.id);
      expect(await variants.findByProductAndId(other.id, created.id)).toBeNull();
    });

    it('lists a product’s live variants oldest first', async () => {
      const product = await persistProduct();
      const first = makeVariant(product.id, vendorA, undefined, NOW);
      const second = makeVariant(product.id, vendorA, undefined, LATER);
      await variants.create(first);
      await variants.create(second);

      expect((await variants.listByProductId(product.id)).map((row) => row.id)).toEqual([
        first.id,
        second.id,
      ]);
    });

    it('excludes soft-deleted variants and counts only the live ones', async () => {
      const product = await persistProduct();
      const kept = makeVariant(product.id);
      const removed = makeVariant(product.id);
      await variants.create(kept);
      await variants.create(removed);
      await variants.softDelete(removed.softDelete(LATER));

      expect((await variants.listByProductId(product.id)).map((row) => row.id)).toEqual([kept.id]);
      expect(await variants.countLiveForProduct(product.id)).toBe(1);
    });

    it('clears every live variant of one product and leaves another product’s alone', async () => {
      const target = await persistProduct();
      const bystander = await persistProduct();
      await variants.create(makeVariant(target.id));
      await variants.create(makeVariant(target.id));
      const untouched = makeVariant(bystander.id);
      await variants.create(untouched);

      expect(await variants.softDeleteAllForProduct(target.id, LATER)).toBe(2);
      expect(await variants.listByProductId(target.id)).toEqual([]);
      expect((await variants.listByProductId(bystander.id)).map((row) => row.id)).toEqual([
        untouched.id,
      ]);
    });

    it('persists a variant edit without touching its SKU', async () => {
      const product = await persistProduct();
      const created = makeVariant(product.id);
      await variants.create(created);

      const edited = created.updateDetails(
        { name: 'Renamed', price: Money.fromMinor(50000n, 'INR') },
        LATER,
      );
      expect(await variants.update(edited)).toBe(true);

      const found = await variants.findByProductAndId(product.id, created.id);
      expect(found?.name).toBe('Renamed');
      expect(found?.price.amountMinor).toBe(50000n);
      expect(found?.sku).toBe(created.sku);
    });
  });

  describe('composite foreign key (S2-3a guarantee preserved)', () => {
    it('refuses a variant whose vendor does not match its product’s', async () => {
      const product = await persistProduct(vendorA);

      // `(product_id, vendor_id) -> products(id, vendor_id)` is what makes this
      // impossible in the database rather than merely unlikely in code.
      await expect(variants.create(makeVariant(product.id, vendorB))).rejects.toThrow(
        /product_variants_product_id_vendor_id_fkey|foreign key/i,
      );
    });
  });
});
