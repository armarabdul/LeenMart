import { describe, expect, it, vi } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { GetPublicProductDetailUseCase } from '../../../../../src/modules/catalogue/application/use-cases/get-public-product-detail.use-case.js';
import { Product } from '../../../../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductVariant } from '../../../../../src/modules/catalogue/domain/entities/product-variant.entity.js';
import { ProductMedia } from '../../../../../src/modules/catalogue/domain/entities/product-media.entity.js';
import { Inventory } from '../../../../../src/modules/catalogue/domain/entities/inventory.entity.js';
import { ProductNotFoundError } from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import type { ProductRepository } from '../../../../../src/modules/catalogue/domain/repositories/product.repository.js';
import type { ProductVariantRepository } from '../../../../../src/modules/catalogue/domain/repositories/product-variant.repository.js';
import type { ProductMediaRepository } from '../../../../../src/modules/catalogue/domain/repositories/product-media.repository.js';
import type { InventoryRepository } from '../../../../../src/modules/catalogue/domain/repositories/inventory.repository.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import {
  toProductId,
  type ProductId,
} from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { toProductMediaId } from '../../../../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/index.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const vendorId = toVendorId(ids.generate());
const categoryId = toCategoryId(ids.generate());

const approvedProduct = (productId: ProductId = toProductId(ids.generate())): Product =>
  Product.create({
    id: productId,
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
  })
    .submitForReview(NOW)
    .approve(NOW);

const variant = (productId: ProductId): ProductVariant =>
  ProductVariant.create({
    id: toProductVariantId(ids.generate()),
    productId,
    vendorId,
    sku: `ROHU-${ids.generate().slice(0, 8)}`,
    name: '1 kg pack',
    price: Money.fromMajor(199),
    unitOfMeasure: 'kg',
    quantityStep: 1,
    now: NOW,
  });

const readyMedia = (productId: ProductId): ProductMedia =>
  ProductMedia.create({
    id: toProductMediaId(ids.generate()),
    productId,
    vendorId,
    objectKey: `product-media/${vendorId}/${productId}/x.jpg`,
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    now: NOW,
  })
    .completeUpload(NOW)
    .markReady(NOW);

const awaitingMedia = (productId: ProductId): ProductMedia =>
  ProductMedia.create({
    id: toProductMediaId(ids.generate()),
    productId,
    vendorId,
    objectKey: `product-media/${vendorId}/${productId}/pending.jpg`,
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    now: NOW,
  });

const availableInventory = (
  variantId: ReturnType<typeof toProductVariantId>,
  count: number,
): Inventory => Inventory.initial({ variantId, vendorId, now: NOW }).set(count, NOW);

const productRepo = (found: Product | null): ProductRepository => {
  const repository: ProductRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(found),
    update: vi.fn().mockResolvedValue(true),
    listPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    softDelete: vi.fn().mockResolvedValue(true),
    lockForVariantChange: vi.fn().mockResolvedValue(true),
    lockForMediaChange: vi.fn().mockResolvedValue(true),
    reenterReviewIfApproved: vi.fn().mockResolvedValue(true),
    updateAndReenterReviewIfApproved: vi.fn().mockResolvedValue(true),
    submitForReviewIfEligible: vi.fn().mockResolvedValue(true),
    decideIfPendingReview: vi.fn().mockResolvedValue(true),
  };
  return repository;
};

const variantRepo = (variants: readonly ProductVariant[]): ProductVariantRepository => {
  const repository: ProductVariantRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    findByProductAndId: vi.fn().mockResolvedValue(null),
    listByProductId: vi.fn().mockResolvedValue(variants),
    update: vi.fn().mockResolvedValue(true),
    countLiveForProduct: vi.fn().mockResolvedValue(variants.length),
    softDelete: vi.fn().mockResolvedValue(true),
    softDeleteAllForProduct: vi.fn().mockResolvedValue(0),
  };
  return repository;
};

