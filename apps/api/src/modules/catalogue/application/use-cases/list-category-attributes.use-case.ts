import type { CategoryAttribute } from '../../domain/entities/category-attribute.entity.js';
import { CategoryNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryAttributeRepository } from '../../domain/repositories/category-attribute.repository.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';

export interface ListCategoryAttributesInput {
  readonly categoryId: CategoryId;
}

export interface ListCategoryAttributesDeps {
  readonly categoryRepository: CategoryRepository;
  readonly categoryAttributeRepository: CategoryAttributeRepository;
}

/**
 * Every attribute a category defines, ordered `position ASC, key ASC`.
 *
 * **Not paginated**, unlike the category list: a category's attribute set is
 * small and only useful whole — half a form's fields is not a form. The
 * secondary sort on `key` is what makes the order deterministic, since
 * positions are allowed to tie.
 *
 * The category is checked first so an unknown id answers 404 rather than an
 * empty array, which would be indistinguishable from a category that simply
 * has no attributes yet.
 *
 * A read: no transaction, no audit record.
 */
export class ListCategoryAttributesUseCase {
  constructor(private readonly deps: ListCategoryAttributesDeps) {}

  async execute(input: ListCategoryAttributesInput): Promise<readonly CategoryAttribute[]> {
    const category = await this.deps.categoryRepository.findById(input.categoryId);
    if (!category) {
      throw new CategoryNotFoundError();
    }
    return this.deps.categoryAttributeRepository.listByCategoryId(input.categoryId);
  }
}
