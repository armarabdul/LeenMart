import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { createApp } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';
import { signUpCustomer, type Actor } from '../support/actors.js';

const EMAIL_PREFIX = 'public-search-';
const NOW = new Date('2026-03-01T00:00:00.000Z');

interface SearchResultItem {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly brand: string | null;
  readonly description: string | null;
  readonly hsnCode: string | null;
  readonly countryOfOrigin: string | null;
  readonly netQuantity: string | null;
  readonly attributeValues: Record<string, unknown>;
  readonly mediaCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  // Only present if a bug ever puts them on the wire — asserted absent below.
  readonly vendorId?: string;
  readonly status?: string;
  readonly rejectionReason?: string | null;
  readonly rejectionNote?: string | null;
  readonly deletedAt?: string | null;
  readonly objectKey?: string;
  readonly price?: unknown;
  readonly variants?: unknown;
}

interface SearchResponseBody {
  readonly data: SearchResultItem[];
  readonly meta: {
    readonly requestId: string;
    readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

interface ErrorBody {
  readonly error: { readonly code: string };
}

const requireDatabaseUrl = (): string => {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error('DATABASE_URL must be set for this suite (owner connection for fixtures).');
  }
  return value;
};

/**
 * The public, unauthenticated search surface (S2-7), end to end.
 *
 * Fixtures are written directly through the **owner** connection, never
 * `container.adminPrisma`/`container.prisma` — `leenmart_admin` has no INSERT
 * grant on `products` (only the one moderation-decision UPDATE path), so
 * seeding an already-`APPROVED` row has to bypass the moderation workflow
 * entirely, the same reasoning `product-rls-isolation.test.ts` gives for its
 * own `owner` client. This suite's job is the public *read* path, not the
 * moderation flow that produces an `APPROVED` row in production.
 */
describe('public search endpoint (S2-7)', () => {
  let container: Container;
  let app: Express;
  let owner: PrismaClient;
  const ids = new UuidV7Generator();

  const userIds: string[] = [];
  const vendorIds: string[] = [];
  const categoryIds: string[] = [];

  const clearRateLimitKeys = async (): Promise<void> => {
    const keys = await container.redis.keys('rl:*');
    if (keys.length > 0) await container.redis.del(...keys);
  };

  const seedVendor = async (label: string): Promise<string> => {
    const userId = ids.generate();
    const vendorId = ids.generate();
    await owner.user.create({
      data: {
        id: userId,
        email: `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      },
    });
    await owner.vendorProfile.create({
      data: { id: vendorId, userId, createdAt: NOW, updatedAt: NOW },
    });
    userIds.push(userId);
    vendorIds.push(vendorId);
    return vendorId;
  };

  const seedCategory = async (label: string): Promise<string> => {
    const categoryId = ids.generate();
    const slug = `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await owner.category.create({
      data: {
        id: categoryId,
        path: [],
        depth: 1,
        name: slug,
        slug,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    categoryIds.push(categoryId);
    return categoryId;
  };

  const seedProduct = async (params: {
    vendorId: string;
    categoryId: string;
    name: string;
    status?: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
    deleted?: boolean;
  }): Promise<string> => {
    const id = ids.generate();
    await owner.product.create({
      data: {
        id,
        vendorId: params.vendorId,
        categoryId: params.categoryId,
        name: params.name,
        attributeValues: {},
        status: params.status ?? 'APPROVED',
        // The CHECK constraint requires a reason exactly while REJECTED.
        rejectionReason: params.status === 'REJECTED' ? 'OTHER' : null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: params.deleted ? NOW : null,
      },
    });
    return id;
  };

  const seedMedia = async (params: {
    productId: string;
    vendorId: string;
    status?: 'AWAITING_UPLOAD' | 'PROCESSING' | 'READY' | 'FAILED';
    deleted?: boolean;
  }): Promise<void> => {
    await owner.productMedia.create({
      data: {
        id: ids.generate(),
        productId: params.productId,
        vendorId: params.vendorId,
        objectKey: `product-media/${params.vendorId}/${params.productId}/${ids.generate()}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        status: params.status ?? 'READY',
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: params.deleted ? NOW : null,
      },
    });
  };

  let customer: Actor;

  beforeAll(async () => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    owner = new PrismaClient({ datasources: { db: { url: requireDatabaseUrl() } } });
    await clearRateLimitKeys();
    customer = await signUpCustomer(app, EMAIL_PREFIX, 'auth-tier');
  });

  // Every test starts with a clean rate-limit budget — otherwise the loop
  // tests below inherit whatever earlier tests in this file already spent,
  // and stop landing on the exact boundary they exist to prove.
  beforeEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    await owner.productMedia.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await owner.product.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await owner.category.deleteMany({ where: { id: { in: categoryIds } } });
    await owner.vendorProfile.deleteMany({ where: { id: { in: vendorIds } } });
    await owner.user.deleteMany({ where: { id: { in: userIds } } });
    await clearRateLimitKeys();
    await owner.$disconnect();
    await container.dispose();
  });

  describe('unauthenticated access', () => {
    it('answers 200 with no Authorization header', async () => {
      await request(app).get('/api/v1/search').expect(200);
    });

    it('shapes the response as the platform pagination envelope', async () => {
      const response = await request(app).get('/api/v1/search').expect(200);
      const body = response.body as SearchResponseBody;

      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.meta.requestId).toBe('string');
      expect(typeof body.meta.pagination.hasMore).toBe('boolean');
      expect(
        body.meta.pagination.nextCursor === null ||
          typeof body.meta.pagination.nextCursor === 'string',
      ).toBe(true);
    });
  });

  describe('response field exposure (S2-7 final approval)', () => {
    it('never exposes vendorId, status, rejection detail, storage keys, price or variants', async () => {
      const vendorId = await seedVendor('exposure');
      const categoryId = await seedCategory('exposure');
      const productId = await seedProduct({
        vendorId,
        categoryId,
        name: `ExposureCheck-${Date.now()}`,
      });
      await seedMedia({ productId, vendorId });

      const response = await request(app).get('/api/v1/search').query({ categoryId }).expect(200);
      const [item] = (response.body as SearchResponseBody).data;

      expect(item).toBeDefined();
      expect(item).not.toHaveProperty('vendorId');
      expect(item).not.toHaveProperty('status');
      expect(item).not.toHaveProperty('rejectionReason');
      expect(item).not.toHaveProperty('rejectionNote');
      expect(item).not.toHaveProperty('deletedAt');
      expect(item).not.toHaveProperty('objectKey');
      expect(item).not.toHaveProperty('price');
      expect(item).not.toHaveProperty('variants');
      expect(item).not.toHaveProperty('availability');
      expect(item?.mediaCount).toBe(1);
    });

    it('excludes DRAFT, PENDING_REVIEW, REJECTED and soft-deleted products entirely', async () => {
      const vendorId = await seedVendor('lifecycle');
      const categoryId = await seedCategory('lifecycle');
      const stamp = Date.now();
      await seedProduct({
        vendorId,
        categoryId,
        name: `LifecycleDraft-${stamp}`,
        status: 'DRAFT',
      });
      await seedProduct({
        vendorId,
        categoryId,
        name: `LifecyclePending-${stamp}`,
        status: 'PENDING_REVIEW',
      });
      await seedProduct({
        vendorId,
        categoryId,
        name: `LifecycleRejected-${stamp}`,
        status: 'REJECTED',
      });
      await seedProduct({
        vendorId,
        categoryId,
        name: `LifecycleDeleted-${stamp}`,
        status: 'APPROVED',
        deleted: true,
      });
      const visibleId = await seedProduct({
        vendorId,
        categoryId,
        name: `LifecycleApproved-${stamp}`,
      });

      const response = await request(app).get('/api/v1/search').query({ categoryId }).expect(200);
      const body = response.body as SearchResponseBody;

      expect(body.data.map((item) => item.id)).toEqual([visibleId]);
    });
  });

  describe('search term matching', () => {
    it('matches a full word case-insensitively', async () => {
      const vendorId = await seedVendor('word-match');
      const categoryId = await seedCategory('word-match');
      const stamp = Date.now();
      const mangoId = await seedProduct({
        vendorId,
        categoryId,
        name: `Alphonso Mango ${stamp}`,
      });
      await seedProduct({ vendorId, categoryId, name: `Basmati Rice ${stamp}` });

      const response = await request(app)
        .get('/api/v1/search')
        .query({ categoryId, q: `MANGO ${stamp}`.toLowerCase() })
        .expect(200);
      const body = response.body as SearchResponseBody;

      expect(body.data.map((item) => item.id)).toEqual([mangoId]);
    });

    it('matches a mid-word substring via trigram/ILIKE, not just whole words', async () => {
      const vendorId = await seedVendor('substring-match');
      const categoryId = await seedCategory('substring-match');
      const stamp = Date.now();
      const alphonsoId = await seedProduct({
        vendorId,
        categoryId,
        name: `Alphons${stamp}Mango`,
      });

      // "phons" is a mid-word substring of "Alphonso" — not a token
      // `plainto_tsquery` would ever match on its own, so this only succeeds
      // through the ILIKE fallback (decision F).
      const response = await request(app)
        .get('/api/v1/search')
        .query({ categoryId, q: `phons${stamp}` })
        .expect(200);
      const body = response.body as SearchResponseBody;

      expect(body.data.map((item) => item.id)).toEqual([alphonsoId]);
    });

    it('returns an empty page for a term matching nothing', async () => {
      const categoryId = await seedCategory('empty-search');

      const response = await request(app)
        .get('/api/v1/search')
        .query({ categoryId, q: 'no-such-product-anywhere' })
        .expect(200);
      const body = response.body as SearchResponseBody;

      expect(body.data).toEqual([]);
      expect(body.meta.pagination).toEqual({ nextCursor: null, hasMore: false });
    });
  });

  describe('filters', () => {
    it('narrows results by categoryId', async () => {
      const vendorId = await seedVendor('category-filter');
      const categoryA = await seedCategory('category-filter-a');
      const categoryB = await seedCategory('category-filter-b');
      const stamp = Date.now();
      const inA = await seedProduct({
        vendorId,
        categoryId: categoryA,
        name: `CategoryFilterA-${stamp}`,
      });
      await seedProduct({ vendorId, categoryId: categoryB, name: `CategoryFilterB-${stamp}` });

      const response = await request(app)
        .get('/api/v1/search')
        .query({ categoryId: categoryA })
        .expect(200);
      const body = response.body as SearchResponseBody;

      expect(body.data.map((item) => item.id)).toContain(inA);
      expect(body.data.every((item) => item.categoryId === categoryA)).toBe(true);
    });

    it('narrows results by vendorId', async () => {
      const vendorA = await seedVendor('vendor-filter-a');
      const vendorB = await seedVendor('vendor-filter-b');
      const categoryId = await seedCategory('vendor-filter');
      const stamp = Date.now();
      await seedProduct({ vendorId: vendorA, categoryId, name: `VendorFilterA-${stamp}` });
      await seedProduct({ vendorId: vendorB, categoryId, name: `VendorFilterB-${stamp}` });

      const response = await request(app)
        .get('/api/v1/search')
        .query({ categoryId, vendorId: vendorA })
        .expect(200);
      const body = response.body as SearchResponseBody;

      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.name).toBe(`VendorFilterA-${stamp}`);
    });

    it('combines q and categoryId', async () => {
      const vendorId = await seedVendor('combined-filter');
      const categoryA = await seedCategory('combined-filter-a');
      const categoryB = await seedCategory('combined-filter-b');
      const stamp = Date.now();
      const target = await seedProduct({
        vendorId,
        categoryId: categoryA,
        name: `CombinedMango-${stamp}`,
      });
      // Same term, wrong category — must be excluded.
      await seedProduct({ vendorId, categoryId: categoryB, name: `CombinedMango-${stamp}` });
      // Right category, wrong term — must be excluded.
      await seedProduct({ vendorId, categoryId: categoryA, name: `CombinedRice-${stamp}` });

      const response = await request(app)
        .get('/api/v1/search')
        .query({ categoryId: categoryA, q: `combinedmango-${stamp}` })
        .expect(200);
      const body = response.body as SearchResponseBody;

      expect(body.data.map((item) => item.id)).toEqual([target]);
    });
  });

  describe('cursor pagination', () => {
    it('walks a three-item page boundary with limit=2 and stops correctly', async () => {
      const vendorId = await seedVendor('pagination');
      const categoryId = await seedCategory('pagination');
      const stamp = Date.now();
      // Named so the `(name ASC, id ASC)` order is deterministic.
      const first = await seedProduct({ vendorId, categoryId, name: `PageOrder-${stamp}-A` });
      const second = await seedProduct({ vendorId, categoryId, name: `PageOrder-${stamp}-B` });
      const third = await seedProduct({ vendorId, categoryId, name: `PageOrder-${stamp}-C` });

      const page1 = await request(app)
        .get('/api/v1/search')
        .query({ categoryId, limit: 2 })
        .expect(200);
      const body1 = page1.body as SearchResponseBody;

      expect(body1.data.map((item) => item.id)).toEqual([first, second]);
      expect(body1.meta.pagination.hasMore).toBe(true);
      expect(body1.meta.pagination.nextCursor).toEqual(expect.any(String));

      const page2 = await request(app)
        .get('/api/v1/search')
        .query({ categoryId, limit: 2, cursor: body1.meta.pagination.nextCursor })
        .expect(200);
      const body2 = page2.body as SearchResponseBody;

      expect(body2.data.map((item) => item.id)).toEqual([third]);
      expect(body2.meta.pagination.hasMore).toBe(false);
      expect(body2.meta.pagination.nextCursor).toBeNull();
    });

    it('rejects a malformed cursor with 400 INVALID_CURSOR', async () => {
      const response = await request(app)
        .get('/api/v1/search')
        .query({ cursor: 'not-a-real-cursor-!!!' })
        .expect(400);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_CURSOR');
    });
  });

  describe('limit', () => {
    it('defaults to 20 and reports hasMore for a 21st product', async () => {
      const vendorId = await seedVendor('default-limit');
      const categoryId = await seedCategory('default-limit');
      const stamp = Date.now();
      await owner.product.createMany({
        data: Array.from({ length: 21 }, (_unused, index) => ({
          id: ids.generate(),
          vendorId,
          categoryId,
          name: `DefaultLimit-${stamp}-${String(index).padStart(2, '0')}`,
          attributeValues: {},
          status: 'APPROVED' as const,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      });

      const response = await request(app).get('/api/v1/search').query({ categoryId }).expect(200);
      const body = response.body as SearchResponseBody;

      expect(body.data).toHaveLength(20);
      expect(body.meta.pagination.hasMore).toBe(true);
    });

    it('accepts the maximum limit of 100', async () => {
      const categoryId = await seedCategory('max-limit');

      await request(app).get('/api/v1/search').query({ categoryId, limit: 100 }).expect(200);
    });

    it('rejects a limit above 100 at the contract boundary', async () => {
      await request(app).get('/api/v1/search').query({ limit: 101 }).expect(400);
    });

    it('rejects a limit below 1', async () => {
      await request(app).get('/api/v1/search').query({ limit: 0 }).expect(400);
    });
  });

  describe('optional authentication', () => {
    it('401s a present but malformed bearer token — never silently anonymous', async () => {
      const response = await request(app)
        .get('/api/v1/search')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('401s a present but expired bearer token — never silently anonymous', async () => {
      const expired = jwt.sign(
        { role: 'CUSTOMER', sid: '00000000-0000-7000-8000-0000000000ff' },
        container.env.JWT_ACCESS_SECRET,
        {
          subject: '00000000-0000-7000-8000-0000000000fe',
          issuer: container.env.SERVICE_NAME,
          audience: container.env.JWT_AUDIENCE,
          jwtid: '00000000-0000-7000-8000-0000000000fd',
          expiresIn: -10,
        },
      );

      const response = await request(app)
        .get('/api/v1/search')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('a valid token searches successfully, same as anonymous', async () => {
      await request(app)
        .get('/api/v1/search')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);
    });
  });

  describe('rate limits (SDD 20)', () => {
    it('caps anonymous search at 60 per minute per IP', async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await request(app).get('/api/v1/search').expect(200);
      }

      const blocked = await request(app).get('/api/v1/search').expect(429);
      expect((blocked.body as ErrorBody).error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('caps authenticated search at 120 per minute', async () => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${customer.token}`)
          .expect(200);
      }

      const blocked = await request(app)
        .get('/api/v1/search')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(429);
      expect((blocked.body as ErrorBody).error.code).toBe('RATE_LIMIT_EXCEEDED');
    }, 30_000);

    it('an authenticated caller is not capped by the anonymous IP bucket', async () => {
      // Exhaust the anonymous budget completely...
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await request(app).get('/api/v1/search').expect(200);
      }
      await request(app).get('/api/v1/search').expect(429);

      // ...and an authenticated request on the very same connection still
      // succeeds: it was never drawing from that bucket at all.
      await request(app)
        .get('/api/v1/search')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);
    });
  });
});
