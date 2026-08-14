import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { ObjectStore } from '../../../media/index.js';
import { createProductMediaReadyEvent } from '../../domain/events/product-media-ready.event.js';
import {
  type ProductMedia,
  type ProductMediaFailureReason,
} from '../../domain/entities/product-media.entity.js';
import {
  PRODUCT_MEDIA_VARIANT_FORMATS,
  PRODUCT_MEDIA_VARIANT_WIDTHS,
  ProductMediaVariant,
  type ProductMediaVariantFormat,
  type ProductMediaVariantWidth,
} from '../../domain/entities/product-media-variant.entity.js';
import type { ProductMediaRepository } from '../../domain/repositories/product-media.repository.js';
import type { ProductMediaVariantRepository } from '../../domain/repositories/product-media-variant.repository.js';
import { toProductMediaVariantId } from '../../domain/value-objects/product-media-variant-id.value-object.js';
import type { ProductMediaId } from '../../domain/value-objects/product-media-id.value-object.js';
import { ImageDecodeError, type ImageProcessor } from '../ports/image-processor.port.js';

export interface ProcessProductMediaInput {
  readonly mediaId: ProductMediaId;
  /**
   * Which delivery this is, 1-based — BullMQ's `job.attemptsStarted`, which
   * it increments as the job moves to active (S2-6b). Deliberately not
   * `job.attemptsMade`: that one counts attempts that have already *failed*,
   * so it reads 0 on the first delivery and would put this use case one
   * behind the ceiling below.
   */
  readonly attemptNumber: number;
  /** From `job.opts.attempts` — the bounded ceiling `product-media-queue.ts` configures. */
  readonly maxAttempts: number;
}

export interface ProcessProductMediaDeps {
  readonly productMediaRepository: ProductMediaRepository;
  readonly productMediaVariantRepository: ProductMediaVariantRepository;
  readonly objectStore: ObjectStore;
  readonly imageProcessor: ImageProcessor;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

const EXPECTED_VARIANT_COUNT =
  PRODUCT_MEDIA_VARIANT_WIDTHS.length * PRODUCT_MEDIA_VARIANT_FORMATS.length;

const EXPECTED_SHARP_FORMAT_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const CONTENT_TYPE_BY_VARIANT_FORMAT: Readonly<Record<ProductMediaVariantFormat, string>> = {
  WEBP: 'image/webp',
  AVIF: 'image/avif',
};

const EXTENSION_BY_VARIANT_FORMAT: Readonly<Record<ProductMediaVariantFormat, string>> = {
  WEBP: 'webp',
  AVIF: 'avif',
};

const variantKey = (width: ProductMediaVariantWidth, format: ProductMediaVariantFormat): string =>
  `${width}:${format}`;

/**
 * The permanent-media-key convention for a variant, mirroring
 * `CreateProductMediaUploadIntentUseCase`'s own `objectKeyFor` exactly:
 * every component is server-computed from ids the vendor never supplies.
 */
const variantObjectKeyFor = (
  media: ProductMedia,
  width: ProductMediaVariantWidth,
  format: ProductMediaVariantFormat,
): string =>
  `product-media/${media.vendorId}/${media.productId}/${media.id}/${width}.${EXTENSION_BY_VARIANT_FORMAT[format]}`;

/** Internal signal for a failure no retry could fix — caught once, in `execute`, and turned into `FAILED` without spending BullMQ's retry budget. */
class PermanentProcessingFailure extends Error {
  constructor(readonly reason: ProductMediaFailureReason) {
    super(reason);
    this.name = 'PermanentProcessingFailure';
  }
}

/**
 * The async media-processing pipeline (S2-6b, SDD 12.2 step 5): magic-byte
 * validation, SVG rejection, re-encode, EXIF/GPS strip, the 8-variant
 * matrix, then `READY`.
 *
 * **Deliberately not wrapped in one `TransactionRunner.run(...)` the way
 * every other use case in this module is.** Those use cases are a handful of
 * fast, all-database operations; this one spans a network read from object
 * storage, CPU-bound Sharp work, and 8 more network writes — holding a single
 * open transaction across all of that would pin a connection for the
 * pipeline's entire, genuinely variable duration. Each database write below
 * is instead its own short, independently-committed, conditional operation
 * (`markProcessingIfFailed`, `createIfAbsent` per variant, then
 * `markReadyIfProcessing`) — safe to interleave with another worker's
 * attempt at the same item precisely because each one already carries its
 * own "database decides who wins" guard, the same discipline this module
 * keeps everywhere else, just applied per-step instead of once per call.
 *
 * Runs inside the tenant context the caller already established via
 * `runWithTenant` (S2-6b) — see `product-media-worker.ts` — so every
 * repository call here is scoped by RLS exactly as an HTTP request's would
 * be, never on `adminPrisma`.
 */
export class ProcessProductMediaUseCase {
  constructor(private readonly deps: ProcessProductMediaDeps) {}

