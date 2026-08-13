import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaCategoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category.repository.js';
import { Category } from '../../src/modules/catalogue/domain/entities/category.entity.js';
import {
  CategoryNameConflictError,
  CategorySlugConflictError,
} from '../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { toCategoryId } from '../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';

const SLUG_PREFIX = 'cat-repo-';
const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');

const NO_REQUIREMENTS = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

let counter = 0;
const unique = (): string => `${SLUG_PREFIX}${Date.now()}-${(counter += 1)}`;

/**
 * The taxonomy against real PostgreSQL.
 *
 * The point of this suite is the half of the design that lives in the
 * database and cannot be observed anywhere else: six `CHECK` constraints,
 * three partial unique indexes, the GIN path lookup, and the two-statement
 * conditional delete. Mocking any of it would test a fiction (SDD 24.5).
 */
describe('PrismaCategoryRepository', () => {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
  let repository: PrismaCategoryRepository;

  const make = (parent: Category | null = null, riskLevel = CategoryRiskLevel.LOW): Category => {
    const slug = unique();
    return Category.create({
      id: toCategoryId(ids.generate()),
      parent,
      name: slug,
      slug: toCategorySlug(slug),
      riskLevel,
      requirements: NO_REQUIREMENTS,
      now: NOW,
    });
  };

  const persist = async (parent: Category | null = null): Promise<Category> => {
    const category = make(parent);
    await repository.create(category);
    return category;
  };

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    repository = new PrismaCategoryRepository(db);
  });

  afterEach(async () => {
    // Deepest first: the self-referencing foreign key is RESTRICT, so a parent
    // cannot be removed while a child still points at it.
    await db.$executeRawUnsafe(
      `DELETE FROM categories WHERE slug LIKE $1 AND id NOT IN (SELECT unnest(path) FROM categories WHERE slug LIKE $1)`,
      `${SLUG_PREFIX}%`,
    );
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, `${SLUG_PREFIX}%`);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe('round trip', () => {
    it('stores and reads back every field', async () => {
      const category = make(null, CategoryRiskLevel.RESTRICTED);
      await repository.create(category);

      const found = await repository.findById(category.id);

      expect(found?.id).toBe(category.id);
      expect(found?.slug).toBe(category.slug);
      expect(found?.riskLevel.name).toBe('RESTRICTED');
      expect(found?.depth).toBe(1);
      expect(found?.path).toEqual([]);
      expect(found?.isActive).toBe(true);
    });

    it('round-trips the statutory requirement flags independently', async () => {
      const category = make().changeRequirements(
        { requiresHsn: true, requiresCountryOfOrigin: false, requiresNetQuantity: true },
        NOW,
      );
      await repository.create(category);

      expect((await repository.findById(category.id))?.requirements).toEqual({
        requiresHsn: true,
        requiresCountryOfOrigin: false,
        requiresNetQuantity: true,
      });
    });

    it('finds by slug', async () => {
      const category = await persist();

      expect((await repository.findBySlug(category.slug))?.id).toBe(category.id);
    });

    it('stores the ancestor path as a real uuid array', async () => {
      const root = await persist();
      const child = await persist(root);

      expect((await repository.findById(child.id))?.path).toEqual([root.id]);
    });
  });

  describe('unique indexes', () => {
    it('refuses a duplicate slug anywhere in the tree', async () => {
      const first = await persist();
      const clash = Category.create({
        id: toCategoryId(ids.generate()),
        parent: null,
        name: unique(),
        slug: first.slug,
        riskLevel: CategoryRiskLevel.LOW,
        requirements: NO_REQUIREMENTS,
        now: NOW,
      });

      await expect(repository.create(clash)).rejects.toBeInstanceOf(CategorySlugConflictError);
    });

    it('refuses two roots sharing a name', async () => {
      // The case a single (parent_id, name) index would miss: NULL <> NULL in
      // PostgreSQL, so every root would sit in its own group.
      const first = await persist();
      const clash = Category.create({
        id: toCategoryId(ids.generate()),
        parent: null,
        name: first.name,
        slug: toCategorySlug(unique()),
        riskLevel: CategoryRiskLevel.LOW,
        requirements: NO_REQUIREMENTS,
        now: NOW,
      });

      await expect(repository.create(clash)).rejects.toBeInstanceOf(CategoryNameConflictError);
    });

    it('refuses two children of one parent sharing a name', async () => {
      const root = await persist();
      const first = await persist(root);
      const clash = Category.create({
        id: toCategoryId(ids.generate()),
        parent: root,
        name: first.name,
        slug: toCategorySlug(unique()),
        riskLevel: CategoryRiskLevel.LOW,
        requirements: NO_REQUIREMENTS,
        now: NOW,
      });

      await expect(repository.create(clash)).rejects.toBeInstanceOf(CategoryNameConflictError);
    });

    it('allows the same name under two different parents', async () => {
      const rootA = await persist();
      const rootB = await persist();
      const child = await persist(rootA);
      const twin = Category.create({
        id: toCategoryId(ids.generate()),
        parent: rootB,
        name: child.name,
        slug: toCategorySlug(unique()),
        riskLevel: CategoryRiskLevel.LOW,
        requirements: NO_REQUIREMENTS,
        now: NOW,
      });

      // "Accessories" under Electronics and under Apparel are both legitimate.
      await expect(repository.create(twin)).resolves.toBeUndefined();
    });

    it('frees a slug and a name once the category is soft-deleted', async () => {
      const first = await persist();
      await repository.softDeleteIfEmpty(first.softDelete(NOW));

      const reused = Category.create({
        id: toCategoryId(ids.generate()),
        parent: null,
        name: first.name,
        slug: first.slug,
        riskLevel: CategoryRiskLevel.LOW,
        requirements: NO_REQUIREMENTS,
        now: NOW,
      });

      // Both unique indexes are partial on `deleted_at IS NULL`.
      await expect(repository.create(reused)).resolves.toBeUndefined();
    });
  });

  describe('database CHECK constraints', () => {
    const insertRaw = (values: string): Promise<number> =>
      db.$executeRawUnsafe(
        `INSERT INTO categories (id, parent_id, path, depth, name, slug, risk_level, is_active, created_at, updated_at) VALUES (${values})`,
      );

    it('refuses a depth beyond five', async () => {
      await expect(
        insertRaw(
          `'${ids.generate()}', NULL, ARRAY[]::uuid[], 6, '${unique()}', '${unique()}', 'LOW', true, now(), now()`,
        ),
      ).rejects.toThrow(/chk_categories_depth/);
    });

    it('refuses a path whose length disagrees with the depth', async () => {
      await expect(
        insertRaw(
          `'${ids.generate()}', NULL, ARRAY['${ids.generate()}']::uuid[], 1, '${unique()}', '${unique()}', 'LOW', true, now(), now()`,
        ),
      ).rejects.toThrow(/chk_categories_path_depth|chk_categories_root_path/);
    });

    it('refuses a root that carries ancestors', async () => {
      await expect(
        insertRaw(
          `'${ids.generate()}', NULL, ARRAY['${ids.generate()}']::uuid[], 2, '${unique()}', '${unique()}', 'LOW', true, now(), now()`,
        ),
      ).rejects.toThrow(/chk_categories_root_path/);
    });

    it('refuses a category that is its own parent', async () => {
      const id = ids.generate();
      await expect(
        insertRaw(
          `'${id}', '${id}', ARRAY[]::uuid[], 1, '${unique()}', '${unique()}', 'LOW', true, now(), now()`,
        ),
      ).rejects.toThrow(/chk_categories_not_self_parent|chk_categories_root_path/);
    });

    it('refuses a category listed in its own ancestor path', async () => {
      const root = await persist();
      const id = ids.generate();
      await expect(
        insertRaw(
          `'${id}', '${root.id}', ARRAY['${id}']::uuid[], 2, '${unique()}', '${unique()}', 'LOW', true, now(), now()`,
        ),
      ).rejects.toThrow(/chk_categories_not_own_ancestor/);
    });

    it('refuses a malformed slug', async () => {
      await expect(
        insertRaw(
          `'${ids.generate()}', NULL, ARRAY[]::uuid[], 1, '${unique()}', 'Not A Slug', 'LOW', true, now(), now()`,
        ),
      ).rejects.toThrow(/chk_categories_slug_format/);
    });
  });

  describe('subtree queries', () => {
    it('finds every descendant through the materialised path, and not the node itself', async () => {
      const root = await persist();
      const mid = await persist(root);
      const leaf = await persist(mid);
      const unrelated = await persist();

      const descendants = await repository.findDescendants(root.id);
      const foundIds = descendants.map((node) => node.id);

      expect(foundIds).toContain(mid.id);
      expect(foundIds).toContain(leaf.id);
      expect(foundIds).not.toContain(root.id);
      expect(foundIds).not.toContain(unrelated.id);
    });

    it('returns descendants parents-first', async () => {
      const root = await persist();
      const mid = await persist(root);
      const leaf = await persist(mid);

      const depths = (await repository.findDescendants(root.id)).map((node) => node.depth);

      expect(depths).toEqual([...depths].sort((a, b) => a - b));
      expect(leaf.depth).toBeGreaterThan(mid.depth);
    });

    it('excludes soft-deleted descendants', async () => {
      const root = await persist();
      const child = await persist(root);
      await repository.softDeleteIfEmpty(child.softDelete(NOW));

      expect(await repository.findDescendants(root.id)).toEqual([]);
    });
  });

  describe('subtree rewrite', () => {
    it('persists a whole moved subtree consistently', async () => {
      const rootA = await persist();
      const mid = await persist(rootA);
      const leaf = await persist(mid);
      const rootB = await persist();

      await repository.updateMany(mid.reparentTo(rootB, [leaf], NOW));

      const movedMid = await repository.findById(mid.id);
      const movedLeaf = await repository.findById(leaf.id);

      expect(movedMid?.path).toEqual([rootB.id]);
      expect(movedLeaf?.path).toEqual([rootB.id, mid.id]);
      expect(movedLeaf?.depth).toBe(3);
    });

    it('leaves no row whose path and depth disagree', async () => {
      const rootA = await persist();
      const mid = await persist(rootA);
      const leaf = await persist(mid);
      const rootB = await persist();

      await repository.updateMany(mid.reparentTo(rootB, [leaf], NOW));

      const rows = await db.category.findMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
      for (const row of rows) {
        expect(row.path).toHaveLength(row.depth - 1);
      }
    });
  });

  describe('soft delete', () => {
    it('deletes a childless category and hides it from every read', async () => {
      const category = await persist();

      expect(await repository.softDeleteIfEmpty(category.softDelete(NOW))).toBe(true);
      expect(await repository.findById(category.id)).toBeNull();
      expect(await repository.findBySlug(category.slug)).toBeNull();
    });

    it('refuses while a live child exists, and leaves the row untouched', async () => {
      const root = await persist();
      await persist(root);

      expect(await repository.softDeleteIfEmpty(root.softDelete(NOW))).toBe(false);
      expect(await repository.findById(root.id)).not.toBeNull();
    });

    it('succeeds once the child itself is deleted — no cascade, one level at a time', async () => {
      const root = await persist();
      const child = await persist(root);

      await repository.softDeleteIfEmpty(child.softDelete(NOW));

      expect(await repository.softDeleteIfEmpty(root.softDelete(NOW))).toBe(true);
    });

    it('reports false for a category already deleted', async () => {
      const category = await persist();
      await repository.softDeleteIfEmpty(category.softDelete(NOW));

      expect(await repository.softDeleteIfEmpty(category.softDelete(NOW))).toBe(false);
    });
  });

  describe('pagination', () => {
    it('pages through the taxonomy without repeating or skipping a row', async () => {
      const created = [await persist(), await persist(), await persist()];
      const createdIds = new Set(created.map((category) => category.id));

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard += 1) {
        const page: Awaited<ReturnType<typeof repository.listPage>> = await repository.listPage({
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.items.map((item) => item.id).filter((id) => createdIds.has(id)));
        if (!page.hasMore) break;
        cursor = page.nextCursor ?? undefined;
      }

      expect(new Set(seen).size).toBe(seen.length);
      expect(new Set(seen)).toEqual(createdIds);
    });

    it('excludes soft-deleted categories', async () => {
      const category = await persist();
      await repository.softDeleteIfEmpty(category.softDelete(NOW));

      const page = await repository.listPage({ limit: 100 });

      expect(page.items.map((item) => item.id)).not.toContain(category.id);
    });
  });

  describe('findAllActive (S2-2c)', () => {
    it('excludes inactive and soft-deleted categories', async () => {
      const active = await persist();
      const inactive = make();
      await repository.create(inactive.setActive(false, NOW));
      const deleted = await persist();
      await repository.softDeleteIfEmpty(deleted.softDelete(NOW));

      const found = (await repository.findAllActive()).map((category) => category.id);

      expect(found).toContain(active.id);
      expect(found).not.toContain(inactive.id);
      expect(found).not.toContain(deleted.id);
    });

    it('orders by lower(name) ascending, id as tiebreak', async () => {
      // The distinguishing word comes first and the uniqueness suffix after,
      // deliberately: string comparison is lexicographic left-to-right, so the
      // word alone decides the order and the suffix never gets a vote.
      const upperFirst = Category.create({
        id: toCategoryId(ids.generate()),
        parent: null,
        name: `Banana-${unique()}`,
        slug: toCategorySlug(unique()),
        riskLevel: CategoryRiskLevel.LOW,
        requirements: NO_REQUIREMENTS,
        now: NOW,
      });
      const lowerSecond = Category.create({
        id: toCategoryId(ids.generate()),
        parent: null,
        name: `apple-${unique()}`,
        slug: toCategorySlug(unique()),
        riskLevel: CategoryRiskLevel.LOW,
        requirements: NO_REQUIREMENTS,
        now: NOW,
      });
      await repository.create(upperFirst);
      await repository.create(lowerSecond);

      const found = await repository.findAllActive();
      const names = found
        .filter((category) => category.id === upperFirst.id || category.id === lowerSecond.id)
        .map((category) => category.name);

      // "apple" sorts before "Banana" case-insensitively even though it
      // starts with a lowercase letter — proves the comparison is on
      // `lower(name)`, not on `name`'s own case.
      expect(names).toEqual([lowerSecond.name, upperFirst.name]);
    });
  });

  describe('findChildren (S2-2c)', () => {
    it('returns only immediate live children, not the whole subtree', async () => {
      const root = await persist();
      const child = await persist(root);
      const grandchild = await persist(child);
      const deletedChild = await persist(root);
      await repository.softDeleteIfEmpty(deletedChild.softDelete(NOW));

      const found = (await repository.findChildren(root.id)).map((category) => category.id);

      expect(found).toContain(child.id);
      expect(found).not.toContain(grandchild.id);
      expect(found).not.toContain(deletedChild.id);
    });

    it('includes inactive children — the caller decides whether to show them', async () => {
      const root = await persist();
      const inactiveChild = make(root);
      await repository.create(inactiveChild.setActive(false, NOW));

      const found = (await repository.findChildren(root.id)).map((category) => category.id);

      expect(found).toContain(inactiveChild.id);
    });

    it('returns an empty array for a childless category', async () => {
      const leaf = await persist();

      await expect(repository.findChildren(leaf.id)).resolves.toEqual([]);
    });
  });
});
