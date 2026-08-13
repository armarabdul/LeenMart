import { describe, expect, it, vi } from 'vitest';
import { FixedClock, Money, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../../../src/modules/audit/index.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../../../../src/modules/catalogue/domain/audit-actions.js';
import { UpdateProductUseCase } from '../../../../../src/modules/catalogue/application/use-cases/update-product.use-case.js';
import { DeleteProductUseCase } from '../../../../../src/modules/catalogue/application/use-cases/delete-product.use-case.js';
import { GetProductUseCase } from '../../../../../src/modules/catalogue/application/use-cases/get-product.use-case.js';
import { ListProductsUseCase } from '../../../../../src/modules/catalogue/application/use-cases/list-products.use-case.js';
import { AddProductVariantUseCase } from '../../../../../src/modules/catalogue/application/use-cases/add-product-variant.use-case.js';
import { UpdateProductVariantUseCase } from '../../../../../src/modules/catalogue/application/use-cases/update-product-variant.use-case.js';
import { GetProductVariantUseCase } from '../../../../../src/modules/catalogue/application/use-cases/get-product-variant.use-case.js';
import { ListProductVariantsUseCase } from '../../../../../src/modules/catalogue/application/use-cases/list-product-variants.use-case.js';
import { RemoveProductVariantUseCase } from '../../../../../src/modules/catalogue/application/use-cases/remove-product-variant.use-case.js';
import {
  CategoryNotFoundError,
  ProductLastVariantError,
  ProductNotFoundError,
  ProductVariantNotFoundError,
} from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { Category } from '../../../../../src/modules/catalogue/domain/entities/category.entity.js';
import { Product } from '../../../../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductVariant } from '../../../../../src/modules/catalogue/domain/entities/product-variant.entity.js';
import type { CategoryRepository } from '../../../../../src/modules/catalogue/domain/repositories/category.repository.js';
import type { ProductRepository } from '../../../../../src/modules/catalogue/domain/repositories/product.repository.js';
import type { InventoryRepository } from '../../../../../src/modules/catalogue/domain/repositories/inventory.repository.js';
import type { ProductVariantRepository } from '../../../../../src/modules/catalogue/domain/repositories/product-variant.repository.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../../../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../../../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { FailingAuditWriter, RecordingAuditWriter } from '../../identity/application/fakes.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const vendorId = toVendorId(ids.generate());
const categoryId = toCategoryId(ids.generate());
const principal: Principal = {
  userId: toUserId(ids.generate()),
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};

let seq = 0;

const category = (): Category =>
  Category.create({
    id: categoryId,
    parent: null,
    name: `Category ${(seq += 1)}`,
    slug: toCategorySlug(`category-${seq}`),
    riskLevel: CategoryRiskLevel.LOW,
    requirements: {
      requiresHsn: false,
      requiresCountryOfOrigin: false,
      requiresNetQuantity: false,
    },
    now: NOW,
  });

const product = (): Product =>
  Product.create({
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

const variant = (productId = toProductId(ids.generate())): ProductVariant =>
  ProductVariant.create({
    id: toProductVariantId(ids.generate()),
    productId,
    vendorId,
    sku: `SKU-${(seq += 1)}`,
    name: 'Default',
    price: Money.fromMinor(19900n, 'INR'),
    unitOfMeasure: 'per kg',
    quantityStep: 250,
    now: NOW,
  });

const runner = (onRollback?: () => void): TransactionRunner => ({
  run: async (work) => {
    try {
      return await work({} as TransactionScope);
    } catch (error) {
      onRollback?.();
      throw error;
    }
  },
});

const productRepo = (overrides: Partial<ProductRepository> = {}): ProductRepository => {
  const repository: ProductRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(true),
    listPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    softDelete: vi.fn().mockResolvedValue(true),
    lockForVariantChange: vi.fn().mockResolvedValue(true),
    submitForReviewIfEligible: vi.fn().mockResolvedValue(true),
    decideIfPendingReview: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

const variantRepo = (
  overrides: Partial<ProductVariantRepository> = {},
): ProductVariantRepository => {
  const repository: ProductVariantRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    findByProductAndId: vi.fn().mockResolvedValue(null),
    listByProductId: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(true),
    countLiveForProduct: vi.fn().mockResolvedValue(2),
    softDelete: vi.fn().mockResolvedValue(true),
    softDeleteAllForProduct: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

const inventoryRepo = (overrides: Partial<InventoryRepository> = {}): InventoryRepository => {
  const repository: InventoryRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByProductAndVariant: vi.fn().mockResolvedValue(null),
    setIfVersionMatches: vi.fn().mockResolvedValue(true),
    deleteForVariants: vi.fn().mockResolvedValue(0),
    deleteForProduct: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

const categoryRepo = (found: Category | null): CategoryRepository => {
  const repository: CategoryRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    updateMany: vi.fn(),
    findById: vi.fn().mockResolvedValue(found),
    findBySlug: vi.fn().mockResolvedValue(null),
    findDescendants: vi.fn().mockResolvedValue([]),
    listPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    softDeleteIfEmpty: vi.fn().mockResolvedValue(true),
    findAllActive: vi.fn().mockResolvedValue([]),
    findChildren: vi.fn().mockResolvedValue([]),
  };
  return repository;
};

const base = (
  auditWriter: AuditWriter = new RecordingAuditWriter(),
  onRollback?: () => void,
): {
  transactionRunner: TransactionRunner;
  auditWriter: AuditWriter;
  clock: FixedClock;
  logger: NullLogger;
} => ({
  transactionRunner: runner(onRollback),
  auditWriter,
  clock,
  logger: new NullLogger(),
});

describe('UpdateProductUseCase', () => {
  const build = (
    products: ProductRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
    found: Category | null = category(),
  ): UpdateProductUseCase =>
    new UpdateProductUseCase({
      ...base(auditWriter),
      productRepository: products,
      categoryRepository: categoryRepo(found),
    });

  it('applies only the supplied fields', async () => {
    const existing = product();

    const { product: updated } = await build(
      productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
    ).execute({ principal, productId: existing.id, changes: { name: 'Renamed' } });

    expect(updated.name).toBe('Renamed');
    expect(updated.categoryId).toBe(existing.categoryId);
  });

  it('is not found for an unknown product', async () => {
    await expect(
      build(productRepo()).execute({
        principal,
        productId: toProductId(ids.generate()),
        changes: {},
      }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('is not found when the row vanishes between the read and the write', async () => {
    const existing = product();
    const products = productRepo({
      findById: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue(false),
    });

    await expect(
      build(products).execute({ principal, productId: existing.id, changes: { name: 'x' } }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('refuses a move to a category that does not exist, before any write', async () => {
    const existing = product();
    const products = productRepo({ findById: vi.fn().mockResolvedValue(existing) });

    await expect(
      build(products, new RecordingAuditWriter(), null).execute({
        principal,
        productId: existing.id,
        changes: { categoryId: toCategoryId(ids.generate()) },
      }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
    expect(products.update).not.toHaveBeenCalled();
  });

  it('writes no audit entry when the request changes nothing', async () => {
    const existing = product();
    const auditWriter = new RecordingAuditWriter();

    await build(
      productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
      auditWriter,
    ).execute({ principal, productId: existing.id, changes: {} });

    expect(auditWriter.entries).toEqual([]);
  });

  it('records the update with the actor from the principal', async () => {
    const existing = product();
    const auditWriter = new RecordingAuditWriter();

    await build(
      productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
      auditWriter,
    ).execute({ principal, productId: existing.id, changes: { name: 'Audited' } });

    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_UPDATED);
    expect(auditWriter.entries[0]?.actorId).toBe(principal.userId);
  });

  it('rolls the write back when the audit fails', async () => {
    const rolledBack = vi.fn();
    const existing = product();
    const useCase = new UpdateProductUseCase({
      ...base(new FailingAuditWriter(), rolledBack),
      productRepository: productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
      categoryRepository: categoryRepo(category()),
    });

    await expect(
      useCase.execute({ principal, productId: existing.id, changes: { name: 'x' } }),
    ).rejects.toThrow(/audit/i);
    expect(rolledBack).toHaveBeenCalledTimes(1);
  });
});

describe('DeleteProductUseCase', () => {
  const build = (
    products: ProductRepository,
    variants: ProductVariantRepository = variantRepo(),
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): DeleteProductUseCase =>
    new DeleteProductUseCase({
      ...base(auditWriter),
      productRepository: products,
      productVariantRepository: variants,
      inventoryRepository: inventoryRepo(),
    });

  it('soft-deletes the product and its variants at the same instant', async () => {
    const existing = product();
    const variants = variantRepo({ softDeleteAllForProduct: vi.fn().mockResolvedValue(3) });

    const { variantsRemoved } = await build(
      productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
      variants,
    ).execute({ principal, productId: existing.id });

    expect(variantsRemoved).toBe(3);
    expect(variants.softDeleteAllForProduct).toHaveBeenCalledWith(existing.id, NOW);
  });

  it('touches no variant when the conditional product delete loses', async () => {
    const existing = product();
    const variants = variantRepo();
    const products = productRepo({
      findById: vi.fn().mockResolvedValue(existing),
      softDelete: vi.fn().mockResolvedValue(false),
    });

    await expect(
      build(products, variants).execute({ principal, productId: existing.id }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
    expect(variants.softDeleteAllForProduct).not.toHaveBeenCalled();
  });

  it('records how many variants went with it', async () => {
    const existing = product();
    const auditWriter = new RecordingAuditWriter();

    await build(
      productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
      variantRepo({ softDeleteAllForProduct: vi.fn().mockResolvedValue(2) }),
      auditWriter,
    ).execute({ principal, productId: existing.id });

    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_DELETED);
    expect(auditWriter.entries[0]?.before).toMatchObject({ variantsRemoved: 2 });
  });
});

describe('AddProductVariantUseCase', () => {
  const build = (
    products: ProductRepository,
    variants: ProductVariantRepository = variantRepo(),
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): AddProductVariantUseCase =>
    new AddProductVariantUseCase({
      ...base(auditWriter),
      productRepository: products,
      productVariantRepository: variants,
      inventoryRepository: inventoryRepo(),
      idGenerator: ids,
    });

  const input = (
    productId: ReturnType<typeof toProductId>,
  ): Parameters<AddProductVariantUseCase['execute']>[0] => ({
    principal,
    productId,
    sku: 'SKU-NEW',
    name: 'Extra',
    price: Money.fromMinor(29900n, 'INR'),
    unitOfMeasure: 'per piece',
    quantityStep: 1,
  });

  it('takes the vendor from the product, never the request', async () => {
    const parent = product();

    const { variant: created } = await build(
      productRepo({ findById: vi.fn().mockResolvedValue(parent) }),
    ).execute(input(parent.id));

    expect(created.vendorId).toBe(parent.vendorId);
    expect(created.productId).toBe(parent.id);
  });

  it('locks the parent before anything else', async () => {
    const parent = product();
    const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });

    await build(products).execute(input(parent.id));

    expect(products.lockForVariantChange).toHaveBeenCalledWith(parent.id, NOW);
  });

  it('is not found when the product is gone, and creates nothing', async () => {
    const variants = variantRepo();
    const products = productRepo({ lockForVariantChange: vi.fn().mockResolvedValue(false) });

    await expect(
      build(products, variants).execute(input(toProductId(ids.generate()))),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
    expect(variants.create).not.toHaveBeenCalled();
  });

  it('records the addition against the product', async () => {
    const parent = product();
    const auditWriter = new RecordingAuditWriter();

    await build(
      productRepo({ findById: vi.fn().mockResolvedValue(parent) }),
      variantRepo(),
      auditWriter,
    ).execute(input(parent.id));

    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_VARIANT_ADDED);
    expect(auditWriter.entries[0]?.entityId).toBe(parent.id);
  });
});

describe('RemoveProductVariantUseCase', () => {
  const build = (
    products: ProductRepository,
    variants: ProductVariantRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): RemoveProductVariantUseCase =>
    new RemoveProductVariantUseCase({
      ...base(auditWriter),
      productRepository: products,
      productVariantRepository: variants,
      inventoryRepository: inventoryRepo(),
    });

  it('locks the parent product before reading or counting anything', async () => {
    const parent = product();
    const existing = variant(parent.id);
    const products = productRepo();
    const variants = variantRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) });

    await build(products, variants).execute({
      principal,
      productId: parent.id,
      variantId: existing.id,
    });

    // The lock is the whole design: without it the count below is stale by the
    // time the delete runs.
    expect(products.lockForVariantChange).toHaveBeenCalledWith(parent.id, NOW);
    const lockOrder = vi.mocked(products.lockForVariantChange).mock.invocationCallOrder[0] ?? 0;
    const countOrder = vi.mocked(variants.countLiveForProduct).mock.invocationCallOrder[0] ?? 0;
    expect(lockOrder).toBeLessThan(countOrder);
  });

  it('refuses the last live variant with the conflict error, and deletes nothing', async () => {
    const parent = product();
    const existing = variant(parent.id);
    const variants = variantRepo({
      findByProductAndId: vi.fn().mockResolvedValue(existing),
      countLiveForProduct: vi.fn().mockResolvedValue(1),
    });

    await expect(
      build(productRepo(), variants).execute({
        principal,
        productId: parent.id,
        variantId: existing.id,
      }),
    ).rejects.toBeInstanceOf(ProductLastVariantError);
    expect(variants.softDelete).not.toHaveBeenCalled();
  });

  it('removes a non-last variant and records it', async () => {
    const parent = product();
    const existing = variant(parent.id);
    const auditWriter = new RecordingAuditWriter();

    const { variant: deleted } = await build(
      productRepo(),
      variantRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) }),
      auditWriter,
    ).execute({ principal, productId: parent.id, variantId: existing.id });

    expect(deleted.deletedAt).toEqual(NOW);
    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_VARIANT_REMOVED);
  });

  it('is not found when the product is gone', async () => {
    await expect(
      build(
        productRepo({ lockForVariantChange: vi.fn().mockResolvedValue(false) }),
        variantRepo(),
      ).execute({
        principal,
        productId: toProductId(ids.generate()),
        variantId: toProductVariantId(ids.generate()),
      }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('is not found when the variant belongs to a different product', async () => {
    await expect(
      build(productRepo(), variantRepo()).execute({
        principal,
        productId: toProductId(ids.generate()),
        variantId: toProductVariantId(ids.generate()),
      }),
    ).rejects.toBeInstanceOf(ProductVariantNotFoundError);
  });
});

describe('UpdateProductVariantUseCase', () => {
  const build = (
    variants: ProductVariantRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): UpdateProductVariantUseCase =>
    new UpdateProductVariantUseCase({
      ...base(auditWriter),
      productVariantRepository: variants,
    });

  it('applies only the supplied fields and leaves the SKU alone', async () => {
    const existing = variant();

    const { variant: updated } = await build(
      variantRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) }),
    ).execute({
      principal,
      productId: existing.productId,
      variantId: existing.id,
      changes: { name: 'Renamed' },
    });

    expect(updated.name).toBe('Renamed');
    expect(updated.sku).toBe(existing.sku);
  });

  it('is not found for a variant under the wrong product', async () => {
    await expect(
      build(variantRepo()).execute({
        principal,
        productId: toProductId(ids.generate()),
        variantId: toProductVariantId(ids.generate()),
        changes: {},
      }),
    ).rejects.toBeInstanceOf(ProductVariantNotFoundError);
  });

  it('writes no audit entry when nothing changed', async () => {
    const existing = variant();
    const auditWriter = new RecordingAuditWriter();

    await build(
      variantRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) }),
      auditWriter,
    ).execute({
      principal,
      productId: existing.productId,
      variantId: existing.id,
      changes: {},
    });

    expect(auditWriter.entries).toEqual([]);
  });
});

describe('read use cases', () => {
  it('returns the product it found', async () => {
    const existing = product();
    const useCase = new GetProductUseCase({
      productRepository: productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
    });

    expect(await useCase.execute({ productId: existing.id })).toBe(existing);
  });

  it('answers 404 for a product the tenant-scoped repository cannot see', async () => {
    const useCase = new GetProductUseCase({ productRepository: productRepo() });

    await expect(
      useCase.execute({ productId: toProductId(ids.generate()) }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('passes the cursor and limit straight through', async () => {
    const products = productRepo();
    await new ListProductsUseCase({ productRepository: products }).execute({
      limit: 20,
      cursor: 'abc',
    });

    expect(products.listPage).toHaveBeenCalledWith({ limit: 20, cursor: 'abc' });
  });

  it('answers 404 listing variants of an unseeable product rather than an empty array', async () => {
    const useCase = new ListProductVariantsUseCase({
      productRepository: productRepo(),
      productVariantRepository: variantRepo(),
    });

    await expect(
      useCase.execute({ productId: toProductId(ids.generate()) }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('scopes a variant read by both ids', async () => {
    const existing = variant();
    const variants = variantRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) });
    const useCase = new GetProductVariantUseCase({ productVariantRepository: variants });

    await useCase.execute({ productId: existing.productId, variantId: existing.id });

    expect(variants.findByProductAndId).toHaveBeenCalledWith(existing.productId, existing.id);
  });

  it('gives no read use case a transaction runner or an audit writer', () => {
    const reads = [
      new GetProductUseCase({ productRepository: productRepo() }),
      new ListProductsUseCase({ productRepository: productRepo() }),
      new GetProductVariantUseCase({ productVariantRepository: variantRepo() }),
      new ListProductVariantsUseCase({
        productRepository: productRepo(),
        productVariantRepository: variantRepo(),
      }),
    ];

    for (const useCase of reads) {
      expect(Object.keys(useCase)).not.toContain('auditWriter');
      expect(Object.keys(useCase)).not.toContain('transactionRunner');
    }
  });
});
