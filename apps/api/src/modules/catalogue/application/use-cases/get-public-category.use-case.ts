import type { Category } from '../../domain/entities/category.entity.js';
import { CategoryNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { CategorySlug } from '../../domain/value-objects/category-slug.value-object.js';

export interface GetPublicCategoryInput {
  readonly slug: CategorySlug;
}

export interface GetPublicCategoryResult {
  readonly category: Category;
  /** Immediate live, active children only (S2-2c decision 2) — never the whole subtree. */
  readonly children: readonly Category[];
}

export interface GetPublicCategoryDeps {
  readonly categoryRepository: CategoryRepository;
}

/**
 * One category by its public slug, plus its immediate active children —
 * enough for a category landing page to render its own subcategory
 * navigation without a second round trip, and no more.
 *
 * An unknown slug, an inactive category and a soft-deleted category all throw
 * the same `CategoryNotFoundError` the admin surface uses for "never
 * existed" — deliberately: a public caller must not be able to tell the three
 * apart (S2-2c requirement 2). `findBySlug` already excludes soft-deleted
 * rows; `isActive` is checked here because that filter is a public-surface
 * concern, not something every caller of `findBySlug` wants (an admin
 * conflict check must still see an inactive category).
 *
 * A category's own `isActive` is what gates it here — an ancestor being
 * inactive does not implicitly hide this one. Same "explicit per category,
 * never inherited" rule `GetPublicCategoryTreeUseCase` documents for why an
 * inactive parent's active child is absent from the *tree* is not contradicted
 * by that child staying independently reachable by its own slug; nothing in
 * this codebase cascades category state between parent and child.
 */
export class GetPublicCategoryUseCase {
  constructor(private readonly deps: GetPublicCategoryDeps) {}

  async execute(input: GetPublicCategoryInput): Promise<GetPublicCategoryResult> {
    const category = await this.deps.categoryRepository.findBySlug(input.slug);
    if (!category?.isActive) {
      throw new CategoryNotFoundError();
    }

    const children = await this.deps.categoryRepository.findChildren(category.id);
    return { category, children: children.filter((child) => child.isActive) };
  }
}
