import {
  toUuid,
  type Clock,
  type Logger,
  type TransactionRunner,
  type TransactionScope,
} from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import type { ObjectStore } from '../../../media/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { ProductMedia } from '../../domain/entities/product-media.entity.js';
import {
  IncompleteProductMediaUploadError,
  ProductMediaNotFoundError,
  ProductMediaUploadConflictError,
} from '../../domain/errors/catalogue-errors.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductMediaRepository } from '../../domain/repositories/product-media.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import type { ProductMediaId } from '../../domain/value-objects/product-media-id.value-object.js';

export interface CompleteProductMediaUploadInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly mediaId: ProductMediaId;
}

export interface CompleteProductMediaUploadResult {
  readonly media: ProductMedia;
}

export interface CompleteProductMediaUploadDeps {
  readonly productRepository: ProductRepository;
  readonly productMediaRepository: ProductMediaRepository;
  readonly objectStore: ObjectStore;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Phase 2 of a product media upload (SDD 12.2 step 4, S2-6a).
 *
 * **Never trusts the client's claim that an upload succeeded** — verifies
 * with `ObjectStore.head()` and compares the answer against what the row
 * already records, the exact discipline `SubmitVendorKycUseCase` applies to
 * each KYC document. `completeProductMediaUploadRequestSchema` carries no
 * body for the same reason: there is nothing for a client to declare that
 * this use case would trust over the store's own answer.
 *
 * **Also where ASM-14 lives (S2-6a D-S2-6-L).** SDD 15.2's edit-triggers-
 * re-review table names "images" explicitly: a media change on an `APPROVED`
 * product returns it to `PENDING_REVIEW`, atomically, in this same
 * transaction — never as a separate call a client could omit. Only this
 * trigger is wired; title/category/brand/attribute edits are untouched, the
 * same restraint `UpdateProductUseCase` already keeps.
 */
export class CompleteProductMediaUploadUseCase {
  constructor(private readonly deps: CompleteProductMediaUploadDeps) {}

  async execute(input: CompleteProductMediaUploadInput): Promise<CompleteProductMediaUploadResult> {
    const {
      productRepository,
      productMediaRepository,
      objectStore,
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

      await this.assertUploadLanded(objectStore, existing);

      const now = clock.now();
      // Domain first: refuses a status that already forbids completion.
      const completed = existing.completeUpload(now);

      // Then the race the domain cannot see. Both callers may have loaded
      // the same eligible row before either wrote; only one conditional
      // update can flip `status` away from `AWAITING_UPLOAD`.
      if (!(await media.completeIfAwaitingUpload(completed))) {
        throw new ProductMediaUploadConflictError();
      }

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_MEDIA_ADDED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(input.productId),
        after: {
          mediaId: completed.id,
          contentType: completed.contentType,
          sizeBytes: completed.sizeBytes,
        },
      });

      await this.triggerAsm14IfApproved({
        products,
        auditWriter,
        scope,
        principal: input.principal,
        productId: input.productId,
        now,
      });

      logger.info(
        { productId: input.productId, mediaId: completed.id },
        'Product media upload completed',
      );

      return { media: completed };
    });
  }

  /**
   * Never trusts the client's claim that an upload succeeded — verifies with
   * `ObjectStore.head()` and compares the answer against what the row already
   * records, the exact discipline `SubmitVendorKycUseCase` applies to each
   * KYC document. Split out purely to keep `execute` within this file's line
   * budget.
   */
  private async assertUploadLanded(
    objectStore: ObjectStore,
    existing: ProductMedia,
  ): Promise<void> {
    const stored = await objectStore.head(existing.objectKey);
    if (!stored) {
      throw new IncompleteProductMediaUploadError('the file has not been uploaded');
    }
    if (stored.sizeBytes !== existing.sizeBytes) {
      throw new IncompleteProductMediaUploadError('the uploaded file is a different size');
    }
    if (stored.contentType !== existing.contentType) {
      throw new IncompleteProductMediaUploadError('the uploaded file is a different type');
    }
  }

  /**
   * ASM-14: only if the product is *currently* APPROVED — read after the
   * media write, inside the same transaction, so this sees a consistent
   * snapshot. `reenterReviewIfApproved`'s own `WHERE status = 'APPROVED'` is
   * the real arbiter; a lost race here (the product moved away from
   * APPROVED between this read and that write — an admin decision, or
   * another concurrent media change already reopened it) is not an error.
   * The media item is completed either way, and forcing a reentry the
   * winner of that race already made moot, or correctly refused, would be
   * wrong. Split out purely to keep `execute` within this file's line
   * budget — `RemoveProductMediaUseCase` repeats the same block inline.
   */
  private async triggerAsm14IfApproved(params: {
    products: ReturnType<ProductRepository['withTransaction']>;
    auditWriter: AuditWriter;
    scope: TransactionScope;
    principal: CompleteProductMediaUploadInput['principal'];
    productId: ProductId;
    now: Date;
  }): Promise<void> {
    const { products, auditWriter, scope, principal, productId, now } = params;
    const product = await products.findById(productId);
    if (!product || product.status !== 'APPROVED') {
      return;
    }
    const reopened = product.reenterReviewForMediaChange(now);
    if (await products.reenterReviewIfApproved(reopened)) {
      await auditWriter.withTransaction(scope).record({
        actorId: principal.userId,
        actorRole: principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_MEDIA_CHANGE,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(productId),
        before: { status: product.status },
        after: { status: reopened.status },
      });
    }
  }
}
