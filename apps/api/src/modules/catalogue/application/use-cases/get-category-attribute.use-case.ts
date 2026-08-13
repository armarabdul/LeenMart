import type { CategoryAttribute } from '../../domain/entities/category-attribute.entity.js';
import { CategoryAttributeNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryAttributeRepository } from '../../domain/repositories/category-attribute.repository.js';
import type { CategoryAttributeId } from '../../domain/value-objects/category-attribute-id.value-object.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';

export interface GetCategoryAttributeInput {
  readonly categoryId: CategoryId;
  readonly attributeId: CategoryAttributeId;
}

export interface GetCategoryAttributeDeps {
  readonly categoryAttributeRepository: CategoryAttributeRepository;
}

/**
 * One attribute definition, scoped by both ids.
 *
 * An attribute belonging to a different category reads as absent rather than
 * as a hint that a valid id was supplied against the wrong parent — the
 * repository enforces that, not this use case.
 *
 * A read: no transaction, no audit record.
 */
export class GetCategoryAttributeUseCase {
  constructor(private readonly deps: GetCategoryAttributeDeps) {}

  async execute(input: GetCategoryAttributeInput): Promise<CategoryAttribute> {
    const attribute = await this.deps.categoryAttributeRepository.findById(
      input.categoryId,
      input.attributeId,
    );
    if (!attribute) {
      throw new CategoryAttributeNotFoundError();
    }
    return attribute;
  }
}
