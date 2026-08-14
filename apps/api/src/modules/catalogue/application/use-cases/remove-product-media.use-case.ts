import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { ProductMedia } from '../../domain/entities/product-media.entity.js';
import { ProductMediaNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductMediaRepository } from '../../domain/repositories/product-media.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import type { ProductMediaId } from '../../domain/value-objects/product-media-id.value-object.js';

export interface RemoveProductMediaInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly mediaId: ProductMediaId;
}

export interface RemoveProductMediaResult {
  readonly media: ProductMedia;
}

export interface RemoveProductMediaDeps {
  readonly productRepository: ProductRepository;
  readonly productMediaRepository: ProductMediaRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Soft-deletes one media item (S2-6a). No lock, unlike
 * `RemoveProductVariantUseCase`: media carries no "at least one" invariant
 * (`MIN_IMAGES_PER_PRODUCT` is 0, D-S2-6-I), so a removal never needs
 * serialising against the max-count check a *creation* does — only the count
 * going up is race-prone.
 *
 * Also where ASM-14's other trigger lives (S2-6a D-S2-6-L, "adding/changing/
 * *deleting*"): a removal on an `APPROVED` product returns it to
 * `PENDING_REVIEW`, atomically, in this same transaction — mirrors
 * `CompleteProductMediaUploadUseCase`'s own trigger exactly.
 */
export class RemoveProductMediaUseCase {
  constructor(private readonly deps: RemoveProductMediaDeps) {}

  async execute(input: RemoveProductMediaInput): Promise<RemoveProductMediaResult> {
    const {
      productRepository,
      productMediaRepository,
      transactionRunner,
      auditWriter,
      clock,
      logger,
    } = this.deps;

    return transactionRunner.run(async (scope) => {
      const products = productRepository.withTransaction(scope);
      const media = productMediaRepository.withTransaction(scope);

      const existing = await media.findByProductAndId(input.productId, input.mediaId);
      if (!existing) {
        throw new ProductMediaNotFoundError();
      }

      const now = clock.now();
      const deleted = existing.softDelete(now);
      if (!(await media.softDelete(deleted))) {
        // Vanished between the read and the write — the same answer a
        // caller gets for an id that was never there.
        throw new ProductMediaNotFoundError();
      }

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_MEDIA_REMOVED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(input.productId),
        before: {
          mediaId: existing.id,
          contentType: existing.contentType,
          sizeBytes: existing.sizeBytes,
        },
      });

      // ASM-14 — see `CompleteProductMediaUploadUseCase` for the full
      // reasoning; identical here, one transition later.
      const product = await products.findById(input.productId);
      if (product && product.status === 'APPROVED') {
        const reopened = product.reenterReviewForMediaChange(now);
        if (await products.reenterReviewIfApproved(reopened)) {
          await auditWriter.withTransaction(scope).record({
            actorId: input.principal.userId,
            actorRole: input.principal.role,
            action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_MEDIA_CHANGE,
            entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
            entityId: toUuid(input.productId),
            before: { status: product.status },
            after: { status: reopened.status },
          });
        }
      }

      logger.info({ productId: input.productId, mediaId: deleted.id }, 'Product media removed');

      return { media: deleted };
    });
  }
}
