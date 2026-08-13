import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { Category } from '../../domain/entities/category.entity.js';
import {
  CategoryNotEmptyError,
  CategoryNotFoundError,
} from '../../domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';

export interface DeleteCategoryInput {
  readonly principal: Principal;
  readonly categoryId: CategoryId;
}

export interface DeleteCategoryResult {
  readonly category: Category;
}

export interface DeleteCategoryDeps {
  readonly categoryRepository: CategoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Soft-deletes one category (SDD 6.1: `deleted_at`, hard delete only via a
 * DPDP erasure job).
 *
 * **Refused while any live child exists, and nothing cascades.** Deleting a
 * branch by deleting its root would remove categories the admin never looked
 * at and — once products exist — orphan every listing beneath them. Emptying a
 * branch has to be deliberate, one level at a time.
 *
 * The emptiness test is the repository's, not the aggregate's: whether another
 * row exists is a question about the database, and a check performed here
 * would still lose to a child inserted a millisecond later.
 *
 * The deleted category releases its slug and its sibling name — both unique
 * indexes are partial on `deleted_at IS NULL` — so the taxonomy can reuse a
 * name it once had rather than reserving it forever.
 */
export class DeleteCategoryUseCase {
  constructor(private readonly deps: DeleteCategoryDeps) {}

  async execute(input: DeleteCategoryInput): Promise<DeleteCategoryResult> {
    const { categoryRepository, transactionRunner, auditWriter, clock, logger } = this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = categoryRepository.withTransaction(scope);

      const existing = await repository.findById(input.categoryId);
      if (!existing) {
        throw new CategoryNotFoundError();
      }

      const deleted = existing.softDelete(clock.now());
      if (!(await repository.softDeleteIfEmpty(deleted))) {
        throw new CategoryNotEmptyError();
      }

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.CATEGORY_DELETED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.CATEGORY,
        entityId: toUuid(deleted.id),
        before: { name: existing.name, slug: existing.slug, parentId: existing.parentId },
      });

      logger.info({ categoryId: deleted.id }, 'Category deleted');

      return { category: deleted };
    });
  }
}
