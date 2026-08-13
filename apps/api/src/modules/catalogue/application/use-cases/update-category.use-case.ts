import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { Category, CategoryRequirements } from '../../domain/entities/category.entity.js';
import { CategoryNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../domain/value-objects/category-risk-level.value-object.js';

export interface UpdateCategoryChanges {
  readonly name?: string | undefined;
  readonly riskLevel?: string | undefined;
  readonly requirements?: CategoryRequirements | undefined;
  readonly isActive?: boolean | undefined;
}

export interface UpdateCategoryInput {
  readonly principal: Principal;
  readonly categoryId: CategoryId;
  readonly changes: UpdateCategoryChanges;
}

export interface UpdateCategoryResult {
  readonly category: Category;
}

export interface UpdateCategoryDeps {
  readonly categoryRepository: CategoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Applies each supplied change through the aggregate's own method; absent fields are untouched. */
const applyChanges = (existing: Category, changes: UpdateCategoryChanges, now: Date): Category => {
  let category = existing;
  if (changes.name !== undefined) {
    category = category.rename(changes.name, now);
  }
  if (changes.riskLevel !== undefined) {
    category = category.changeRiskLevel(CategoryRiskLevel.fromName(changes.riskLevel), now);
  }
  if (changes.requirements !== undefined) {
    category = category.changeRequirements(changes.requirements, now);
  }
  if (changes.isActive !== undefined) {
    category = category.setActive(changes.isActive, now);
  }
  return category;
};

/** Which audit actions one edit earns. A rename and a settings change in one request earn both. */
const actionsFor = (changes: UpdateCategoryChanges): string[] => {
  const actions: string[] = [];
  if (changes.name !== undefined) {
    actions.push(CATALOGUE_AUDIT_ACTIONS.CATEGORY_RENAMED);
  }
  if (
    changes.riskLevel !== undefined ||
    changes.requirements !== undefined ||
    changes.isActive !== undefined
  ) {
    actions.push(CATALOGUE_AUDIT_ACTIONS.CATEGORY_SETTINGS_UPDATED);
  }
  return actions;
};

/**
 * A partial edit of one category (SDD 9.2's `PATCH` semantics).
 *
 * **Not a general field setter.** Each supplied field goes through the
 * aggregate method that owns it, so a deleted category refuses every one of
 * them in the same way. `slug` and `parentId` are absent from the input
 * entirely: a slug is immutable, and a move rewrites a whole subtree and has
 * its own use case.
 *
 * Audit is per *kind* of change, not one blanket "updated": a risk-level
 * change and a rename are different acts with different reviewers, and an
 * eight-year log that cannot tell them apart is worth less than one that can.
 */
export class UpdateCategoryUseCase {
  constructor(private readonly deps: UpdateCategoryDeps) {}

  async execute(input: UpdateCategoryInput): Promise<UpdateCategoryResult> {
    const { categoryRepository, transactionRunner, auditWriter, clock, logger } = this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = categoryRepository.withTransaction(scope);

      const existing = await repository.findById(input.categoryId);
      if (!existing) {
        throw new CategoryNotFoundError();
      }

      const category = applyChanges(existing, input.changes, clock.now());
      if (!(await repository.update(category))) {
        // The row disappeared between the read and the write. Same answer a
        // caller gets for an id that was never there.
        throw new CategoryNotFoundError();
      }

      const writer = auditWriter.withTransaction(scope);
      for (const action of actionsFor(input.changes)) {
        await writer.record({
          actorId: input.principal.userId,
          actorRole: input.principal.role,
          action,
          entityType: CATALOGUE_AUDIT_ENTITY_TYPES.CATEGORY,
          entityId: toUuid(category.id),
          before: {
            name: existing.name,
            riskLevel: existing.riskLevel.name,
            isActive: existing.isActive,
          },
          after: {
            name: category.name,
            riskLevel: category.riskLevel.name,
            isActive: category.isActive,
          },
        });
      }

      logger.info({ categoryId: category.id }, 'Category updated');

      return { category };
    });
  }
}
