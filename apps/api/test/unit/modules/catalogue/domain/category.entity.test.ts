import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import {
  Category,
  MAX_CATEGORY_DEPTH,
  type CategoryRequirements,
} from '../../../../../src/modules/catalogue/domain/entities/category.entity.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../../../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../../../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');

const NO_REQUIREMENTS: CategoryRequirements = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

let slugCounter = 0;
const nextSlug = (): ReturnType<typeof toCategorySlug> =>
  toCategorySlug(`category-${(slugCounter += 1)}`);

const makeCategory = (
  parent: Category | null = null,
  riskLevel = CategoryRiskLevel.LOW,
): Category =>
  Category.create({
    id: toCategoryId(ids.generate()),
    parent,
    name: `Category ${slugCounter}`,
    slug: nextSlug(),
    riskLevel,
    requirements: NO_REQUIREMENTS,
    now: NOW,
  });

/** A straight chain root → … → depth `n`, returned root-first. */
const chain = (length: number): Category[] => {
  const nodes: Category[] = [makeCategory(null)];
  for (let i = 1; i < length; i += 1) {
    nodes.push(makeCategory(nodes[i - 1] ?? null));
  }
  return nodes;
};

/**
 * Domain-rule messages are deliberately uniform (SEC-15); what names the
 * broken rule is `details`. Same helper shape the KYC domain tests use.
 */
