import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import { MAX_IMAGES_PER_PRODUCT } from '@leen-mart/contracts';
import type { AuditWriter } from '../../../../../src/modules/audit/index.js';
import type {
  ObjectStore,
  PresignedDownload,
  PresignedUpload,
  StoredObject,
  TemporaryObject,
} from '../../../../../src/modules/media/index.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../../../../src/modules/catalogue/domain/audit-actions.js';
import { CreateProductMediaUploadIntentUseCase } from '../../../../../src/modules/catalogue/application/use-cases/create-product-media-upload-intent.use-case.js';
import { CompleteProductMediaUploadUseCase } from '../../../../../src/modules/catalogue/application/use-cases/complete-product-media-upload.use-case.js';
import { ListProductMediaUseCase } from '../../../../../src/modules/catalogue/application/use-cases/list-product-media.use-case.js';
import { RemoveProductMediaUseCase } from '../../../../../src/modules/catalogue/application/use-cases/remove-product-media.use-case.js';
import { Product } from '../../../../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductMedia } from '../../../../../src/modules/catalogue/domain/entities/product-media.entity.js';
import {
  IncompleteProductMediaUploadError,
  ProductMediaLimitExceededError,
  ProductMediaNotFoundError,
  ProductMediaUploadConflictError,
  ProductNotFoundError,
} from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import type { ProductRepository } from '../../../../../src/modules/catalogue/domain/repositories/product.repository.js';
import type { ProductMediaRepository } from '../../../../../src/modules/catalogue/domain/repositories/product-media.repository.js';
import type { ProductMediaProcessingQueue } from '../../../../../src/modules/catalogue/application/ports/product-media-processing-queue.port.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductMediaId } from '../../../../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';
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

const draftProduct = (): Product =>
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

const approvedProduct = (): Product => draftProduct().submitForReview(NOW).approve(NOW);

const media = (
  productId = toProductId(ids.generate()),
  overrides: { objectKey?: string; contentType?: string; sizeBytes?: number } = {},
): ProductMedia =>
  ProductMedia.create({
    id: toProductMediaId(ids.generate()),
    productId,
    vendorId,
    objectKey: overrides.objectKey ?? `product-media/${vendorId}/${productId}/x.jpg`,
    contentType: overrides.contentType ?? 'image/jpeg',
    sizeBytes: overrides.sizeBytes ?? 2048,
    now: NOW,
  });

