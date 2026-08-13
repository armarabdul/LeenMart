import type { TransactionScope } from '@leen-mart/domain-kit';
import type { Category } from '../entities/category.entity.js';
import type { CategoryId } from '../value-objects/category-id.value-object.js';
import type { CategorySlug } from '../value-objects/category-slug.value-object.js';

export interface CategoryPage {
  readonly items: readonly Category[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface CategoryRepository {
  /**
   * Re-binds this repository to a transaction the caller already opened, so a
   * category write and its audit record commit or roll back together. Same
   * shape `VendorKycRepository.withTransaction` publishes, for the same
   * reason — the port cannot name Prisma, and only `TransactionRunner.run`
   * can produce a `TransactionScope`.
   */
  withTransaction(scope: TransactionScope): CategoryRepository;

  create(category: Category): Promise<void>;

  /** Applies name, slug-independent settings and placement. Returns `false` if the row is gone. */
  update(category: Category): Promise<boolean>;

  /** Rewrites a moved subtree in one statement batch — `reparentTo`'s output, persisted. */
  updateMany(categories: readonly Category[]): Promise<void>;

  findById(id: CategoryId): Promise<Category | null>;

  findBySlug(slug: CategorySlug): Promise<Category | null>;

  /**
   * The moved node's descendants, found through the materialised path — the
   * query `idx_categories_path` exists for. Excludes the node itself.
   */
  findDescendants(id: CategoryId): Promise<readonly Category[]>;

  /** One page of the admin list, newest first, on the platform's cursor convention (SDD 9.2). */
  listPage(input: { limit: number; cursor?: string | undefined }): Promise<CategoryPage>;

  /**
   * Soft-deletes only if the category still has no live child.
   *
   * Conditional rather than read-then-write, the same shape
   * `claimForReviewIfUnclaimed` and `consumeIfActive` use: a child inserted
   * between a check and a write would otherwise be orphaned by a delete that
   * had already passed its own test. `false` means a child exists.
   */
  softDeleteIfEmpty(category: Category): Promise<boolean>;

  /**
   * Every live, publicly visible node (S2-2c) — the public tree's raw
   * material. Ordered `lower(name)` ascending, `id` as tiebreak: `Category`
   * has no position column (unlike `CategoryAttribute`), and sibling names
   * are already unique per level (`idx_categories_child_name_unique`/
   * `idx_categories_root_name_unique`), so `name` is the natural, collision-free
   * sort key and `id` only ever breaks a tie between categories under
   * different parents.
   */
  findAllActive(): Promise<readonly Category[]>;

  /**
   * `id`'s live, immediate children — one level, not the whole subtree
   * `findDescendants` returns. Filters `deletedAt` only, the same as
   * `findBySlug`: whether an `isActive` child should be shown is a caller
   * decision (S2-2c's public detail excludes inactive children; a future
   * admin caller might not want to). Same `lower(name)`/`id` order as
   * `findAllActive`.
   */
  findChildren(id: CategoryId): Promise<readonly Category[]>;
}
