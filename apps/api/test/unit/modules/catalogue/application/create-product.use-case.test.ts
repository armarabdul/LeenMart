import { describe, expect, it, vi } from 'vitest';
import { FixedClock, Money, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../../../src/modules/audit/index.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../../../../src/modules/catalogue/domain/audit-actions.js';
import { CreateProductUseCase } from '../../../../../src/modules/catalogue/application/use-cases/create-product.use-case.js';
import { Category } from '../../../../../src/modules/catalogue/domain/entities/category.entity.js';
import { CategoryNotFoundError } from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { ProductVariantSkuConflictError } from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../../../../src/modules/catalogue/domain/repositories/category.repository.js';
import type { ProductRepository } from '../../../../../src/modules/catalogue/domain/repositories/product.repository.js';
import type { ProductVariantRepository } from '../../../../../src/modules/catalogue/domain/repositories/product-variant.repository.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toCategorySlug } from '../../../../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import { CategoryRiskLevel } from '../../../../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { FailingAuditWriter, RecordingAuditWriter } from '../../identity/application/fakes.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const vendorId = toVendorId(ids.generate());
const principal: Principal = {
  userId: toUserId(ids.generate()),
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};

const NO_REQUIREMENTS = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

const category = Category.create({
  id: toCategoryId(ids.generate()),
  parent: null,
  name: 'Seafood',
  slug: toCategorySlug('seafood'),
  riskLevel: CategoryRiskLevel.LOW,
  requirements: NO_REQUIREMENTS,
  now: NOW,
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
    countLiveForProduct: vi.fn().mockResolvedValue(1),
    softDelete: vi.fn().mockResolvedValue(true),
    softDeleteAllForProduct: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

const categoryRepo = (found: Category | null = category): CategoryRepository => {
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

/** Runs the callback and rolls nothing back — failure propagates, as a real transaction's would. */
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

const validInput = {
  principal,
  vendorId,
  categoryId: category.id,
  name: 'Fresh Rohu Fish',
  brand: null,
  description: null,
  hsnCode: null,
  countryOfOrigin: null,
  netQuantity: null,
  attributeValues: {},
  variant: {
    sku: 'ROHU-1KG',
    name: '1 kg pack',
    price: Money.fromMajor(199),
    unitOfMeasure: 'kg',
    quantityStep: 1,
  },
};

interface DepsOverrides {
  productRepository?: ProductRepository;
  productVariantRepository?: ProductVariantRepository;
  categoryRepository?: CategoryRepository;
  transactionRunner?: TransactionRunner;
  auditWriter?: AuditWriter;
}

const deps = (
  overrides: DepsOverrides = {},
): {
  productRepository: ProductRepository;
  productVariantRepository: ProductVariantRepository;
  categoryRepository: CategoryRepository;
  transactionRunner: TransactionRunner;
  auditWriter: AuditWriter;
  idGenerator: UuidV7Generator;
  clock: FixedClock;
  logger: NullLogger;
} => ({
  productRepository: overrides.productRepository ?? productRepo(),
  productVariantRepository: overrides.productVariantRepository ?? variantRepo(),
  categoryRepository: overrides.categoryRepository ?? categoryRepo(),
  transactionRunner: overrides.transactionRunner ?? runner(),
  auditWriter: overrides.auditWriter ?? new RecordingAuditWriter(),
  idGenerator: ids,
  clock,
  logger: new NullLogger(),
});

describe('CreateProductUseCase', () => {
  it('creates the product and its first variant, both starting live and DRAFT', async () => {
    const useCase = new CreateProductUseCase(deps());

    const { product, variant } = await useCase.execute(validInput);

    expect(product.status).toBe('DRAFT');
    expect(product.vendorId).toBe(vendorId);
    expect(product.categoryId).toBe(category.id);
    expect(variant.productId).toBe(product.id);
    expect(variant.vendorId).toBe(vendorId);
    expect(variant.sku).toBe('ROHU-1KG');
  });

  it('persists both the product and the variant', async () => {
    const productRepository = productRepo();
    const productVariantRepository = variantRepo();

    await new CreateProductUseCase(deps({ productRepository, productVariantRepository })).execute(
      validInput,
    );

    expect(productRepository.create).toHaveBeenCalledTimes(1);
    expect(productVariantRepository.create).toHaveBeenCalledTimes(1);
  });

  it('throws CategoryNotFoundError for an unknown category, before writing anything', async () => {
    const productRepository = productRepo();
    const categoryRepository = categoryRepo(null);

    await expect(
      new CreateProductUseCase(deps({ productRepository, categoryRepository })).execute(validInput),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
    expect(productRepository.create).not.toHaveBeenCalled();
  });

  it('records exactly one PRODUCT_CREATED audit entry, inside the same transaction', async () => {
    const auditWriter = new RecordingAuditWriter();

    await new CreateProductUseCase(deps({ auditWriter })).execute(validInput);

    expect(auditWriter.entries).toHaveLength(1);
    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_CREATED);
    expect(auditWriter.entries[0]?.actorId).toBe(principal.userId);
  });

  it('rolls back the product and variant writes when the audit write fails', async () => {
    let rolledBack = false;
    const productRepository = productRepo();
    const productVariantRepository = variantRepo();
    const transactionRunner = runner(() => {
      rolledBack = true;
    });

    await expect(
      new CreateProductUseCase(
        deps({
          productRepository,
          productVariantRepository,
          transactionRunner,
          auditWriter: new FailingAuditWriter(),
        }),
      ).execute(validInput),
    ).rejects.toThrow();

    expect(rolledBack).toBe(true);
  });

  it('propagates ProductVariantSkuConflictError from the variant repository', async () => {
    const productVariantRepository = variantRepo({
      create: vi.fn().mockRejectedValue(new ProductVariantSkuConflictError()),
    });

    await expect(
      new CreateProductUseCase(deps({ productVariantRepository })).execute(validInput),
    ).rejects.toBeInstanceOf(ProductVariantSkuConflictError);
  });
});