const runner = (): TransactionRunner => ({
  run: async (work) => work({} as TransactionScope),
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
    lockForMediaChange: vi.fn().mockResolvedValue(true),
    reenterReviewIfApproved: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

const mediaRepo = (overrides: Partial<ProductMediaRepository> = {}): ProductMediaRepository => {
  const repository: ProductMediaRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    findByProductAndId: vi.fn().mockResolvedValue(null),
    listByProductId: vi.fn().mockResolvedValue([]),
    countLiveForProduct: vi.fn().mockResolvedValue(0),
    completeIfAwaitingUpload: vi.fn().mockResolvedValue(true),
    markReadyIfProcessing: vi.fn().mockResolvedValue(true),
    markFailedIfProcessing: vi.fn().mockResolvedValue(true),
    markProcessingIfFailed: vi.fn().mockResolvedValue(true),
    softDelete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

const objectStore = (overrides: Partial<ObjectStore> = {}): ObjectStore => ({
  presignPut: vi.fn().mockResolvedValue({
    url: 'https://store.example/signed',
    expiresAt: new Date(NOW.getTime() + 5 * 60 * 1000),
    contentType: 'image/jpeg',
    contentLength: 2048,
  } satisfies PresignedUpload),
  presignGet: vi.fn().mockResolvedValue({
    url: 'https://store.example/get',
    expiresAt: NOW,
  } satisfies PresignedDownload),
  head: vi
    .fn()
    .mockResolvedValue({ sizeBytes: 2048, contentType: 'image/jpeg' } satisfies StoredObject),
  getObject: vi.fn().mockResolvedValue(null),
  writeTemporaryObject: vi.fn().mockResolvedValue({ key: 'temp/x' } satisfies TemporaryObject),
  putObject: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const processingQueue = (
  overrides: Partial<ProductMediaProcessingQueue> = {},
): ProductMediaProcessingQueue => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const base = (
  auditWriter: AuditWriter = new RecordingAuditWriter(),
): {
  transactionRunner: TransactionRunner;
  auditWriter: AuditWriter;
  clock: FixedClock;
  logger: NullLogger;
} => ({
  transactionRunner: runner(),
  auditWriter,
  clock,
  logger: new NullLogger(),
});

describe('CreateProductMediaUploadIntentUseCase', () => {
  const build = (
    products: ProductRepository,
    mediaRepository: ProductMediaRepository = mediaRepo(),
    store: ObjectStore = objectStore(),
  ): CreateProductMediaUploadIntentUseCase =>
    new CreateProductMediaUploadIntentUseCase({
      productRepository: products,
      productMediaRepository: mediaRepository,
      objectStore: store,
      transactionRunner: runner(),
      idGenerator: ids,
      clock,
      logger: new NullLogger(),
    });

  const input = (
    productId: ReturnType<typeof toProductId>,
  ): Parameters<CreateProductMediaUploadIntentUseCase['execute']>[0] => ({
    principal,
    productId,
    contentType: 'image/jpeg',
    sizeBytes: 2048,
  });

  it('locks the parent before counting anything', async () => {
    const parent = draftProduct();
    const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });
    const mediaRepository = mediaRepo();

    await build(products, mediaRepository).execute(input(parent.id));

    expect(products.lockForMediaChange).toHaveBeenCalledWith(parent.id, NOW);
    const lockOrder = vi.mocked(products.lockForMediaChange).mock.invocationCallOrder[0] ?? 0;
    const countOrder =
      vi.mocked(mediaRepository.countLiveForProduct).mock.invocationCallOrder[0] ?? 0;
    expect(lockOrder).toBeLessThan(countOrder);
  });

  it('is not found when the product is gone, and creates nothing', async () => {
    const products = productRepo({ lockForMediaChange: vi.fn().mockResolvedValue(false) });
    const mediaRepository = mediaRepo();

    await expect(
      build(products, mediaRepository).execute(input(toProductId(ids.generate()))),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
    expect(mediaRepository.create).not.toHaveBeenCalled();
  });

  it('refuses at MAX_IMAGES_PER_PRODUCT, and creates nothing', async () => {
    const parent = draftProduct();
    const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });
    const mediaRepository = mediaRepo({
      countLiveForProduct: vi.fn().mockResolvedValue(MAX_IMAGES_PER_PRODUCT),
    });

    await expect(build(products, mediaRepository).execute(input(parent.id))).rejects.toBeInstanceOf(
      ProductMediaLimitExceededError,
    );
    expect(mediaRepository.create).not.toHaveBeenCalled();
  });

  it('accepts one below the cap', async () => {
    const parent = draftProduct();
    const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });
    const mediaRepository = mediaRepo({
      countLiveForProduct: vi.fn().mockResolvedValue(MAX_IMAGES_PER_PRODUCT - 1),
    });

    await expect(build(products, mediaRepository).execute(input(parent.id))).resolves.toBeDefined();
  });

  it('derives the object key from the product, never the client, and presigns against it', async () => {
    const parent = draftProduct();
    const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });
    const store = objectStore();

    const result = await build(products, mediaRepo(), store).execute(input(parent.id));

    expect(vi.mocked(store.presignPut)).toHaveBeenCalledTimes(1);
    const [call] = vi.mocked(store.presignPut).mock.calls;
    const signedKey = call?.[0]?.key ?? '';
    expect(signedKey).toContain(`product-media/${parent.vendorId}/${parent.id}/`);
    expect(result.media.vendorId).toBe(parent.vendorId);
    expect(result.media.productId).toBe(parent.id);
    expect(result.media.status).toBe('AWAITING_UPLOAD');
  });

  it('returns the presigned URL and expiry unchanged', async () => {
    const parent = draftProduct();
    const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });

    const result = await build(products).execute(input(parent.id));

    expect(result.uploadUrl).toBe('https://store.example/signed');
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 5 * 60 * 1000));
  });
});

