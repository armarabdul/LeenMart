import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { publicCategoryNodeSchema, publicCategoryTreeResponseSchema } from '@leen-mart/contracts';
import { createApp } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';
import { Category } from '../../src/modules/catalogue/domain/entities/category.entity.js';
import { PrismaCategoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category.repository.js';
import { toCategoryId } from '../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';

const SLUG_PREFIX = 'public-cat-';
const NOW = new Date('2026-03-01T00:00:00.000Z');
const NO_REQUIREMENTS = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

interface NodeBody {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly slug: string;
  readonly children: NodeBody[];
}
interface TreeResponseBody {
  readonly data: NodeBody[];
  readonly meta: { requestId: string };
}
interface DetailResponseBody {
  readonly data: NodeBody;
  readonly meta: { requestId: string };
}
interface ErrorBody {
  readonly error: { code: string };
}

const EXPECTED_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

/**
 * The public taxonomy surface (S2-2c), end to end.
 *
 * Real app, real PostgreSQL. Categories are seeded directly through
 * `PrismaCategoryRepository` on `adminPrisma` rather than via the admin HTTP
 * surface — this suite's job is the public *read* path, not admin write
 * validation, which `admin-category.test.ts` already covers.
 */
describe('public category endpoints', () => {
  let container: Container;
  let app: Express;
  let db: PrismaClient;
  let repository: PrismaCategoryRepository;

  const ids = new UuidV7Generator();
  let counter = 0;
  const unique = (): string => `${SLUG_PREFIX}${Date.now()}-${(counter += 1)}`;

  const make = (parent: Category | null = null): Category => {
    const slug = unique();
    return Category.create({
      id: toCategoryId(ids.generate()),
      parent,
      name: slug,
      slug: toCategorySlug(slug),
      riskLevel: CategoryRiskLevel.LOW,
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
    container = createContainer();
    app = createApp(container);
    db = container.adminPrisma;
    repository = new PrismaCategoryRepository(db);
  });

  afterEach(async () => {
    // Deepest first: the self-referencing foreign key is RESTRICT.
    await db.$executeRawUnsafe(
      `DELETE FROM categories WHERE slug LIKE $1 AND id NOT IN (SELECT unnest(path) FROM categories WHERE slug LIKE $1)`,
      `${SLUG_PREFIX}%`,
    );
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, `${SLUG_PREFIX}%`);
  });

  afterAll(async () => {
    await container.dispose();
  });

  describe('GET /api/v1/catalogue/categories', () => {
    it('returns 200 with no Authorization header', async () => {
      await request(app).get('/api/v1/catalogue/categories').expect(200);
    });

    it('nests children under their parent, in a correct hierarchy', async () => {
      const root = await persist();
      const child = await persist(root);
      const grandchild = await persist(child);

      const response = await request(app).get('/api/v1/catalogue/categories').expect(200);
      const body = response.body as TreeResponseBody;

      const rootNode = body.data.find((node) => node.id === root.id);
      expect(rootNode).toBeDefined();
      const childNode = rootNode?.children.find((node) => node.id === child.id);
      expect(childNode).toBeDefined();
      expect(childNode?.children.map((node) => node.id)).toEqual([grandchild.id]);
    });

    it('excludes inactive and soft-deleted categories from the tree', async () => {
      const active = await persist();
      const inactive = make();
      await repository.create(inactive.setActive(false, NOW));
      const deleted = await persist();
      await repository.softDeleteIfEmpty(deleted.softDelete(NOW));

      const response = await request(app).get('/api/v1/catalogue/categories').expect(200);
      const ids_ = (response.body as TreeResponseBody).data.map((node) => node.id);

      expect(ids_).toContain(active.id);
      expect(ids_).not.toContain(inactive.id);
      expect(ids_).not.toContain(deleted.id);
    });

    it('orders siblings by name, case-insensitively, deterministically across repeat requests', async () => {
      // The distinguishing word comes first and the uniqueness suffix after,
      // deliberately: string comparison is lexicographic left-to-right, so the
      // word alone decides the order and the suffix never gets a vote.
      const upper = Category.create({
        id: toCategoryId(ids.generate()),
        parent: null,
        name: `Zebra-${unique()}`,
        slug: toCategorySlug(unique()),
        riskLevel: CategoryRiskLevel.LOW,
        requirements: NO_REQUIREMENTS,
        now: NOW,
      });
      const lower = Category.create({
        id: toCategoryId(ids.generate()),
        parent: null,
        name: `antelope-${unique()}`,
        slug: toCategorySlug(unique()),
        riskLevel: CategoryRiskLevel.LOW,
        requirements: NO_REQUIREMENTS,
        now: NOW,
      });
      await repository.create(upper);
      await repository.create(lower);

      const first = await request(app).get('/api/v1/catalogue/categories').expect(200);
      const second = await request(app).get('/api/v1/catalogue/categories').expect(200);

      const order = (body: TreeResponseBody): string[] =>
        body.data.map((node) => node.id).filter((id) => id === upper.id || id === lower.id);

      expect(order(first.body as TreeResponseBody)).toEqual([lower.id, upper.id]);
      expect(order(second.body as TreeResponseBody)).toEqual([lower.id, upper.id]);
    });

    it('sends the D-C12 Cache-Control header', async () => {
      const response = await request(app).get('/api/v1/catalogue/categories').expect(200);

      expect(response.headers['cache-control']).toBe(EXPECTED_CACHE_CONTROL);
    });

    it('validates against the public contract, with no extra fields', async () => {
      await persist();
      const response = await request(app).get('/api/v1/catalogue/categories').expect(200);

      expect(() =>
        publicCategoryTreeResponseSchema.parse((response.body as TreeResponseBody).data),
      ).not.toThrow();
    });
  });

  describe('GET /api/v1/catalogue/categories/:slug', () => {
    it('returns 200 with no Authorization header', async () => {
      const category = await persist();

      await request(app).get(`/api/v1/catalogue/categories/${category.slug}`).expect(200);
    });

    it('returns the category with only its immediate active children', async () => {
      const root = await persist();
      const child = await persist(root);
      const grandchild = await persist(child);
      const inactiveChild = make(root);
      await repository.create(inactiveChild.setActive(false, NOW));

      const response = await request(app)
        .get(`/api/v1/catalogue/categories/${root.slug}`)
        .expect(200);
      const body = (response.body as DetailResponseBody).data;

      expect(body.id).toBe(root.id);
      expect(body.children.map((node) => node.id).sort()).toEqual([child.id].sort());
      expect(body.children.find((node) => node.id === child.id)?.children).toEqual([]);
      const grandchildIds = body.children.flatMap((node) => node.children.map((n) => n.id));
      expect(grandchildIds).not.toContain(grandchild.id);
    });

    it('sends the D-C12 Cache-Control header', async () => {
      const category = await persist();

      const response = await request(app)
        .get(`/api/v1/catalogue/categories/${category.slug}`)
        .expect(200);

      expect(response.headers['cache-control']).toBe(EXPECTED_CACHE_CONTROL);
    });

    it('validates against the public contract', async () => {
      const category = await persist();
      const response = await request(app)
        .get(`/api/v1/catalogue/categories/${category.slug}`)
        .expect(200);

      expect(() =>
        publicCategoryNodeSchema.parse((response.body as DetailResponseBody).data),
      ).not.toThrow();
    });

    it('returns 404 for an unknown slug', async () => {
      const response = await request(app)
        .get(`/api/v1/catalogue/categories/${unique()}`)
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('returns the same 404 for an inactive category as for an unknown slug', async () => {
      const inactive = make();
      await repository.create(inactive.setActive(false, NOW));

      const response = await request(app)
        .get(`/api/v1/catalogue/categories/${inactive.slug}`)
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('returns the same 404 for a soft-deleted category as for an unknown slug', async () => {
      const category = await persist();
      await repository.softDeleteIfEmpty(category.softDelete(NOW));

      const response = await request(app)
        .get(`/api/v1/catalogue/categories/${category.slug}`)
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('returns 400 for a malformed slug rather than a 404', async () => {
      const response = await request(app)
        .get('/api/v1/catalogue/categories/Not_A_Valid_Slug!')
        .expect(400);

      expect((response.body as ErrorBody).error.code).toBeDefined();
    });
  });

  describe('admin surface unaffected', () => {
    it('GET /api/v1/admin/categories still requires authentication', async () => {
      await request(app).get('/api/v1/admin/categories').expect(401);
    });
  });
});
