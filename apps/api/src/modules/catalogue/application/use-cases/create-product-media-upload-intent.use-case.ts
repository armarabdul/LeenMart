import type { Clock, IdGenerator, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import { MAX_IMAGES_PER_PRODUCT } from '@leen-mart/contracts';
import type { Principal, VendorId } from '../../../identity/index.js';
import type { ObjectStore } from '../../../media/index.js';
import { ProductMedia } from '../../domain/entities/product-media.entity.js';
import {
  ProductMediaLimitExceededError,
  ProductNotFoundError,
} from '../../domain/errors/catalogue-errors.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductMediaRepository } from '../../domain/repositories/product-media.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import {
  toProductMediaId,
  type ProductMediaId,
} from '../../domain/value-objects/product-media-id.value-object.js';

export interface CreateProductMediaUploadIntentInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface CreateProductMediaUploadIntentResult {
  readonly media: ProductMedia;
  readonly uploadUrl: string;
  readonly expiresAt: Date;
}

export interface CreateProductMediaUploadIntentDeps {
  readonly productRepository: ProductRepository;
  readonly productMediaRepository: ProductMediaRepository;
  readonly objectStore: ObjectStore;
  readonly transactionRunner: TransactionRunner;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** jpeg/png/webp only, at the storage layer too — mirrors the contract's `productMediaContentTypeSchema` exactly (D-S2-6-I). */
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * The permanent object-key convention, applied in exactly one place —
 * mirrors `CreateKycUploadIntentUseCase`'s `objectKeyFor` exactly. Every
 * component is server-controlled: `vendorId`/`productId` come from the
 * already-loaded, tenant-scoped `Product`, and `mediaId` was generated
 * moments ago. Nothing a client sends reaches this string, which is what
 * makes it impossible to aim an upload at another vendor's or product's
 * prefix. `S3ObjectStore.presignPut` refuses any `contentType` outside the
 * allowlist before this is even called, so the fallback below is defensive
 * only — unreachable in practice.
 */
const objectKeyFor = (
  vendorId: VendorId,
  productId: ProductId,
  mediaId: ProductMediaId,
  contentType: string,
): string => {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? 'bin';
  return `product-media/${vendorId}/${productId}/${mediaId}.${extension}`;
};

/**
 * Phase 1 of a product media upload (SDD 12.2 steps 1–2, S2-6a).
 *
 * Unlike `CreateKycUploadIntentUseCase`, this use case **does persist** a
 * row — SDD 12.2's own wording for the generic pipeline: "returns a
 * presigned PUT URL... + a pending media_asset row (status =
 * AWAITING_UPLOAD)". KYC deviates from that (persists nothing) because a
 * `kyc_documents` row cannot exist before its parent submission does; a
 * `ProductMedia` row has no such ordering problem — its parent `Product`
 * already exists by the time a vendor asks to add media to it.
 *
 * Takes the same parent-row lock `AddProductVariantUseCase` does
 * (`lockForMediaChange`, not `lockForVariantChange` — a distinct method
 * guarding a distinct invariant), so the count-then-create that enforces
 * `MAX_IMAGES_PER_PRODUCT` cannot race a concurrent upload into leaving nine
 * where the cap says eight.
 */
export class CreateProductMediaUploadIntentUseCase {
  constructor(private readonly deps: CreateProductMediaUploadIntentDeps) {}

  async execute(
    input: CreateProductMediaUploadIntentInput,
  ): Promise<CreateProductMediaUploadIntentResult> {
    const {
      productRepository,
      productMediaRepository,
      objectStore,
      transactionRunner,
      idGenerator,
      clock,
      logger,
    } = this.deps;

    return transactionRunner.run(async (scope) => {
      const products = productRepository.withTransaction(scope);
      const now = clock.now();

      if (!(await products.lockForMediaChange(input.productId, now))) {
        throw new ProductNotFoundError();
      }

      const product = await products.findById(input.productId);
      /* c8 ignore next 3 */
      if (!product) {
        throw new ProductNotFoundError(); // unreachable: the lock above already proved it live
      }

      const media = productMediaRepository.withTransaction(scope);

      // Read under the lock, so it cannot be stale by the time the create runs.
      if ((await media.countLiveForProduct(input.productId)) >= MAX_IMAGES_PER_PRODUCT) {
        throw new ProductMediaLimitExceededError();
      }

      const mediaId = toProductMediaId(idGenerator.generate());
      const objectKey = objectKeyFor(product.vendorId, product.id, mediaId, input.contentType);

      // Validated against the allowlist and size cap here, never after — an
      // issued URL is a capability, and there is no taking one back.
      const presigned = await objectStore.presignPut({
        key: objectKey,
        contentType: input.contentType,
        contentLength: input.sizeBytes,
      });

      const entity = ProductMedia.create({
        id: mediaId,
        productId: product.id,
        vendorId: product.vendorId,
        objectKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        now,
      });

      await media.create(entity);

      // No audit here, deliberately: nothing real has happened yet — an
      // intent the vendor never completes leaves no trace, the same
      // restraint `ListKycReviewQueueUseCase`'s "reads change nothing"
      // applies one step earlier than a read.
      logger.info(
        { productId: product.id, mediaId, vendorId: product.vendorId },
        'Product media upload intent created',
      );

      return { media: entity, uploadUrl: presigned.url, expiresAt: presigned.expiresAt };
    });
  }
}
