import {
  toUuid,
  type Clock,
  type IdGenerator,
  type Logger,
  type TransactionRunner,
} from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import { Category, type CategoryRequirements } from '../../domain/entities/category.entity.js';
import { CategoryNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import {
  toCategoryId,
  type CategoryId,
} from '../../domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../domain/value-objects/category-risk-level.value-object.js';
import type { CategorySlug } from '../../domain/value-objects/category-slug.value-object.js';

export interface CreateCategoryInput {
  readonly principal: Principal;
  readonly parentId: CategoryId | null;
  readonly name: string;
  readonly slug: CategorySlug;
  readonly riskLevel: string;
  readonly requirements: CategoryRequirements;
}

export interface CreateCategoryResult {
  readonly category: Category;
}

export interface CreateCategoryDeps {
  readonly categoryRepository: CategoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Adds one node to the taxonomy (SDD 5 module 4).
 *
 * The parent is loaded rather than trusted: its `path` and `depth` are what
 * position the new row, and a `parentId` that names a deleted or nonexistent
 * category must fail here rather than produce an orphan the foreign key would
 * catch later with a far less useful message.
 *
 * Slug and sibling-name uniqueness are settled by the database's partial
 * unique indexes, not by a pre-flight read — a check-then-insert would still
 * lose to a concurrent create, and the repository translates the violation
 * into the error that names which of the two fields to change.
 */
export class CreateCategoryUseCase {
  constructor(private readonly deps: CreateCategoryDeps) {}

  async execute(input: CreateCategoryInput): Promise<CreateCategoryResult> {
    const { categoryRepository, transactionRunner, auditWriter, idGenerator, clock, logger } =
      this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = categoryRepository.withTransaction(scope);

      const parent = input.parentId ? await repository.findById(input.parentId) : null;
      if (input.parentId && !parent) {
        throw new CategoryNotFoundError();
      }

      // The aggregate owns placement and the depth ceiling; this use case
      // never computes a `path` itself.
      const category = Category.create({
        id: toCategoryId(idGenerator.generate()),
        parent,
        name: input.name,
        slug: input.slug,
        riskLevel: CategoryRiskLevel.fromName(input.riskLevel),
        requirements: input.requirements,
        now: clock.now(),
      });

      await repository.create(category);

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.CATEGORY_CREATED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.CATEGORY,
        entityId: toUuid(category.id),
        after: {
          parentId: category.parentId,
          name: category.name,
          slug: category.slug,
          riskLevel: category.riskLevel.name,
        },
      });

      logger.info({ categoryId: category.id, slug: category.slug }, 'Category created');

      return { category };
    });
  }
}
