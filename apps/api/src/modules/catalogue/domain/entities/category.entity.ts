import { InvalidCategoryOperationError } from '../errors/catalogue-errors.js';
import type { CategoryId } from '../value-objects/category-id.value-object.js';
import type { CategoryRiskLevel } from '../value-objects/category-risk-level.value-object.js';
import type { CategorySlug } from '../value-objects/category-slug.value-object.js';

/**
 * Five levels (S2-2 D-C2). Mirrored by `chk_categories_depth`, so a bug here
 * cannot produce a row the database would accept.
 */
export const MAX_CATEGORY_DEPTH = 5;

/**
 * SDD 15.2's mandatory-field completeness screen (HSN, country of origin, net
 * quantity — BR-15/BR-21), made category-conditional.
 *
 * A closed, statutory triple rather than open-shaped data, which is why it
 * lives here and on three explicit columns rather than as `category_attributes`
 * rows.
 *
 * **FSSAI (BR-17) is deliberately not a member.** A food category ought to be
 * able to demand a licence, but there is no vendor licence number or expiry
 * anywhere in this system to satisfy such a demand — a `requiresFssai` flag
 * today would be a requirement nothing could meet. Deferred compliance work,
 * recorded here so its absence reads as a decision rather than an oversight.
 */
export interface CategoryRequirements {
  readonly requiresHsn: boolean;
  readonly requiresCountryOfOrigin: boolean;
  readonly requiresNetQuantity: boolean;
}

export interface CategoryProps {
  readonly id: CategoryId;
  readonly parentId: CategoryId | null;
  /** Ancestor ids, root-first, excluding self. Empty for a root. */
  readonly path: readonly CategoryId[];
  readonly depth: number;
  readonly name: string;
  readonly slug: CategorySlug;
  readonly riskLevel: CategoryRiskLevel;
  readonly requirements: CategoryRequirements;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** What every creation and move must supply about where the node sits. */
interface Placement {
  readonly parentId: CategoryId | null;
  readonly path: readonly CategoryId[];
  readonly depth: number;
}

const placementUnder = (parent: Category | null, id: CategoryId): Placement => {
  if (!parent) {
    return { parentId: null, path: [], depth: 1 };
  }
  if (parent.isDeleted) {
    throw new InvalidCategoryOperationError('parentId', 'The parent category has been deleted.');
  }
  if (parent.id === id || parent.path.includes(id)) {
    throw new InvalidCategoryOperationError(
      'parentId',
      'A category cannot be placed beneath itself.',
    );
  }
  return { parentId: parent.id, path: [...parent.path, parent.id], depth: parent.depth + 1 };
};

const assertWithinDepth = (depth: number, field: string): void => {
  if (depth > MAX_CATEGORY_DEPTH) {
    throw new InvalidCategoryOperationError(
      field,
      `A category may be nested at most ${MAX_CATEGORY_DEPTH} levels deep.`,
    );
  }
};

/**
 * A node of the catalogue taxonomy (SDD 5 module 4, SDD 6.3).
 *
 * Adjacency list plus a materialised `path` of ancestor ids, exactly SDD 6.3's
 * prescription. Holding the full ancestor chain on the row is what makes
 * "everything under Groceries" a single indexed query instead of a recursive
 * CTE on every page load — and it is why moving a category is the one
 * genuinely expensive operation here: the whole subtree's `path` and `depth`
 * must be rewritten together.
 *
 * Risk level and the statutory requirements are **explicit per category and
 * never inherited** (S2-2 D-C6/D-C3). See `CategoryRiskLevel` for why
 * inheritance is a trap.
 *
 * Every mutation returns a new instance; nothing here is edited in place, so a
 * caller that forgets to persist the result cannot leave a half-changed object
 * behind.
 */
export class Category {
  private constructor(private readonly props: CategoryProps) {}