const issueOf = (act: () => unknown): string => {
  try {
    act();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};

describe('Category', () => {
  describe('placement', () => {
    it('creates a root with no parent, no ancestors and depth 1', () => {
      const root = makeCategory(null);

      expect(root.parentId).toBeNull();
      expect(root.path).toEqual([]);
      expect(root.depth).toBe(1);
      expect(root.isRoot).toBe(true);
    });

    it('places a child one level below its parent', () => {
      const root = makeCategory(null);
      const child = makeCategory(root);

      expect(child.parentId).toBe(root.id);
      expect(child.depth).toBe(2);
      expect(child.isRoot).toBe(false);
    });

    it('carries the full ancestor chain, root-first and excluding itself', () => {
      const [root, mid, leaf] = chain(3) as [Category, Category, Category];

      expect(leaf.path).toEqual([root.id, mid.id]);
      expect(leaf.path).not.toContain(leaf.id);
    });

    it('keeps depth and path length in step at every level', () => {
      for (const node of chain(MAX_CATEGORY_DEPTH)) {
        expect(node.path.length).toBe(node.depth - 1);
      }
    });

    it(`allows nesting exactly ${String(MAX_CATEGORY_DEPTH)} levels deep`, () => {
      const nodes = chain(MAX_CATEGORY_DEPTH);

      expect(nodes[MAX_CATEGORY_DEPTH - 1]?.depth).toBe(MAX_CATEGORY_DEPTH);
    });

    it('refuses a sixth level', () => {
      const deepest = chain(MAX_CATEGORY_DEPTH)[MAX_CATEGORY_DEPTH - 1]!;

      expect(issueOf(() => makeCategory(deepest))).toMatch(/at most 5 levels/i);
    });

    it('refuses a parent that has been deleted', () => {
      const deleted = makeCategory(null).softDelete(NOW);

      expect(issueOf(() => makeCategory(deleted))).toMatch(/deleted/i);
    });
  });

  describe('edits', () => {
    it('renames without touching placement or slug', () => {
      const root = makeCategory(null);
      const renamed = root.rename('Groceries', LATER);

      expect(renamed.name).toBe('Groceries');
      expect(renamed.slug).toBe(root.slug);
      expect(renamed.depth).toBe(root.depth);
      expect(renamed.updatedAt).toEqual(LATER);
    });

    it('offers no way to change the slug', () => {
      const root = makeCategory(null);

      // A slug that can change is not a stable public URL (D-C13). The
      // aggregate exposes no mutator for it at all.
      expect('changeSlug' in root).toBe(false);
      expect(Object.getOwnPropertyNames(Category.prototype)).not.toContain('changeSlug');
    });

    it('changes the risk level explicitly', () => {
      const root = makeCategory(null);

      expect(root.changeRiskLevel(CategoryRiskLevel.RESTRICTED, LATER).riskLevel.name).toBe(
        'RESTRICTED',
      );
    });

    it('never inherits a risk level from the parent', () => {
      const restricted = makeCategory(null, CategoryRiskLevel.RESTRICTED);
      const child = makeCategory(restricted);

      // Inheritance would mean reparenting silently reclassified a subtree.
      expect(child.riskLevel.name).toBe('LOW');
    });

    it('changes the statutory requirements as one closed triple', () => {
      const updated = makeCategory(null).changeRequirements(
        { requiresHsn: true, requiresCountryOfOrigin: true, requiresNetQuantity: false },
        LATER,
      );

      expect(updated.requirements).toEqual({
        requiresHsn: true,
        requiresCountryOfOrigin: true,
        requiresNetQuantity: false,
      });
    });

    it('never inherits requirements from the parent', () => {
      const parent = makeCategory(null).changeRequirements(
        { requiresHsn: true, requiresCountryOfOrigin: true, requiresNetQuantity: true },
        NOW,
      );
      const child = makeCategory(parent);

      expect(child.requirements).toEqual(NO_REQUIREMENTS);
    });

    it('toggles the active flag', () => {
      const root = makeCategory(null);

      expect(root.setActive(false, LATER).isActive).toBe(false);
      expect(root.isActive).toBe(true); // the original is untouched
    });

    it('refuses every edit once deleted', () => {
      const deleted = makeCategory(null).softDelete(NOW);

      expect(issueOf(() => deleted.rename('x', LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.changeRiskLevel(CategoryRiskLevel.LOW, LATER))).toMatch(
        /deleted/i,
      );
      expect(issueOf(() => deleted.changeRequirements(NO_REQUIREMENTS, LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.setActive(false, LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.softDelete(LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.reparentTo(null, [], LATER))).toMatch(/deleted/i);
    });
  });

  describe('soft delete', () => {
    it('stamps deletedAt and reports itself deleted', () => {
      const deleted = makeCategory(null).softDelete(NOW);

      expect(deleted.deletedAt).toEqual(NOW);
      expect(deleted.isDeleted).toBe(true);
    });

    it('does not judge emptiness — that is a question about other rows', () => {
      const root = makeCategory(null);
      makeCategory(root); // a child exists, but the aggregate cannot see it

      // `softDeleteIfEmpty` settles this in the database, where a concurrently
      // inserted child still counts.
      expect(() => root.softDelete(NOW)).not.toThrow();
    });
  });

  describe('reparenting', () => {
    it('moves a leaf under a new parent and updates its ancestry', () => {
      const [rootA] = chain(1) as [Category];
      const rootB = makeCategory(null);
      const leaf = makeCategory(rootA);

      const [moved] = leaf.reparentTo(rootB, [], LATER) as [Category];

      expect(moved.parentId).toBe(rootB.id);
      expect(moved.path).toEqual([rootB.id]);
      expect(moved.depth).toBe(2);
    });

    it('moves a category to the root when the new parent is null', () => {
      const [root, child] = chain(2) as [Category, Category];

      const [moved] = child.reparentTo(null, [], LATER) as [Category];

      expect(moved.parentId).toBeNull();
      expect(moved.path).toEqual([]);
      expect(moved.depth).toBe(1);
      expect(root.id).not.toBe(moved.id);
    });

    it('rewrites every descendant’s path and depth, not just the moved node', () => {
      const [rootA, mid, leaf] = chain(3) as [Category, Category, Category];
      const rootB = makeCategory(null);

      const rewritten = mid.reparentTo(rootB, [leaf], LATER);
      const [movedMid, movedLeaf] = rewritten as [Category, Category];

      expect(rewritten).toHaveLength(2);
      expect(movedMid.path).toEqual([rootB.id]);
      expect(movedLeaf.path).toEqual([rootB.id, movedMid.id]);
      expect(movedLeaf.depth).toBe(3);
      expect(movedLeaf.path).not.toContain(rootA.id);
    });

    it('keeps depth and path length in step across the whole rewritten subtree', () => {
      const [, mid, leaf] = chain(3) as [Category, Category, Category];
      const rootB = makeCategory(null);

      for (const node of mid.reparentTo(rootB, [leaf], LATER)) {
        expect(node.path.length).toBe(node.depth - 1);
      }
    });

    it('refuses a move beneath itself', () => {
      const [, mid] = chain(2) as [Category, Category];

      expect(issueOf(() => mid.reparentTo(mid, [], LATER))).toMatch(/beneath itself|own descend/i);
    });

    it('refuses a move beneath one of its own descendants', () => {
      const [, mid, leaf] = chain(3) as [Category, Category, Category];

      expect(issueOf(() => mid.reparentTo(leaf, [leaf], LATER))).toMatch(/own descendants/i);
    });

    it('refuses a move beneath a deleted parent', () => {
      const [, child] = chain(2) as [Category, Category];
      const deleted = makeCategory(null).softDelete(NOW);

      expect(issueOf(() => child.reparentTo(deleted, [], LATER))).toMatch(/deleted/i);
    });

    it('refuses a move that would push the deepest descendant past the ceiling', () => {
      // A three-deep branch cannot hang off a node already at level 4:
      // 4 + 3 = 7. Checking only the moved node would miss this entirely.
      const branch = chain(3);
      const [branchRoot, branchMid, branchLeaf] = branch as [Category, Category, Category];
      const target = chain(MAX_CATEGORY_DEPTH - 1)[MAX_CATEGORY_DEPTH - 2]!;

      expect(issueOf(() => branchRoot.reparentTo(target, [branchMid, branchLeaf], LATER))).toMatch(
        /at most 5 levels/i,
      );
    });

    it('allows a move that lands the deepest descendant exactly on the ceiling', () => {
      const [branchRoot, branchLeaf] = chain(2) as [Category, Category];
      const target = chain(4)[3]!;

      // 4 + 2 = 6 would be one too many, so use a target at level 3: 3 + 2 = 5.
      const shallower = chain(3)[2]!;
      expect(() => branchRoot.reparentTo(shallower, [branchLeaf], LATER)).not.toThrow();
      expect(target.depth).toBe(4);
    });
  });

  describe('containsInSubtree', () => {
    it('reports itself and every descendant as inside, and a sibling as outside', () => {
      const [root, mid, leaf] = chain(3) as [Category, Category, Category];
      const other = makeCategory(null);

      expect(root.containsInSubtree(root)).toBe(true);
      expect(root.containsInSubtree(mid)).toBe(true);
      expect(root.containsInSubtree(leaf)).toBe(true);
      expect(root.containsInSubtree(other)).toBe(false);
      expect(leaf.containsInSubtree(root)).toBe(false);
    });
  });
});
