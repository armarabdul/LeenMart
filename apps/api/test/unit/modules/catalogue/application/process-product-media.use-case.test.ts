import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import type { ObjectStore } from '../../../../../src/modules/media/index.js';
import { ProcessProductMediaUseCase } from '../../../../../src/modules/catalogue/application/use-cases/process-product-media.use-case.js';
import {
  ImageDecodeError,
  type GeneratedVariant,
  type ImageProcessor,
} from '../../../../../src/modules/catalogue/application/ports/image-processor.port.js';
import { ProductMedia } from '../../../../../src/modules/catalogue/domain/entities/product-media.entity.js';
import {
  PRODUCT_MEDIA_VARIANT_FORMATS,
  PRODUCT_MEDIA_VARIANT_WIDTHS,
  ProductMediaVariant,
} from '../../../../../src/modules/catalogue/domain/entities/product-media-variant.entity.js';
import type { ProductMediaRepository } from '../../../../../src/modules/catalogue/domain/repositories/product-media.repository.js';
import type { ProductMediaVariantRepository } from '../../../../../src/modules/catalogue/domain/repositories/product-media-variant.repository.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductMediaId } from '../../../../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';
import { toProductMediaVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-media-variant-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const vendorId = toVendorId(ids.generate());
const productId = toProductId(ids.generate());
const mediaId = toProductMediaId(ids.generate());
const OBJECT_KEY = `product-media/${vendorId}/${productId}/${mediaId}/original`;

const BYTES = Buffer.from('not-really-an-image-but-the-processor-is-faked-here');

/**
 * `ProcessProductMediaUseCase` in isolation — the orchestration, the status
 * arbitration and the failure classification, with the image work faked.
 *
 * The *real* Sharp behaviour (magic bytes, SVG, EXIF stripping, the actual
 * encoded outputs) is proved against real images in
 * `test/integration/sharp-image-processor.test.ts`, and the real database
 * arbitration in `test/integration/product-media-processing.test.ts`. What is
 * faked here is deliberately only the part those two suites cover for real.
 */
const media = (
  status: 'AWAITING_UPLOAD' | 'PROCESSING' | 'READY' | 'FAILED' = 'PROCESSING',
): ProductMedia =>
  ProductMedia.reconstitute({
    id: mediaId,
    productId,
    vendorId,
    objectKey: OBJECT_KEY,
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    status,
    failureReason: status === 'FAILED' ? 'PROCESSING_ERROR' : null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });

const mediaRepo = (overrides: Partial<ProductMediaRepository> = {}): ProductMediaRepository => {
  const repository: ProductMediaRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(media()),
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

const variantRepo = (
  overrides: Partial<ProductMediaVariantRepository> = {},
): ProductMediaVariantRepository => {
  const repository: ProductMediaVariantRepository = {
    withTransaction: () => repository,
    createIfAbsent: vi.fn().mockResolvedValue(true),
    listByMediaId: vi.fn().mockResolvedValue([]),
    countByMediaId: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

const objectStore = (overrides: Partial<ObjectStore> = {}): ObjectStore => ({
  presignPut: vi.fn(),
  presignGet: vi.fn(),
  head: vi.fn().mockResolvedValue({ sizeBytes: 2048, contentType: 'image/jpeg' }),
  getObject: vi.fn().mockResolvedValue(BYTES),
  writeTemporaryObject: vi.fn(),
  putObject: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const allVariants = (): GeneratedVariant[] =>
  PRODUCT_MEDIA_VARIANT_WIDTHS.flatMap((width) =>
    PRODUCT_MEDIA_VARIANT_FORMATS.map((format) => ({
      width,
      format,
      bytes: Buffer.from(`${width}-${format}`),
    })),
  );

const imageProcessor = (overrides: Partial<ImageProcessor> = {}): ImageProcessor => ({
  readMetadata: vi.fn().mockResolvedValue({ format: 'jpeg', width: 2000, height: 1500 }),
  generateVariants: vi.fn().mockResolvedValue(allVariants()),
  ...overrides,
});

interface BuildOptions {
  productMediaRepository?: ProductMediaRepository;
  productMediaVariantRepository?: ProductMediaVariantRepository;
  objectStore?: ObjectStore;
  imageProcessor?: ImageProcessor;
}

const build = (options: BuildOptions = {}): ProcessProductMediaUseCase =>
  new ProcessProductMediaUseCase({
    productMediaRepository: options.productMediaRepository ?? mediaRepo(),
    productMediaVariantRepository: options.productMediaVariantRepository ?? variantRepo(),
    objectStore: options.objectStore ?? objectStore(),
    imageProcessor: options.imageProcessor ?? imageProcessor(),
    idGenerator: ids,
    clock,
    logger: new NullLogger(),
  });

const run = (
  useCase: ProcessProductMediaUseCase,
  attemptNumber = 1,
  maxAttempts = 3,
): Promise<void> => useCase.execute({ mediaId, attemptNumber, maxAttempts });

describe('ProcessProductMediaUseCase', () => {
  describe('the happy path', () => {
    it('writes all eight derived objects and all eight rows, then marks READY', async () => {
      const store = objectStore();
      const variants = variantRepo();
      const repository = mediaRepo();

      await run(
        build({
          objectStore: store,
          productMediaVariantRepository: variants,
          productMediaRepository: repository,
        }),
      );

      expect(store.putObject).toHaveBeenCalledTimes(8);
      expect(variants.createIfAbsent).toHaveBeenCalledTimes(8);
      expect(repository.markReadyIfProcessing).toHaveBeenCalledTimes(1);
    });

    it('never marks FAILED on the happy path', async () => {
      const repository = mediaRepo();

      await run(build({ productMediaRepository: repository }));

      expect(repository.markFailedIfProcessing).not.toHaveBeenCalled();
    });

    it('derives every variant key from server-held ids, with the width and the format extension', async () => {
      const store = objectStore();

      await run(build({ objectStore: store }));

      const keys = vi.mocked(store.putObject).mock.calls.map((call) => call[0]);
      expect(keys).toContain(`product-media/${vendorId}/${productId}/${mediaId}/200.webp`);
      expect(keys).toContain(`product-media/${vendorId}/${productId}/${mediaId}/1600.avif`);
      expect(new Set(keys).size).toBe(8);
    });

    it('re-encodes rather than republishing the original — no derived key is the original’s', async () => {
      const store = objectStore();

      await run(build({ objectStore: store }));

      expect(vi.mocked(store.putObject).mock.calls.map((call) => call[0])).not.toContain(
        OBJECT_KEY,
      );
    });

    it('stores each derived object under its own content type', async () => {
      const store = objectStore();

      await run(build({ objectStore: store }));

      const types = new Set(vi.mocked(store.putObject).mock.calls.map((call) => call[2]));
      expect(types).toEqual(new Set(['image/webp', 'image/avif']));
    });

    it('reads the original exactly once, however many variants it produces', async () => {
      const store = objectStore();

      await run(build({ objectStore: store }));

      expect(store.getObject).toHaveBeenCalledTimes(1);
      expect(store.getObject).toHaveBeenCalledWith(OBJECT_KEY);
    });
  });

  describe('idempotency (duplicate delivery)', () => {
    it('is a no-op for a media item that no longer exists — or that this tenant cannot see', async () => {
      const repository = mediaRepo({ findById: vi.fn().mockResolvedValue(null) });
      const store = objectStore();

      await run(build({ productMediaRepository: repository, objectStore: store }));

      expect(store.getObject).not.toHaveBeenCalled();
      expect(repository.markReadyIfProcessing).not.toHaveBeenCalled();
      expect(repository.markFailedIfProcessing).not.toHaveBeenCalled();
    });

    it('is a no-op for an already-READY item — a late duplicate does no work at all', async () => {
      const repository = mediaRepo({ findById: vi.fn().mockResolvedValue(media('READY')) });
      const store = objectStore();
      const variants = variantRepo();

      await run(
        build({
          productMediaRepository: repository,
          objectStore: store,
          productMediaVariantRepository: variants,
        }),
      );

      expect(store.getObject).not.toHaveBeenCalled();
      expect(store.putObject).not.toHaveBeenCalled();
      expect(variants.createIfAbsent).not.toHaveBeenCalled();
      expect(repository.markReadyIfProcessing).not.toHaveBeenCalled();
    });

    it('refuses an item still AWAITING_UPLOAD — the queue should never have delivered it', async () => {
      const repository = mediaRepo({
        findById: vi.fn().mockResolvedValue(media('AWAITING_UPLOAD')),
      });
      const store = objectStore();

      await run(build({ productMediaRepository: repository, objectStore: store }));

      expect(store.getObject).not.toHaveBeenCalled();
      expect(repository.markReadyIfProcessing).not.toHaveBeenCalled();
    });

    it('stops without writing when it loses the READY race', async () => {
      const repository = mediaRepo({ markReadyIfProcessing: vi.fn().mockResolvedValue(false) });

      await expect(run(build({ productMediaRepository: repository }))).resolves.toBeUndefined();
      expect(repository.markFailedIfProcessing).not.toHaveBeenCalled();
    });

    it('skips the pairs a previous attempt already wrote', async () => {
      const already = [200, 400].map((width) =>
        ProductMediaVariant.reconstitute({
          id: toProductMediaVariantId(ids.generate()),
          mediaId,
          vendorId,
          width: width as 200 | 400,
          format: 'WEBP',
          objectKey: `k-${width}`,
          sizeBytes: 10,
          createdAt: NOW,
        }),
      );
      const variants = variantRepo({ listByMediaId: vi.fn().mockResolvedValue(already) });
      const store = objectStore();

      await run(build({ productMediaVariantRepository: variants, objectStore: store }));

      expect(store.putObject).toHaveBeenCalledTimes(6);
      expect(variants.createIfAbsent).toHaveBeenCalledTimes(6);
    });

    it('does not re-encode at all when all eight pairs are already present', async () => {
      const already = PRODUCT_MEDIA_VARIANT_WIDTHS.flatMap((width) =>
        PRODUCT_MEDIA_VARIANT_FORMATS.map((format) =>
          ProductMediaVariant.reconstitute({
            id: toProductMediaVariantId(ids.generate()),
            mediaId,
            vendorId,
            width,
            format,
            objectKey: `${width}.${format}`,
            sizeBytes: 10,
            createdAt: NOW,
          }),
        ),
      );
      const variants = variantRepo({ listByMediaId: vi.fn().mockResolvedValue(already) });
      const processor = imageProcessor();
      const repository = mediaRepo();

      await run(
        build({
          productMediaVariantRepository: variants,
          imageProcessor: processor,
          productMediaRepository: repository,
        }),
      );

      expect(processor.generateVariants).not.toHaveBeenCalled();
      // Still finishes: a resumed item whose variants were all written but
      // whose status write did not land must still reach READY.
      expect(repository.markReadyIfProcessing).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry from FAILED (D-S2-6-K)', () => {
    it('re-enters PROCESSING first, then runs the pipeline', async () => {
      const repository = mediaRepo({ findById: vi.fn().mockResolvedValue(media('FAILED')) });
      const store = objectStore();

      await run(build({ productMediaRepository: repository, objectStore: store }));

      expect(repository.markProcessingIfFailed).toHaveBeenCalledTimes(1);
      expect(store.putObject).toHaveBeenCalledTimes(8);
      expect(repository.markReadyIfProcessing).toHaveBeenCalledTimes(1);
    });

    it('does no work when another worker won the retry race', async () => {
      const repository = mediaRepo({
        findById: vi.fn().mockResolvedValue(media('FAILED')),
        markProcessingIfFailed: vi.fn().mockResolvedValue(false),
      });
      const store = objectStore();

      await run(build({ productMediaRepository: repository, objectStore: store }));

      expect(store.getObject).not.toHaveBeenCalled();
      expect(repository.markReadyIfProcessing).not.toHaveBeenCalled();
    });
  });

  describe('permanent failures — classified, written immediately, never retried', () => {
    const expectPermanent = async (options: BuildOptions, reason: string): Promise<void> => {
      const repository = options.productMediaRepository ?? mediaRepo();
      const useCase = build({ ...options, productMediaRepository: repository });

      // Not rethrown: spending BullMQ's retry budget on a verdict that cannot
      // change would only delay the vendor's own answer.
      await expect(run(useCase, 1, 3)).resolves.toBeUndefined();

      expect(repository.markFailedIfProcessing).toHaveBeenCalledTimes(1);
      const written = vi.mocked(repository.markFailedIfProcessing).mock.calls[0]?.[0];
      expect(written?.status).toBe('FAILED');
      expect(written?.failureReason).toBe(reason);
      expect(repository.markReadyIfProcessing).not.toHaveBeenCalled();
    };

    it('OBJECT_NOT_FOUND when the object was never uploaded', async () => {
      await expectPermanent(
        { objectStore: objectStore({ head: vi.fn().mockResolvedValue(null) }) },
        'OBJECT_NOT_FOUND',
      );
    });

    it('OBJECT_NOT_FOUND when the object vanished between head and read', async () => {
      await expectPermanent(
        { objectStore: objectStore({ getObject: vi.fn().mockResolvedValue(null) }) },
        'OBJECT_NOT_FOUND',
      );
    });

    it('SVG_REJECTED for an SVG, whatever it was declared as', async () => {
      await expectPermanent(
        {
          imageProcessor: imageProcessor({
            readMetadata: vi.fn().mockResolvedValue({ format: 'svg', width: 10, height: 10 }),
          }),
        },
        'SVG_REJECTED',
      );
    });

    it('CONTENT_TYPE_MISMATCH when the bytes disagree with the declared type', async () => {
      await expectPermanent(
        {
          imageProcessor: imageProcessor({
            // Declared image/jpeg by the row; the decoder says PNG.
            readMetadata: vi.fn().mockResolvedValue({ format: 'png', width: 10, height: 10 }),
          }),
        },
        'CONTENT_TYPE_MISMATCH',
      );
    });

    it('DECODE_FAILED when the bytes are not an image at all', async () => {
      await expectPermanent(
        {
          imageProcessor: imageProcessor({
            readMetadata: vi.fn().mockRejectedValue(new ImageDecodeError(new Error('bad'))),
          }),
        },
        'DECODE_FAILED',
      );
    });

    it('writes nothing to the object store once the type check fails', async () => {
      const store = objectStore();

      await run(
        build({
          objectStore: store,
          imageProcessor: imageProcessor({
            readMetadata: vi.fn().mockResolvedValue({ format: 'png', width: 10, height: 10 }),
          }),
        }),
      );

      expect(store.putObject).not.toHaveBeenCalled();
    });
  });

  describe('transient failures — retried by BullMQ, FAILED only once the budget is spent', () => {
    const flaky = (): ImageProcessor =>
      imageProcessor({
        generateVariants: vi.fn().mockRejectedValue(new Error('libvips exploded')),
      });

    it('rethrows and writes no status on an attempt that is not the last', async () => {
      const repository = mediaRepo();

      await expect(
        run(build({ imageProcessor: flaky(), productMediaRepository: repository }), 1, 3),
      ).rejects.toThrow(/libvips exploded/);

      expect(repository.markFailedIfProcessing).not.toHaveBeenCalled();
      expect(repository.markReadyIfProcessing).not.toHaveBeenCalled();
    });

    it('writes FAILED on the final attempt, and still rethrows so BullMQ sees it', async () => {
      const repository = mediaRepo();

      await expect(
        run(build({ imageProcessor: flaky(), productMediaRepository: repository }), 3, 3),
      ).rejects.toThrow(/libvips exploded/);

      expect(repository.markFailedIfProcessing).toHaveBeenCalledTimes(1);
      expect(vi.mocked(repository.markFailedIfProcessing).mock.calls[0]?.[0].failureReason).toBe(
        'PROCESSING_ERROR',
      );
    });

    it('records a safe code, never the exception text', async () => {
      const repository = mediaRepo();

      await expect(
        run(
          build({
            imageProcessor: imageProcessor({
              generateVariants: vi
                .fn()
                .mockRejectedValue(new Error('postgres://user:hunter2@db/leenmart timed out')),
            }),
            productMediaRepository: repository,
          }),
          3,
          3,
        ),
      ).rejects.toThrow();

      const written = vi.mocked(repository.markFailedIfProcessing).mock.calls[0]?.[0];
      expect(written?.failureReason).toBe('PROCESSING_ERROR');
      expect(written?.failureReason).not.toMatch(/hunter2/);
    });

    it('still rethrows the original error when recording the failure itself fails', async () => {
      const repository = mediaRepo({
        markFailedIfProcessing: vi.fn().mockRejectedValue(new Error('database is down too')),
      });

      await expect(
        run(build({ imageProcessor: flaky(), productMediaRepository: repository }), 3, 3),
      ).rejects.toThrow(/libvips exploded/);
    });

    it('never reaches READY after a transient failure', async () => {
      const repository = mediaRepo();

      await expect(
        run(build({ imageProcessor: flaky(), productMediaRepository: repository }), 3, 3),
      ).rejects.toThrow();

      expect(repository.markReadyIfProcessing).not.toHaveBeenCalled();
    });
  });
});
