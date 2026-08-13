import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { Product } from '../../domain/entities/product.entity.js';
import {
  IncompleteProductSubmissionError,
  ProductNotFoundError,
  ProductSubmissionConflictError,
} from '../../domain/errors/catalogue-errors.js';
import type { CategoryRequirements } from '../../domain/entities/category.entity.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

export interface SubmitProductForReviewInput {
  readonly principal: Principal;
  readonly productId: ProductId;
}

export interface SubmitProductForReviewResult {
  readonly product: Product;
}

export interface SubmitProductForReviewDeps {
  readonly productRepository: ProductRepository;
  readonly categoryRepository: CategoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * A vendor asks for one of their own products to be reviewed (S2-5, SDD
 * 15.2). Reachable from `DRAFT` on a first attempt and from `REJECTED` on a
 * resubmission — both land the product on `PENDING_REVIEW`, and both go
 * through this one use case, the same way `VendorKyc.submit` serves KYC's
 * first attempt and its resubmission identically.
 *
 * **Mandatory-field completeness (BR-15/BR-21) is checked here, once, at the
 * moment of submission — never on an ordinary `PATCH`.** `S2-3 D-2` deferred
 * this exact check "to the later moderation/submission flow"; this is that
 * flow. A `DRAFT` may stay incomplete indefinitely — only asking to enter
 * `PENDING_REVIEW` requires the category's required fields to be present.
 *
 * The category is read before the transaction opens, the same discipline
 * `CreateProductUseCase` follows: a request that is going to fail the
 * pre-screen should never cost a database write.
 *
 * The conditional write (`submitForReviewIfEligible`) is what makes two
 * concurrent submissions safe — `Product.submitForReview` already refuses the
 * ordinary case where the loaded status forbids it, but only the database can
 * arbitrate two callers who both loaded an eligible row.
 */
export class SubmitProductForReviewUseCase {
  constructor(private readonly deps: SubmitProductForReviewDeps) {}

  /** The mandatory-field pre-screen, split out to keep `execute` under this file's line budget. */
  private assertMandatoryFieldsComplete(
    product: Product,
    requirements: CategoryRequirements,
  ): void {
    const missing: string[] = [];
    if (requirements.requiresHsn && !product.hsnCode) {
      missing.push('hsnCode');
    }
    if (requirements.requiresCountryOfOrigin && !product.countryOfOrigin) {
      missing.push('countryOfOrigin');
    }
    if (requirements.requiresNetQuantity && !product.netQuantity) {
      missing.push('netQuantity');
    }
    if (missing.length > 0) {
      throw new IncompleteProductSubmissionError(
        `this product's category requires: ${missing.join(', ')}`,
      );
    }
  }

  async execute(input: SubmitProductForReviewInput): Promise<SubmitProductForReviewResult> {
    const { productRepository, categoryRepository, transactionRunner, auditWriter, clock, logger } =
      this.deps;

    const existing = await productRepository.findById(input.productId);
    if (!existing) {
      throw new ProductNotFoundError();
    }

    // Platform-owned, so no tenant scoping is needed to read it — the same
    // read `CreateProductUseCase`/`UpdateProductUseCase` perform.
    const category = await categoryRepository.findById(existing.categoryId);
    if (!category) {
      // Unreachable in practice (`Product.categoryId` is a foreign key with
      // `onDelete: Restrict`), but answered the same way a genuinely missing
      // category would be rather than assumed away.
      throw new ProductNotFoundError();
    }
    this.assertMandatoryFieldsComplete(existing, category.requirements);

    const now = clock.now();
    // Domain first: refuses a status that already forbids submission.
    const submitted = existing.submitForReview(now);

    return transactionRunner.run(async (scope) => {
      const repository = productRepository.withTransaction(scope);

      // Then the race the domain cannot see. Both callers may have loaded the
      // same eligible row before either wrote; only one conditional update
      // can flip `status` away from DRAFT/REJECTED.
      if (!(await repository.submitForReviewIfEligible(submitted))) {
        throw new ProductSubmissionConflictError();
      }

      // Only the winner reaches here — the loser threw above and this
      // transaction never opened for them, so a lost race writes no audit row.
      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_SUBMITTED_FOR_REVIEW,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(submitted.id),
        before: { status: existing.status },
        after: { status: submitted.status },
      });

      logger.info(
        { productId: submitted.id, vendorId: submitted.vendorId },
        'Product submitted for review',
      );

      return { product: submitted };
    });
  }
}
