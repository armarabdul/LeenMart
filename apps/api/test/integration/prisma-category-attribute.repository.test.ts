import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaCategoryAttributeRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category-attribute.repository.js';
import { PrismaCategoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category.repository.js';
import { Category } from '../../src/modules/catalogue/domain/entities/category.entity.js';
import { CategoryAttribute } from '../../src/modules/catalogue/domain/entities/category-attribute.entity.js';
import { CategoryAttributeKeyConflictError } from '../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { toCategoryAttributeId } from '../../src/modules/catalogue/domain/value-objects/category-attribute-id.value-object.js';
import { CategoryAttributeType } from '../../src/modules/catalogue/domain/value-objects/category-attribute-type.value-object.js';
import {
  toCategoryId,
  type CategoryId,
} from '../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';

const SLUG_PREFIX = 'attr-repo-';
const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');

let counter = 0;
const unique = (): string => `${SLUG_PREFIX}${Date.now()}-${(counter += 1)}`;

/**
 * Attribute definitions against real PostgreSQL.
 *
 * The point of this suite is the half of the design that only exists in the
 * database: four `CHECK` constraints, the partial unique index, and the
 * `(position, key)` ordering that makes a tied position deterministic.
 * Mocking any of it would test a fiction (SDD 24.5).
 */
describe('PrismaCategoryAttributeRepository', () => {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
  let categories: PrismaCategoryRepository;
  let repository: PrismaCategoryAttributeRepository;

  const seedCategory = async (): Promise<Category> => {
    const slug = unique();
    const category = Category.create({
      id: toCategoryId(ids.generate()),
      parent: null,
      name: slug,
      slug: toCategorySlug(slug),
      riskLevel: CategoryRiskLevel.LOW,
      requirements: {
        requiresHsn: false,
        requiresCountryOfOrigin: false,
        requiresNetQuantity: false,
      },
      now: NOW,
    });
    await categories.create(category);
    return category;
  };

  interface AttributeOverrides {
    key?: string;
    dataType?: CategoryAttributeType;
    unit?: string | null;
    options?: readonly string[];
    position?: number;
  }

  const make = (categoryId: CategoryId, overrides: AttributeOverrides = {}): CategoryAttribute =>
    CategoryAttribute.create({
      id: toCategoryAttributeId(ids.generate()),
      categoryId,
      key: overrides.key ?? `key_${(counter += 1)}`,
      label: 'Label',
      dataType: overrides.dataType ?? CategoryAttributeType.STRING,
      isRequired: false,
      unit: overrides.unit ?? null,
      options: overrides.options ?? [],
      position: overrides.position ?? 0,
      now: NOW,
    });

  const persist = async (
    categoryId: CategoryId,
    overrides: AttributeOverrides = {},
  ): Promise<CategoryAttribute> => {
    const attribute = make(categoryId, overrides);
    await repository.create(attribute);
    return attribute;
  };

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    categories = new PrismaCategoryRepository(db);
    repository = new PrismaCategoryAttributeRepository(db);
  });

  afterEach(async () => {
    // Attributes first: the foreign key to `categories` is RESTRICT.
    await db.$executeRawUnsafe(
      `DELETE FROM category_attributes WHERE category_id IN (SELECT id FROM categories WHERE slug LIKE $1)`,
      `${SLUG_PREFIX}%`,
    );
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, `${SLUG_PREFIX}%`);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe('round trip', () => {
    it.each(['STRING', 'BOOLEAN'])('stores and reads back a %s', async (name) => {
      const category = await seedCategory();
      const attribute = await persist(category.id, {
        dataType: CategoryAttributeType.fromName(name),
      });

      const found = await repository.findById(category.id, attribute.id);

      expect(found?.dataType.name).toBe(name);
      expect(found?.unit).toBeNull();
      expect(found?.options).toEqual([]);
    });

    it('stores and reads back a NUMBER with its unit', async () => {
      const category = await seedCategory();
      const attribute = await persist(category.id, {
        dataType: CategoryAttributeType.NUMBER,
        unit: 'kg',
      });

      expect((await repository.findById(category.id, attribute.id))?.unit).toBe('kg');
    });

    it('stores and reads back an ENUM’s options as a real array, in order', async () => {
      const category = await seedCategory();
      const attribute = await persist(category.id, {
        dataType: CategoryAttributeType.ENUM,
        options: ['small', 'medium', 'large'],
      });

      expect((await repository.findById(category.id, attribute.id))?.options).toEqual([
        'small',
        'medium',
        'large',
      ]);
    });

    it('returns null for an attribute that belongs to a different category', async () => {
      const owner = await seedCategory();
      const other = await seedCategory();
      const attribute = await persist(owner.id, {});

      // Absent, not "valid id, wrong parent" — the same non-disclosure
      // `KycDocumentNotFoundError` records.
      expect(await repository.findById(other.id, attribute.id)).toBeNull();
    });
  });

  describe('unique index', () => {
    it('refuses a duplicate key within one category', async () => {
      const category = await seedCategory();
      const first = await persist(category.id, { key: 'weight' });

      await expect(repository.create(make(category.id, { key: first.key }))).rejects.toBeInstanceOf(
        CategoryAttributeKeyConflictError,
      );
    });

    it('allows the same key under two different categories', async () => {
      const a = await seedCategory();
      const b = await seedCategory();
      await persist(a.id, { key: 'weight' });

      await expect(repository.create(make(b.id, { key: 'weight' }))).resolves.toBeUndefined();
    });

    it('frees the key once the attribute is soft-deleted', async () => {
      const category = await seedCategory();
      const first = await persist(category.id, { key: 'weight' });
      await repository.softDelete(first.softDelete(LATER));

      // The index is partial on `deleted_at IS NULL`.
      await expect(
        repository.create(make(category.id, { key: 'weight' })),
      ).resolves.toBeUndefined();
    });
  });

  describe('database CHECK constraints', () => {
    const insertRaw = (categoryId: string, values: string): Promise<number> =>
      db.$executeRawUnsafe(
        `INSERT INTO category_attributes (id, category_id, key, label, data_type, is_required, unit, options, position, created_at, updated_at) VALUES ('${ids.generate()}', '${categoryId}', ${values}, now(), now())`,
      );

    it('refuses a malformed key', async () => {
      const category = await seedCategory();

      await expect(
        insertRaw(category.id, `'Weight', 'L', 'STRING', false, NULL, ARRAY[]::varchar[], 0`),
      ).rejects.toThrow(/chk_category_attributes_key_format/);
    });

    it('refuses an ENUM with no options', async () => {
      const category = await seedCategory();

      await expect(
        insertRaw(category.id, `'size', 'L', 'ENUM', false, NULL, ARRAY[]::varchar[], 0`),
      ).rejects.toThrow(/chk_category_attributes_options/);
    });

    it.each(['STRING', 'NUMBER', 'BOOLEAN'])('refuses options on a %s', async (name) => {
      const category = await seedCategory();

      await expect(
        insertRaw(category.id, `'size', 'L', '${name}', false, NULL, ARRAY['a']::varchar[], 0`),
      ).rejects.toThrow(/chk_category_attributes_options/);
    });

    it.each(['STRING', 'BOOLEAN'])('refuses a unit on a %s', async (name) => {
      const category = await seedCategory();

      await expect(
        insertRaw(category.id, `'size', 'L', '${name}', false, 'kg', ARRAY[]::varchar[], 0`),
      ).rejects.toThrow(/chk_category_attributes_unit/);
    });

    it('refuses a negative position', async () => {
      const category = await seedCategory();

      await expect(
        insertRaw(category.id, `'size', 'L', 'STRING', false, NULL, ARRAY[]::varchar[], -1`),
      ).rejects.toThrow(/chk_category_attributes_position/);
    });

    it('refuses an attribute on a category that does not exist', async () => {
      await expect(
        insertRaw(ids.generate(), `'size', 'L', 'STRING', false, NULL, ARRAY[]::varchar[], 0`),
      ).rejects.toThrow(/foreign key|category_attributes_category_id_fkey/i);
    });
  });

  describe('listing', () => {
    it('orders by position, then key — so a tie is still deterministic', async () => {
      const category = await seedCategory();
      await persist(category.id, { key: 'zebra', position: 1 });
      await persist(category.id, { key: 'apple', position: 1 });
      await persist(category.id, { key: 'first', position: 0 });

      const keys = (await repository.listByCategoryId(category.id)).map((a) => a.key);

      expect(keys).toEqual(['first', 'apple', 'zebra']);
    });

    it('excludes soft-deleted attributes', async () => {
      const category = await seedCategory();
      const kept = await persist(category.id, {});
      const removed = await persist(category.id, {});
      await repository.softDelete(removed.softDelete(LATER));

      const found = await repository.listByCategoryId(category.id);

      expect(found.map((a) => a.id)).toEqual([kept.id]);
    });

    it('returns only the requested category’s attributes', async () => {
      const a = await seedCategory();
      const b = await seedCategory();
      const mine = await persist(a.id, {});
      await persist(b.id, {});

      expect((await repository.listByCategoryId(a.id)).map((x) => x.id)).toEqual([mine.id]);
    });
  });

  describe('updates and deletion', () => {
    it('persists an edit and leaves key and data type alone', async () => {
      const category = await seedCategory();
      const attribute = await persist(category.id, { dataType: CategoryAttributeType.NUMBER });

      const edited = attribute.relabel('New label', LATER).moveTo(9, LATER).changeUnit('g', LATER);
      expect(await repository.update(edited)).toBe(true);

      const found = await repository.findById(category.id, attribute.id);
      expect(found?.label).toBe('New label');
      expect(found?.position).toBe(9);
      expect(found?.unit).toBe('g');
      expect(found?.key).toBe(attribute.key);
      expect(found?.dataType.name).toBe('NUMBER');
    });

    it('reports false when updating an already-deleted attribute', async () => {
      const category = await seedCategory();
      const attribute = await persist(category.id, {});
      await repository.softDelete(attribute.softDelete(LATER));

      expect(await repository.update(attribute.relabel('x', LATER))).toBe(false);
    });

    it('soft-deletes one attribute and hides it from every read', async () => {
      const category = await seedCategory();
      const attribute = await persist(category.id, {});

      expect(await repository.softDelete(attribute.softDelete(LATER))).toBe(true);
      expect(await repository.findById(category.id, attribute.id)).toBeNull();
    });

    it('soft-deletes every live attribute of a category and reports the count', async () => {
      const category = await seedCategory();
      await persist(category.id, {});
      await persist(category.id, {});
      const alreadyGone = await persist(category.id, {});
      await repository.softDelete(alreadyGone.softDelete(LATER));

      expect(await repository.softDeleteAllForCategory(category.id, LATER)).toBe(2);
      expect(await repository.listByCategoryId(category.id)).toEqual([]);
    });

    it('leaves another category’s attributes alone when clearing one', async () => {
      const a = await seedCategory();
      const b = await seedCategory();
      await persist(a.id, {});
      const untouched = await persist(b.id, {});

      await repository.softDeleteAllForCategory(a.id, LATER);

      expect((await repository.listByCategoryId(b.id)).map((x) => x.id)).toEqual([untouched.id]);
    });
  });
});
