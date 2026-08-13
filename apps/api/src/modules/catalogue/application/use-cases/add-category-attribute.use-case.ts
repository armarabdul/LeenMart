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
import { CategoryAttribute } from '../../domain/entities/category-attribute.entity.js';
import { CategoryNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryAttributeRepository } from '../../domain/repositories/category-attribute.repository.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import { toCategoryAttributeId } from '../../domain/value-objects/category-attribute-id.value-object.js';
import { CategoryAttributeType } from '../../domain/value-objects/category-attribute-type.value-object.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';

export interface AddCategoryAttributeInput {
  readonly principal: Principal;
  readonly categoryId: CategoryId;
  readonly key: string;
  readonly label: string;
  readonly dataType: string;
  readonly isRequired: boolean;
  readonly unit: string | null;
  readonly options: readonly string[];
  readonly position: number;
}

export interface AddCategoryAttributeResult {
  readonly attribute: CategoryAttribute;
}

export interface AddCategoryAttributeDeps {
  readonly categoryRepository: CategoryRepository;
  readonly categoryAttributeRepository: CategoryAttributeRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Defines one attribute on a category (SDD 5 module 4, FR-14).
 *
 * The category is loaded rather than trusted: an attribute hanging off an id
 * that names nothing, or a soft-deleted row, must fail here rather than reach
 * the foreign key with a far less useful message. A category that is merely
 * **inactive** is accepted — deactivating a category so it can be configured
 * before going live is the ordinary workflow, and refusing would make an admin
 * re-activate one just to fix a typo.
 *
 * Key uniqueness is settled by `idx_category_attributes_key_unique`, not by a
 * pre-flight read: a check-then-insert still loses to a concurrent create, and
 * the repository translates the violation into the error naming the field.
 */
export class AddCategoryAttributeUseCase {
  constructor(private readonly deps: AddCategoryAttributeDeps) {}

  async execute(input: AddCategoryAttributeInput): Promise<AddCategoryAttributeResult> {
    const {
      categoryRepository,
      categoryAttributeRepository,
      transactionRunner,
      auditWriter,
      idGenerator,
      clock,
      logger,
    } = this.deps;

    return transactionRunner.run(async (scope) => {
      const category = await categoryRepository.withTransaction(scope).findById(input.categoryId);
      if (!category) {
        throw new CategoryNotFoundError();
      }

      // The aggregate owns every shape rule — key format, position, and the
      // type-conditional unit and options.
      const attribute = CategoryAttribute.create({
        id: toCategoryAttributeId(idGenerator.generate()),
        categoryId: category.id,
        key: input.key,
        label: input.label,
        dataType: CategoryAttributeType.fromName(input.dataType),
        isRequired: input.isRequired,
        unit: input.unit,
        options: input.options,
        position: input.position,
        now: clock.now(),
      });

      await categoryAttributeRepository.withTransaction(scope).create(attribute);

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.CATEGORY_ATTRIBUTE_ADDED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.CATEGORY,
        entityId: toUuid(category.id),
        after: {
          attributeId: attribute.id,
          key: attribute.key,
          dataType: attribute.dataType.name,
          isRequired: attribute.isRequired,
          position: attribute.position,
        },
      });

      logger.info(
        { categoryId: category.id, attributeId: attribute.id, key: attribute.key },
        'Category attribute added',
      );

      return { attribute };
    });
  }
}