  async execute(input: ProcessProductMediaInput): Promise<void> {
    const { productMediaRepository, clock, logger } = this.deps;
    const now = clock.now();

    const media = await productMediaRepository.findById(input.mediaId);
    if (!media) {
      logger.warn({ mediaId: input.mediaId }, 'Product media processing job found no such row');
      return;
    }

    const working = await this.enterProcessing(media, now);
    if (!working) {
      return;
    }

    try {
      await this.runPipeline(working);
    } catch (error) {
      await this.handleFailure(working, error, input.attemptNumber, input.maxAttempts);
    }
  }

  /**
   * Resolves the row's status into "there is pipeline work to do on this
   * entity" or `null` ("nothing to do; stop"). Idempotency lives here:
   * `READY` short-circuits (a late redelivery of an already-finished job),
   * `FAILED` re-enters `PROCESSING` under the same conditional-write
   * arbitration every other transition in this module uses, and anything
   * other than `PROCESSING` itself is refused as a data-integrity guard —
   * the queue should never have delivered a job for a row still
   * `AWAITING_UPLOAD`.
   */
  private async enterProcessing(media: ProductMedia, now: Date): Promise<ProductMedia | null> {
    const { productMediaRepository, logger } = this.deps;

    if (media.status === 'READY') {
      logger.info({ mediaId: media.id }, 'Product media already READY — idempotent no-op');
      return null;
    }

    if (media.status === 'FAILED') {
      const retried = media.retryProcessing(now);
      if (!(await productMediaRepository.markProcessingIfFailed(retried))) {
        logger.info({ mediaId: media.id }, 'Lost the retry race to another worker');
        return null;
      }
      return retried;
    }

    if (media.status !== 'PROCESSING') {
      logger.warn(
        { mediaId: media.id, status: media.status },
        'Product media processing job found an unexpected status; refusing',
      );
      return null;
    }

    return media;
  }

  /** The pipeline itself — throws `PermanentProcessingFailure` for a classified, unretryable defect; anything else is treated as transient by `execute`'s catch block. */
  private async runPipeline(working: ProductMedia): Promise<void> {
    const { objectStore, productMediaRepository, clock, logger } = this.deps;

    const stored = await objectStore.head(working.objectKey);
    if (!stored) {
      throw new PermanentProcessingFailure('OBJECT_NOT_FOUND');
    }
    const bytes = await objectStore.getObject(working.objectKey);
    if (!bytes) {
      throw new PermanentProcessingFailure('OBJECT_NOT_FOUND');
    }

    const metadata = await this.readMetadataOrClassify(bytes);
    if (metadata.format === 'svg') {
      throw new PermanentProcessingFailure('SVG_REJECTED');
    }
    if (EXPECTED_SHARP_FORMAT_BY_CONTENT_TYPE[working.contentType] !== metadata.format) {
      throw new PermanentProcessingFailure('CONTENT_TYPE_MISMATCH');
    }

    await this.ensureVariants(working, bytes);

    const ready = working.markReady(clock.now());
    if (await productMediaRepository.markReadyIfProcessing(ready)) {
      const event = createProductMediaReadyEvent({
        mediaId: ready.id,
        productId: ready.productId,
        vendorId: ready.vendorId,
        now: clock.now(),
      });
      // SDD 12.2 step 5i: "status = READY → domain event". Logged, not
      // dispatched — see `product-media-ready.event.ts`'s own comment on why
      // there is no outbox relay here (D-S2-6-H).
      logger.info({ event }, 'catalogue domain event');
    } else {
      logger.info(
        { mediaId: working.id },
        'Lost the READY race — another worker (or a removal) already changed this item',
      );
    }
  }

