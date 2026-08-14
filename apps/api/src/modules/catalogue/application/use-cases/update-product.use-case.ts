import {
  toUuid,
  type Clock,
  type Logger,
  type TransactionRunner,
  type TransactionScope,
} from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { Product, ProductDetailChanges } from '../../domain/entities/product.entity.js';
import {
  CategoryNotFoundError,
  ProductNotFoundError,
  ProductUpdateConflictError,
} from '../../domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

export interface UpdateProductInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly changes: ProductDetailChanges;
}

export interface UpdateProductResult {
  readonly product: Product;
}

export interface UpdateProductDeps {
  readonly productRepository: ProductRepository;
  readonly categoryRepository: CategoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

const hasChanges = (changes: ProductDetailChanges): boolean =>
  Object.values(changes).some((value) => value !== undefined);

/**
 * A partial edit of one of the caller's own products (SDD 9.2's `PATCH`
 * semantics).
 *
 * The product is found through the tenant-scoped repository, so another
 * vendor's id reads as absent exactly the way a nonexistent one does — the
 * 404 below is the same answer in both cases, and deliberately so (SDD 6.6).
 *
 * Moving a product to another category re-checks that the category exists,
 * the same read `CreateProductUseCase` performs — a `categoryId` naming
 * nothing must fail before it costs a write. It does **not** re-validate the
 * product against the new category's requirement flags: that is the
 * submission flow's question and it does not exist yet (S2-3 D-2).
 *
 * `status` cannot be reached from here. `ProductDetailChanges` has no such
 * field and `Product` has no mutator for it — but a name/category/brand edit
 * to an `APPROVED` product still moves `status`, indirectly, through ASM-14's
 * detail-edit trigger (S2-8): see `persist` below.
 */
export class UpdateProductUseCase {
  constructor(private readonly deps: UpdateProductDeps) {}

  async execute(input: UpdateProductInput): Promise<UpdateProductResult> {
    const { productRepository, categoryRepository, transactionRunner, auditWriter, clock, logger } =
      this.deps;

    if (input.changes.categoryId !== undefined) {
      const category = await categoryRepository.findById(input.changes.categoryId);
      if (!category) {
        throw new CategoryNotFoundError();
      }
    }

    return transactionRunner.run(async (scope) => {
      const repository = productRepository.withTransaction(scope);

      const existing = await repository.findById(input.productId);
      if (!existing) {
        throw new ProductNotFoundError();
      }

      const now = clock.now();
      const updated = existing.updateDetails(input.changes, now);
      const product = await this.persist({
        repository,
        existing,
        updated,
        now,
        scope,
        principal: input.principal,
      });

      if (hasChanges(input.changes)) {
        await auditWriter.withTransaction(scope).record({
          actorId: input.principal.userId,
          actorRole: input.principal.role,
          action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_UPDATED,
          entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
          entityId: toUuid(product.id),
          before: { categoryId: existing.categoryId, name: existing.name },
          after: { categoryId: product.categoryId, name: product.name },
        });
      }

      logger.info({ productId: product.id, vendorId: product.vendorId }, 'Product updated');

      return { product };
    });
  }

  /**
   * Persists the edit and, only when it touches ASM-14's detail-edit trigger
   * fields (name, category, brand) on a product that was `APPROVED`, reopens
   * it for review in the same conditional write (S2-8) — mirrors
   * `CompleteProductMediaUploadUseCase.triggerAsm14IfApproved`'s own
   * "database decides who wins" reasoning, one aggregate over: the trigger
   * fields are compared *after* normalisation (`updated` vs `existing`), so a
   * whitespace-only or same-value "change" never reopens anything. Split out
   * purely to keep `execute` within this file's line budget.
   */
  private async persist(params: {
    repository: ProductRepository;
    existing: Product;
    updated: Product;
    now: Date;
    scope: TransactionScope;
    principal: Principal;
  }): Promise<Product> {
    const { repository, existing, updated, now, scope, principal } = params;
    const triggersReReview =
      existing.status === 'APPROVED' &&
      (updated.name !== existing.name ||
        updated.categoryId !== existing.categoryId ||
        updated.brand !== existing.brand);

    if (!triggersReReview) {
      if (!(await repository.update(updated))) {
        // Vanished between the read and the write — the same answer a caller
        // gets for an id that was never there.
        throw new ProductNotFoundError();
      }
      return updated;
    }

    const reopened = updated.reenterReviewForDetailChange(now);
    if (!(await repository.updateAndReenterReviewIfApproved(reopened))) {
      // The product was no longer APPROVED by the time this write reached
      // PostgreSQL — a concurrent edit or another trigger raced this one.
      // Unlike the media trigger's "not an error" race, this write *is* the
      // edit itself, so a lost race must not apply the edit silently.
      throw new ProductUpdateConflictError();
    }
    await this.deps.auditWriter.withTransaction(scope).record({
      actorId: principal.userId,
      actorRole: principal.role,
      action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_DETAIL_CHANGE,
      entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
      entityId: toUuid(reopened.id),
      before: { status: existing.status },
      after: { status: reopened.status },
    });
    return reopened;
  }
}
