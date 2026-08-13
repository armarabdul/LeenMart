import type { Category } from '../../domain/entities/category.entity.js';
import { CategoryNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';

export interface GetCategoryInput {
  readonly categoryId: CategoryId;
}

export interface GetCategoryDeps {
  readonly categoryRepository: CategoryRepository;
}

/**
 * One category, for the admin console.
 *
 * No transaction and no audit record: this is a read, and SDD 18.4's log is
 * for admin *actions*. The same line KYC-6 drew for the review queue.
 */
export class GetCategoryUseCase {
  constructor(private readonly deps: GetCategoryDeps) {}

  async execute(input: GetCategoryInput): Promise<Category> {
    const category = await this.deps.categoryRepository.findById(input.categoryId);
    if (!category) {
      throw new CategoryNotFoundError();
    }
    return category;
  }
}
