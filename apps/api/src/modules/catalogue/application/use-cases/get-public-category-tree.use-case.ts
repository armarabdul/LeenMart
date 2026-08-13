import type { Category } from '../../domain/entities/category.entity.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';

/** A `Category` plus its already-nested children — the use case's output shape. */
export interface PublicCategoryTreeNode {
  readonly category: Category;
  readonly children: readonly PublicCategoryTreeNode[];
}

export interface GetPublicCategoryTreeDeps {
  readonly categoryRepository: CategoryRepository;
}

/**
 * Groups `findAllActive`'s flat, already-`lower(name)`/`id`-ordered result by
 * `parentId` and attaches recursively from the roots.
 *
 * An active category whose parent is inactive is fetched (it individually
 * satisfies `isActive`) but never reached: `attach` only recurses into ids it
 * has already emitted, and an inactive parent is never emitted. This is
 * deliberate, not an oversight — it is what makes deactivating a category also
 * remove its subtree from the tree, with no separate cascade logic, and it
 * mirrors this codebase's standing rule that category state is "explicit per
 * category and never inherited" (`Category`'s own class doc, on risk level and
 * statutory requirements) extended to `isActive` the same way.
 */
const buildForest = (categories: readonly Category[]): readonly PublicCategoryTreeNode[] => {
  const byParent = new Map<CategoryId | null, Category[]>();
  for (const category of categories) {
    const siblings = byParent.get(category.parentId);
    if (siblings) {
      siblings.push(category);
    } else {
      byParent.set(category.parentId, [category]);
    }
  }

  const attach = (parentId: CategoryId | null): PublicCategoryTreeNode[] =>
    (byParent.get(parentId) ?? []).map((category) => ({
      category,
      children: attach(category.id),
    }));

  return attach(null);
};

/**
 * The whole public taxonomy, nested (S2-2c). Unpaginated by design —
 * `ListCategoriesUseCase`'s own comment already names this as "the public
 * surface's job," and the taxonomy is a small, closed, admin-curated set (at
 * most `MAX_CATEGORY_DEPTH` levels), not a growing list.
 *
 * A read — no transaction, no audit record, the same line every other
 * catalogue read draws.
 */
export class GetPublicCategoryTreeUseCase {
  constructor(private readonly deps: GetPublicCategoryTreeDeps) {}

  async execute(): Promise<readonly PublicCategoryTreeNode[]> {
    const categories = await this.deps.categoryRepository.findAllActive();
    return buildForest(categories);
  }
}
