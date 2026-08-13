import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { Category } from '../../domain/entities/category.entity.js';
import { CategoryNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';

export interface ReparentCategoryInput {
  readonly principal: Principal;
  readonly categoryId: CategoryId;
  readonly newParentId: CategoryId | null;
}

export interface ReparentCategoryResult {
  readonly category: Category;
  /** How many rows the move rewrote, the moved node included. */
  readonly rewritten: number;
}

export interface ReparentCategoryDeps {
  readonly categoryRepository: CategoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Moves a category, and with it everything beneath it, to a new parent (or to
 * the root).
 *
 * This is the one genuinely expensive taxonomy operation, and the reason it is
 * a sub-resource action (`POST /:id/parent`) rather than a field in `PATCH`
 * (SDD 9.2's "non-CRUD actions" rule): a materialised `path` means the whole
 * subtree's ancestry and depth are rewritten, not one column on one row.
 *
 * The descendants are loaded **before** the move so the aggregate can refuse a
 * move that would push the deepest of them past the five-level ceiling —
 * checking only the node being moved would let a three-level branch slide off
 * the bottom of the tree.
 *
 * Everything commits together. A subtree half-rewritten is a tree with rows
 * whose `path` and `depth` disagree, which `chk_categories_path_depth` would
 * reject — but only after the first half had already landed.
 */
export class ReparentCategoryUseCase {
  constructor(private readonly deps: ReparentCategoryDeps) {}

  async execute(input: ReparentCategoryInput): Promise<ReparentCategoryResult> {
    const { categoryRepository, transactionRunner, auditWriter, clock, logger } = this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = categoryRepository.withTransaction(scope);

      const existing = await repository.findById(input.categoryId);
      if (!existing) {
        throw new CategoryNotFoundError();
      }

      const newParent = input.newParentId ? await repository.findById(input.newParentId) : null;
      if (input.newParentId && !newParent) {
        throw new CategoryNotFoundError();
      }

      const descendants = await repository.findDescendants(existing.id);

      // The aggregate owns every refusal here: moving beneath itself, beneath
      // a deleted parent, or past the depth ceiling.
      const rewritten = existing.reparentTo(newParent, descendants, clock.now());
      await repository.updateMany(rewritten);

      const [moved] = rewritten;
      /* c8 ignore next */
      if (!moved) throw new CategoryNotFoundError(); // unreachable: reparentTo always returns the moved node first

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.CATEGORY_REPARENTED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.CATEGORY,
        entityId: toUuid(moved.id),
        before: { parentId: existing.parentId, depth: existing.depth },
        after: { parentId: moved.parentId, depth: moved.depth, subtreeSize: rewritten.length },
      });

      logger.info(
        { categoryId: moved.id, rewritten: rewritten.length },
        'Category subtree reparented',
      );

      return { category: moved, rewritten: rewritten.length };
    });
  }
}
