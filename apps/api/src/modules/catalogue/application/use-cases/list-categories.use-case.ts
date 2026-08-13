import type {
  CategoryPage,
  CategoryRepository,
} from '../../domain/repositories/category.repository.js';

export interface ListCategoriesInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ListCategoriesDeps {
  readonly categoryRepository: CategoryRepository;
}

/**
 * One page of the taxonomy for the admin console, on the platform's existing
 * cursor convention (SDD 9.2) rather than a shape invented here.
 *
 * Flat and paginated rather than nested: an admin list is for finding and
 * editing one row, and the whole tree is the public surface's job (S2-2c).
 *
 * A read — no transaction, no audit record.
 */
export class ListCategoriesUseCase {
  constructor(private readonly deps: ListCategoriesDeps) {}

  execute(input: ListCategoriesInput): Promise<CategoryPage> {
    return this.deps.categoryRepository.listPage({ limit: input.limit, cursor: input.cursor });
  }
}