const mediaRepo = (items: readonly ProductMedia[]): ProductMediaRepository => {
  const repository: ProductMediaRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    findByProductAndId: vi.fn().mockResolvedValue(null),
    listByProductId: vi.fn().mockResolvedValue(items),
    countLiveForProduct: vi.fn().mockResolvedValue(items.length),
    completeIfAwaitingUpload: vi.fn().mockResolvedValue(true),
    markReadyIfProcessing: vi.fn().mockResolvedValue(true),
    markFailedIfProcessing: vi.fn().mockResolvedValue(true),
    markProcessingIfFailed: vi.fn().mockResolvedValue(true),
    softDelete: vi.fn().mockResolvedValue(true),
  };
  return repository;
};

const inventoryRepo = (
  byVariantId: ReadonlyMap<string, Inventory>,
): { repository: InventoryRepository; findByProductAndVariant: ReturnType<typeof vi.fn> } => {
  const findByProductAndVariant = vi
    .fn()
    .mockImplementation((_productId, variantId) =>
      Promise.resolve(byVariantId.get(String(variantId)) ?? null),
    );
  const repository: InventoryRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByProductAndVariant,
    setIfVersionMatches: vi.fn().mockResolvedValue(true),
    deleteForVariants: vi.fn().mockResolvedValue(0),
    deleteForProduct: vi.fn().mockResolvedValue(0),
  };
  return { repository, findByProductAndVariant };
};

const build = (deps: {
  product: Product | null;
  variants?: readonly ProductVariant[];
  media?: readonly ProductMedia[];
  inventoryByVariantId?: ReadonlyMap<string, Inventory>;
}): GetPublicProductDetailUseCase =>
  new GetPublicProductDetailUseCase({
    productRepository: productRepo(deps.product),
    productVariantRepository: variantRepo(deps.variants ?? []),
    productMediaRepository: mediaRepo(deps.media ?? []),
    inventoryRepository: inventoryRepo(deps.inventoryByVariantId ?? new Map()).repository,
  });

describe('GetPublicProductDetailUseCase', () => {
  it('throws ProductNotFoundError when the repository returns null', async () => {
    const useCase = build({ product: null });

    await expect(
      useCase.execute({ productId: toProductId(ids.generate()) }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('returns the product, its variants and each variant’s available stock', async () => {
    const product = approvedProduct();
    const v1 = variant(product.id);
    const v2 = variant(product.id);
    const inventoryByVariantId = new Map([
      [String(v1.id), availableInventory(v1.id, 12)],
      [String(v2.id), availableInventory(v2.id, 0)],
    ]);

    const useCase = build({ product, variants: [v1, v2], inventoryByVariantId });
    const result = await useCase.execute({ productId: product.id });

    expect(result.product.id).toBe(product.id);
    expect(result.variants).toHaveLength(2);
    expect(result.variants.find((item) => item.variant.id === v1.id)?.available).toBe(12);
    expect(result.variants.find((item) => item.variant.id === v2.id)?.available).toBe(0);
  });

  it('treats a variant with no inventory row as zero available', async () => {
    const product = approvedProduct();
    const orphanVariant = variant(product.id);

    const useCase = build({ product, variants: [orphanVariant] });
    const result = await useCase.execute({ productId: product.id });

    expect(result.variants).toEqual([{ variant: orphanVariant, available: 0 }]);
  });

  it('counts only READY media toward mediaCount', async () => {
    const product = approvedProduct();
    const ready = readyMedia(product.id);
    const pending = awaitingMedia(product.id);

    const useCase = build({ product, media: [ready, pending] });
    const result = await useCase.execute({ productId: product.id });

    expect(result.mediaCount).toBe(1);
  });

  it('reports zero mediaCount when the product has no media', async () => {
    const product = approvedProduct();

    const useCase = build({ product });
    const result = await useCase.execute({ productId: product.id });

    expect(result.mediaCount).toBe(0);
  });

  it('returns an empty variants array when the product has none', async () => {
    const product = approvedProduct();

    const useCase = build({ product });
    const result = await useCase.execute({ productId: product.id });

    expect(result.variants).toEqual([]);
  });
});
