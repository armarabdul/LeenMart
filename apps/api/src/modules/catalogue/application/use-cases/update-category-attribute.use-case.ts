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

export interface UpdateCategoryAttributeChanges {
  readonly label?: string | undefined;
  readonly isRequired?: boolean | undefined;
  readonly position?: number | undefined;
  readonly unit?: string | null | undefined;
  readonly options?: readonly string[] | undefined;
}

export interface UpdateCategoryAttributeInput {
  readonly principal: Principal;
  readonly categoryId: CategoryId;
  readonly attributeId: CategoryAttributeId;
  readonly changes: UpdateCategoryAttributeChanges;
}

export interface UpdateCategoryAttributeResult {
  readonly attribute: CategoryAttribute;
}

export interface UpdateCategoryAttributeDeps {
  readonly categoryAttributeRepository: CategoryAttributeRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Each supplied field goes through the aggregate method that owns it; absent fields are untouched. */
const applyChanges = (
  existing: CategoryAttribute,
  changes: UpdateCategoryAttributeChanges,
  now: Date,
): CategoryAttribute => {
  let attribute = existing;
  if (changes.label !== undefined) {
    attribute = attribute.relabel(changes.label, now);
  }
  if (changes.isRequired !== undefined) {
    attribute = attribute.setRequired(changes.isRequired, now);
  }
  if (changes.position !== undefined) {
    attribute = attribute.moveTo(changes.position, now);
  }
  if (changes.unit !== undefined) {
    attribute = attribute.changeUnit(changes.unit, now);
  }
  if (changes.options !== undefined) {
    attribute = attribute.changeOptions(changes.options, now);
  }
  return attribute;
};

const hasChanges = (changes: UpdateCategoryAttributeChanges): boolean =>
  Object.values(changes).some((value) => value !== undefined);

/**
 * A partial edit of one attribute definition (SDD 9.2's `PATCH` semantics).
 *
 * **`key` and `dataType` are absent from the input entirely**, because neither
 * can change: a key is the stable identifier the product values that arrive in
 * a later chunk will reference, and a type that could change under stored
 * values is a data-corruption path with no migration story.
 *
 * That immutability is also why `unit` and `options` cannot be validated by the
 * request schema — legality depends on the *stored* type, which the wire does
 * not carry. The aggregate checks them against it and answers 422, the same
 * division of labour KYC used for "`OTHER` requires a note".
 */
export class UpdateCategoryAttributeUseCase {
  constructor(private readonly deps: UpdateCategoryAttributeDeps) {}

  async execute(input: UpdateCategoryAttributeInput): Promise<UpdateCategoryAttributeResult> {
    const { categoryAttributeRepository, transactionRunner, auditWriter, clock, logger } =
      this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = categoryAttributeRepository.withTransaction(scope);

      const existing = await repository.findById(input.categoryId, input.attributeId);
      if (!existing) {
        throw new CategoryAttributeNotFoundError();
      }

      const attribute = applyChanges(existing, input.changes, clock.now());
      if (!(await repository.update(attribute))) {
        // Vanished between the read and the write — the same answer a caller
        // gets for an id that was never there.
        throw new CategoryAttributeNotFoundError();
      }

      if (hasChanges(input.changes)) {
        await auditWriter.withTransaction(scope).record({
          actorId: input.principal.userId,
          actorRole: input.principal.role,
          action: CATALOGUE_AUDIT_ACTIONS.CATEGORY_ATTRIBUTE_UPDATED,
          entityType: CATALOGUE_AUDIT_ENTITY_TYPES.CATEGORY,
          entityId: toUuid(input.categoryId),
          before: {
            attributeId: existing.id,
            key: existing.key,
            label: existing.label,
            isRequired: existing.isRequired,
            position: existing.position,
          },
          after: {
            attributeId: attribute.id,
            key: attribute.key,
            label: attribute.label,
            isRequired: attribute.isRequired,
            position: attribute.position,
          },
        });
      }

      logger.info(
        { categoryId: input.categoryId, attributeId: attribute.id },
        'Category attribute updated',
      );

      return { attribute };
    });
  }
}