  private async readMetadataOrClassify(bytes: Buffer): ReturnType<ImageProcessor['readMetadata']> {
    try {
      return await this.deps.imageProcessor.readMetadata(bytes);
    } catch (error) {
      if (error instanceof ImageDecodeError) {
        throw new PermanentProcessingFailure('DECODE_FAILED');
      }
      throw error;
    }
  }

  /**
   * Generates and writes only the `(width, format)` pairs not already
   * present — a resumed attempt after a crash mid-pipeline skips whatever a
   * prior attempt already finished, and `createIfAbsent`'s own unique-index
   * arbitration means two workers racing on the same pair still leave
   * exactly one row.
   */
  private async ensureVariants(working: ProductMedia, bytes: Buffer): Promise<void> {
    const { objectStore, imageProcessor, productMediaVariantRepository, idGenerator, clock } =
      this.deps;

    const existing = await productMediaVariantRepository.listByMediaId(working.id);
    const existingKeys = new Set(
      existing.map((variant) => variantKey(variant.width, variant.format)),
    );
    if (existingKeys.size >= EXPECTED_VARIANT_COUNT) {
      return;
    }

    const generated = await imageProcessor.generateVariants(bytes);
    for (const variant of generated) {
      if (existingKeys.has(variantKey(variant.width, variant.format))) {
        continue;
      }
      const objectKey = variantObjectKeyFor(working, variant.width, variant.format);
      // each variant's upload+row must land before the next is attempted, so a crash mid-loop leaves a consistent (if partial) set `ensureVariants` can resume.
      await objectStore.putObject(
        objectKey,
        variant.bytes,
        CONTENT_TYPE_BY_VARIANT_FORMAT[variant.format],
      );
      const entity = ProductMediaVariant.create({
        id: toProductMediaVariantId(idGenerator.generate()),
        mediaId: working.id,
        vendorId: working.vendorId,
        width: variant.width,
        format: variant.format,
        objectKey,
        sizeBytes: variant.bytes.length,
        now: clock.now(),
      });
      await productMediaVariantRepository.createIfAbsent(entity);
    }
  }

  /**
   * A classified failure is written immediately and never rethrown — it
   * would never succeed on a later BullMQ attempt, so spending retry budget
   * on it would only delay the vendor's own answer. An unclassified
   * (transient) failure is written to `FAILED` only once BullMQ's own
   * attempts are exhausted, and is always rethrown so BullMQ's own
   * bookkeeping — and, short of that, its backoff — sees it.
   */
  private async handleFailure(
    working: ProductMedia,
    error: unknown,
    attemptNumber: number,
    maxAttempts: number,
  ): Promise<void> {
    const { productMediaRepository, clock, logger } = this.deps;

    if (error instanceof PermanentProcessingFailure) {
      const failed = working.markFailed(error.reason, clock.now());
      await productMediaRepository.markFailedIfProcessing(failed);
      logger.warn(
        { mediaId: working.id, reason: error.reason },
        'Product media processing failed permanently',
      );
      return;
    }

    logger.error(
      { mediaId: working.id, err: error, attemptNumber, maxAttempts },
      'Product media processing error',
    );

    if (attemptNumber >= maxAttempts) {
      const failed = working.markFailed('PROCESSING_ERROR', clock.now());
      // Best-effort: a failure recording the failure must not hide the
      // original error BullMQ still needs to see.
      await productMediaRepository.markFailedIfProcessing(failed).catch(() => undefined);
    }

    throw error;
  }
}
