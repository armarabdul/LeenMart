import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { CategoryAttribute } from '../../domain/entities/category-attribute.entity.js';
import { CategoryAttributeNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryAttributeRepository } from '../../domain/repositories/category-attribute.repository.js';
import type { CategoryAttributeId } from '../../domain/value-objects/category-attribute-id.value-object.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';

export interface RemoveCategoryAttributeInput {
  readonly principal: Principal;
  readonly categoryId: CategoryId;
  readonly attributeId: CategoryAttributeId;
}

export interface RemoveCategoryAttributeResult {
  readonly attribute: CategoryAttribute;
}

export interface RemoveCategoryAttributeDeps {
  readonly categoryAttributeRepository: CategoryAttributeRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Soft-deletes one attribute definition (SDD 6.1: `deleted_at`).
 *
 * Nothing blocks it — an attribute has no dependants of its own, which is what
 * makes this simpler than deleting a category. The deleted definition releases
 * its key: `idx_category_attributes_key_unique` is partial on
 * `deleted_at IS NULL`, so the same key can be defined again later rather than
 * being reserved forever.
 */
export class RemoveCategoryAttributeUseCase {
  constructor(private readonly deps: RemoveCategoryAttributeDeps) {}

  async execute(input: RemoveCategoryAttributeInput): Promise<RemoveCategoryAttributeResult> {
    const { categoryAttributeRepository, transactionRunner, auditWriter, clock, logger } =
      this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = categoryAttributeRepository.withTransaction(scope);

      const existing = await repository.findById(input.categoryId, input.attributeId);
      if (!existing) {
        throw new CategoryAttributeNotFoundError();
      }

      const deleted = existing.softDelete(clock.now());
      if (!(await repository.softDelete(deleted))) {
        throw new CategoryAttributeNotFoundError();
      }

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.CATEGORY_ATTRIBUTE_REMOVED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.CATEGORY,
        entityId: toUuid(input.categoryId),
        before: {
          attributeId: existing.id,
          key: existing.key,
          dataType: existing.dataType.name,
        },
      });

      logger.info(
        { categoryId: input.categoryId, attributeId: deleted.id },
        'Category attribute removed',
      );

      return { attribute: deleted };
    });
  }
}
