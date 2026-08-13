import type { TransactionScope } from '@leen-mart/domain-kit';
import type { CategoryAttribute } from '../entities/category-attribute.entity.js';
import type { CategoryAttributeId } from '../value-objects/category-attribute-id.value-object.js';
import type { CategoryId } from '../value-objects/category-id.value-object.js';

export interface CategoryAttributeRepository {
  /**
   * Re-binds to a transaction the caller already opened, so an attribute write
   * and its audit record commit or roll back together. Same shape
   * `CategoryRepository.withTransaction` publishes, for the same reason.
   */
  withTransaction(scope: TransactionScope): CategoryAttributeRepository;

  create(attribute: CategoryAttribute): Promise<void>;

  /** `false` when the row is gone — a caller turns that into the same 404 a missing id gets. */
  update(attribute: CategoryAttribute): Promise<boolean>;

  /**
   * Scoped by **both** ids on purpose. An attribute id belonging to a
   * different category must read as absent rather than as a hint that a valid
   * id was supplied against the wrong parent.
   */
  findById(categoryId: CategoryId, id: CategoryAttributeId): Promise<CategoryAttribute | null>;

  /**
   * Every live attribute of one category, ordered `position ASC, key ASC`.
   *
   * Not paginated: a category's attribute set is small and only useful whole.
   * The secondary sort on `key` is what makes the order deterministic when
   * positions tie, which they are allowed to.
   */
  listByCategoryId(categoryId: CategoryId): Promise<readonly CategoryAttribute[]>;

  softDelete(attribute: CategoryAttribute): Promise<boolean>;

  /**
   * Soft-deletes every live attribute of one category and returns how many.
   *
   * Exists for category deletion, which takes a category's own definitions
   * with it in the same transaction. Deliberately not a cascade in the
   * database: the deletion timestamp has to be the one the use case stamped,
   * so the category and its attributes agree on when they went.
   */
  softDeleteAllForCategory(categoryId: CategoryId, now: Date): Promise<number>;
}