  static create(props: {
    id: CategoryId;
    parent: Category | null;
    name: string;
    slug: CategorySlug;
    riskLevel: CategoryRiskLevel;
    requirements: CategoryRequirements;
    now: Date;
  }): Category {
    const placement = placementUnder(props.parent, props.id);
    assertWithinDepth(placement.depth, 'parentId');

    return new Category({
      id: props.id,
      ...placement,
      name: props.name,
      slug: props.slug,
      riskLevel: props.riskLevel,
      requirements: props.requirements,
      isActive: true,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: CategoryProps): Category {
    return new Category(props);
  }

  get id(): CategoryId {
    return this.props.id;
  }

  get parentId(): CategoryId | null {
    return this.props.parentId;
  }

  get path(): readonly CategoryId[] {
    return this.props.path;
  }

  get depth(): number {
    return this.props.depth;
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): CategorySlug {
    return this.props.slug;
  }

  get riskLevel(): CategoryRiskLevel {
    return this.props.riskLevel;
  }

  get requirements(): CategoryRequirements {
    return this.props.requirements;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get isRoot(): boolean {
    return this.props.parentId === null;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /** True when `candidate` is this category or sits anywhere beneath it. */
  containsInSubtree(candidate: Category): boolean {
    return candidate.id === this.props.id || candidate.path.includes(this.props.id);
  }

  rename(name: string, now: Date): Category {
    this.assertLive('name');
    return new Category({ ...this.props, name, updatedAt: now });
  }

  changeRiskLevel(riskLevel: CategoryRiskLevel, now: Date): Category {
    this.assertLive('riskLevel');
    return new Category({ ...this.props, riskLevel, updatedAt: now });
  }

  changeRequirements(requirements: CategoryRequirements, now: Date): Category {
    this.assertLive('requirements');
    return new Category({ ...this.props, requirements, updatedAt: now });
  }

  setActive(isActive: boolean, now: Date): Category {
    this.assertLive('isActive');
    return new Category({ ...this.props, isActive, updatedAt: now });
  }

  /**
   * Soft delete. Emptiness is *not* checked here: whether a live child exists
   * is a question about other rows, which an aggregate holding only its own
   * state cannot answer honestly. `CategoryRepository.softDeleteIfEmpty`
   * settles it in the database, where a concurrently inserted child still
   * counts.
   */
  softDelete(now: Date): Category {
    this.assertLive('deletedAt');
    return new Category({ ...this.props, deletedAt: now, updatedAt: now });
  }

  /**
   * Moves this category — and, through `descendants`, everything beneath it —
   * under `newParent` (or to the root when `null`).
   *
   * Returns the whole rewritten set, this node first. Every descendant's
   * `path` and `depth` shift by the same amount, so they are recomputed by
   * replacing the moved node's old ancestor prefix rather than by walking the
   * tree again.
   *
   * Three refusals, all of which the database also enforces: a category may
   * not become its own descendant, may not move beneath a deleted parent, and
   * may not push its **deepest** descendant past the ceiling — checking only
   * the moved node would let a three-level branch slide off the bottom.
   */
  reparentTo(newParent: Category | null, descendants: readonly Category[], now: Date): Category[] {
    this.assertLive('parentId');
    if (newParent && this.containsInSubtree(newParent)) {
      throw new InvalidCategoryOperationError(
        'parentId',
        'A category cannot be moved beneath one of its own descendants.',
      );
    }

    const placement = placementUnder(newParent, this.props.id);
    const shift = placement.depth - this.props.depth;
    const deepest = descendants.reduce((max, node) => Math.max(max, node.depth), this.props.depth);
    assertWithinDepth(deepest + shift, 'parentId');

    const moved = new Category({ ...this.props, ...placement, updatedAt: now });
    const prefixLength = this.props.path.length;

    return [
      moved,
      ...descendants.map(
        (node) =>
          new Category({
            ...node.props,
            path: [...placement.path, this.props.id, ...node.props.path.slice(prefixLength + 1)],
            depth: node.props.depth + shift,
            updatedAt: now,
          }),
      ),
    ];
  }

  private assertLive(field: string): void {
    if (this.isDeleted) {
      throw new InvalidCategoryOperationError(field, 'This category has been deleted.');
    }
  }
}