describe('CompleteProductMediaUploadUseCase', () => {
  // The last two collaborators travel as one options object rather than as
  // two more positional parameters — S2-6b's queue would otherwise make this
  // a five-parameter helper.
  const build = (
    products: ProductRepository,
    mediaRepository: ProductMediaRepository,
    store: ObjectStore = objectStore(),
    extras: { auditWriter?: AuditWriter; queue?: ProductMediaProcessingQueue } = {},
  ): CompleteProductMediaUploadUseCase =>
    new CompleteProductMediaUploadUseCase({
      productRepository: products,
      productMediaRepository: mediaRepository,
      objectStore: store,
      productMediaProcessingQueue: extras.queue ?? processingQueue(),
      ...base(extras.auditWriter ?? new RecordingAuditWriter()),
    });

  it('is not found when there is no such media item', async () => {
    await expect(
      build(productRepo(), mediaRepo()).execute({
        principal,
        productId: toProductId(ids.generate()),
        mediaId: toProductMediaId(ids.generate()),
      }),
    ).rejects.toBeInstanceOf(ProductMediaNotFoundError);
  });

  it('refuses when the object was never uploaded', async () => {
    const existing = media();
    const mediaRepository = mediaRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) });
    const store = objectStore({ head: vi.fn().mockResolvedValue(null) });

    await expect(
      build(productRepo(), mediaRepository, store).execute({
        principal,
        productId: existing.productId,
        mediaId: existing.id,
      }),
    ).rejects.toBeInstanceOf(IncompleteProductMediaUploadError);
  });

  it('refuses on a size mismatch', async () => {
    const existing = media(undefined, { sizeBytes: 2048 });
    const mediaRepository = mediaRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) });
    const store = objectStore({
      head: vi.fn().mockResolvedValue({ sizeBytes: 999, contentType: 'image/jpeg' }),
    });

    await expect(
      build(productRepo(), mediaRepository, store).execute({
        principal,
        productId: existing.productId,
        mediaId: existing.id,
      }),
    ).rejects.toBeInstanceOf(IncompleteProductMediaUploadError);
  });

  it('refuses on a content-type mismatch', async () => {
    const existing = media(undefined, { contentType: 'image/jpeg' });
    const mediaRepository = mediaRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) });
    const store = objectStore({
      head: vi.fn().mockResolvedValue({ sizeBytes: 2048, contentType: 'image/png' }),
    });

    await expect(
      build(productRepo(), mediaRepository, store).execute({
        principal,
        productId: existing.productId,
        mediaId: existing.id,
      }),
    ).rejects.toBeInstanceOf(IncompleteProductMediaUploadError);
  });

  it('completes a verified upload and records it', async () => {
    const existing = media();
    const mediaRepository = mediaRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) });
    const auditWriter = new RecordingAuditWriter();

    const result = await build(productRepo(), mediaRepository, objectStore(), {
      auditWriter,
    }).execute({
      principal,
      productId: existing.productId,
      mediaId: existing.id,
    });

    expect(result.media.status).toBe('PROCESSING');
    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_MEDIA_ADDED);
    expect(auditWriter.entries[0]?.entityId).toBe(existing.productId);
  });

  it('loses the completion race with the conflict error', async () => {
    const existing = media();
    const mediaRepository = mediaRepo({
      findByProductAndId: vi.fn().mockResolvedValue(existing),
      completeIfAwaitingUpload: vi.fn().mockResolvedValue(false),
    });

    await expect(
      build(productRepo(), mediaRepository).execute({
        principal,
        productId: existing.productId,
        mediaId: existing.id,
      }),
    ).rejects.toBeInstanceOf(ProductMediaUploadConflictError);
  });

  describe('post-commit enqueue (S2-6b)', () => {
    it('enqueues one processing job carrying only ids', async () => {
      const existing = media();
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
      });
      const queue = processingQueue();

      await build(productRepo(), mediaRepository, objectStore(), { queue }).execute({
        principal,
        productId: existing.productId,
        mediaId: existing.id,
      });

      expect(queue.enqueue).toHaveBeenCalledTimes(1);
      expect(queue.enqueue).toHaveBeenCalledWith({
        mediaId: existing.id,
        vendorId: existing.vendorId,
        userId: principal.userId,
      });
    });

    it('enqueues only after the transaction has committed', async () => {
      const existing = media();
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
      });
      const order: string[] = [];
      const queue = processingQueue({
        enqueue: vi.fn().mockImplementation(() => {
          order.push('enqueue');
          return Promise.resolve();
        }),
      });
      const useCase = new CompleteProductMediaUploadUseCase({
        productRepository: productRepo(),
        productMediaRepository: mediaRepository,
        objectStore: objectStore(),
        productMediaProcessingQueue: queue,
        ...base(),
        transactionRunner: {
          run: async (work) => {
            order.push('transaction:begin');
            const result = await work({} as TransactionScope);
            order.push('transaction:commit');
            return result;
          },
        },
      });

      await useCase.execute({
        principal,
        productId: existing.productId,
        mediaId: existing.id,
      });

      // The whole point: a job enqueued before the commit could reference a
      // write that then rolled back.
      expect(order).toEqual(['transaction:begin', 'transaction:commit', 'enqueue']);
    });

    it('enqueues nothing when the transaction rolls back', async () => {
      const existing = media();
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
        completeIfAwaitingUpload: vi.fn().mockResolvedValue(false),
      });
      const queue = processingQueue();

      await expect(
        build(productRepo(), mediaRepository, objectStore(), { queue }).execute({
          principal,
          productId: existing.productId,
          mediaId: existing.id,
        }),
      ).rejects.toBeInstanceOf(ProductMediaUploadConflictError);

      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('still succeeds when the enqueue itself fails — the upload genuinely completed', async () => {
      const existing = media();
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
      });
      const queue = processingQueue({
        enqueue: vi.fn().mockRejectedValue(new Error('redis is down')),
      });

      const result = await build(productRepo(), mediaRepository, objectStore(), {
        queue,
      }).execute({
        principal,
        productId: existing.productId,
        mediaId: existing.id,
      });

      expect(result.media.status).toBe('PROCESSING');
    });
  });

  describe('ASM-14 reopening', () => {
    it('reopens an APPROVED product and records the reopening', async () => {
      const parent = approvedProduct();
      const existing = media(parent.id);
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
      });
      const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });
      const auditWriter = new RecordingAuditWriter();

      await build(products, mediaRepository, objectStore(), { auditWriter }).execute({
        principal,
        productId: parent.id,
        mediaId: existing.id,
      });

      expect(products.reenterReviewIfApproved).toHaveBeenCalledTimes(1);
      const reopened = vi.mocked(products.reenterReviewIfApproved).mock.calls[0]?.[0];
      expect(reopened?.status).toBe('PENDING_REVIEW');
      expect(auditWriter.entries.map((e) => e.action)).toContain(
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_MEDIA_CHANGE,
      );
    });

    it('does not touch a product that is not APPROVED', async () => {
      const parent = draftProduct();
      const existing = media(parent.id);
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
      });
      const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });
      const auditWriter = new RecordingAuditWriter();

      await build(products, mediaRepository, objectStore(), { auditWriter }).execute({
        principal,
        productId: parent.id,
        mediaId: existing.id,
      });

      expect(products.reenterReviewIfApproved).not.toHaveBeenCalled();
      expect(auditWriter.entries.map((e) => e.action)).not.toContain(
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_MEDIA_CHANGE,
      );
    });

    it('is not an error when the reopening race is lost — the media completion still succeeds', async () => {
      const parent = approvedProduct();
      const existing = media(parent.id);
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
      });
      const products = productRepo({
        findById: vi.fn().mockResolvedValue(parent),
        reenterReviewIfApproved: vi.fn().mockResolvedValue(false),
      });
      const auditWriter = new RecordingAuditWriter();

      const result = await build(products, mediaRepository, objectStore(), { auditWriter }).execute(
        {
          principal,
          productId: parent.id,
          mediaId: existing.id,
        },
      );

      expect(result.media.status).toBe('PROCESSING');
      expect(auditWriter.entries.map((e) => e.action)).not.toContain(
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_MEDIA_CHANGE,
      );
    });

    it('is not an error when the product has vanished by the time ASM-14 checks it', async () => {
      const existing = media();
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
      });
      const products = productRepo({ findById: vi.fn().mockResolvedValue(null) });

      await expect(
        build(products, mediaRepository).execute({
          principal,
          productId: existing.productId,
          mediaId: existing.id,
        }),
      ).resolves.toBeDefined();
      expect(products.reenterReviewIfApproved).not.toHaveBeenCalled();
    });
  });
});

describe('ListProductMediaUseCase', () => {
  const build = (
    products: ProductRepository,
    mediaRepository: ProductMediaRepository,
  ): ListProductMediaUseCase =>
    new ListProductMediaUseCase({
      productRepository: products,
      productMediaRepository: mediaRepository,
    });

  it('is not found when the product does not exist', async () => {
    await expect(
      build(productRepo(), mediaRepo()).execute({ productId: toProductId(ids.generate()) }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('lists the product’s media items', async () => {
    const parent = draftProduct();
    const items = [media(parent.id), media(parent.id)];
    const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });
    const mediaRepository = mediaRepo({ listByProductId: vi.fn().mockResolvedValue(items) });

    const result = await build(products, mediaRepository).execute({ productId: parent.id });

    expect(result).toBe(items);
  });
});

describe('RemoveProductMediaUseCase', () => {
  const build = (
    products: ProductRepository,
    mediaRepository: ProductMediaRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): RemoveProductMediaUseCase =>
    new RemoveProductMediaUseCase({
      productRepository: products,
      productMediaRepository: mediaRepository,
      ...base(auditWriter),
    });

  it('is not found when there is no such media item', async () => {
    await expect(
      build(productRepo(), mediaRepo()).execute({
        principal,
        productId: toProductId(ids.generate()),
        mediaId: toProductMediaId(ids.generate()),
      }),
    ).rejects.toBeInstanceOf(ProductMediaNotFoundError);
  });

  it('is not found when the row vanished between the read and the delete', async () => {
    const existing = media();
    const mediaRepository = mediaRepo({
      findByProductAndId: vi.fn().mockResolvedValue(existing),
      softDelete: vi.fn().mockResolvedValue(false),
    });

    await expect(
      build(productRepo(), mediaRepository).execute({
        principal,
        productId: existing.productId,
        mediaId: existing.id,
      }),
    ).rejects.toBeInstanceOf(ProductMediaNotFoundError);
  });

  it('removes a media item and records it', async () => {
    const existing = media();
    const mediaRepository = mediaRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) });
    const auditWriter = new RecordingAuditWriter();

    const result = await build(productRepo(), mediaRepository, auditWriter).execute({
      principal,
      productId: existing.productId,
      mediaId: existing.id,
    });

    expect(result.media.isDeleted).toBe(true);
    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_MEDIA_REMOVED);
    expect(auditWriter.entries[0]?.entityId).toBe(existing.productId);
  });

  describe('ASM-14 reopening', () => {
    it('reopens an APPROVED product on removal too', async () => {
      const parent = approvedProduct();
      const existing = media(parent.id);
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
      });
      const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });
      const auditWriter = new RecordingAuditWriter();

      await build(products, mediaRepository, auditWriter).execute({
        principal,
        productId: parent.id,
        mediaId: existing.id,
      });

      expect(products.reenterReviewIfApproved).toHaveBeenCalledTimes(1);
      expect(auditWriter.entries.map((e) => e.action)).toContain(
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_MEDIA_CHANGE,
      );
    });

    it('does not touch a product that is not APPROVED', async () => {
      const parent = draftProduct();
      const existing = media(parent.id);
      const mediaRepository = mediaRepo({
        findByProductAndId: vi.fn().mockResolvedValue(existing),
      });
      const products = productRepo({ findById: vi.fn().mockResolvedValue(parent) });

      await build(products, mediaRepository).execute({
        principal,
        productId: parent.id,
        mediaId: existing.id,
      });

      expect(products.reenterReviewIfApproved).not.toHaveBeenCalled();
    });
  });

  it('fails closed when the audit write fails, leaving the caller with no silent record loss', async () => {
    const existing = media();
    const mediaRepository = mediaRepo({ findByProductAndId: vi.fn().mockResolvedValue(existing) });

    await expect(
      build(productRepo(), mediaRepository, new FailingAuditWriter()).execute({
        principal,
        productId: existing.productId,
        mediaId: existing.id,
      }),
    ).rejects.toThrow();
  });
});
