import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { OTP } from 'otplib';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../src/modules/catalogue/domain/audit-actions.js';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/security/argon2-password-hasher.js';
import { AesGcmMfaSecretCipher } from '../../src/modules/identity/infrastructure/security/aes-gcm-mfa-secret-cipher.service.js';
import { OtplibTotpService } from '../../src/modules/identity/infrastructure/security/otplib-totp.service.js';
import { PrismaMfaSecretRepository } from '../../src/modules/identity/infrastructure/persistence/prisma-mfa-secret.repository.js';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/persistence/prisma-user.repository.js';
import { MfaSecret } from '../../src/modules/identity/domain/entities/mfa-secret.entity.js';
import { User } from '../../src/modules/identity/domain/entities/user.entity.js';
import { Role } from '../../src/modules/identity/domain/value-objects/role.value-object.js';
import { toMfaSecretId } from '../../src/modules/identity/domain/value-objects/mfa-secret-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { RoleName } from '../../src/modules/identity/domain/value-objects/role.value-object.js';

const EMAIL_PREFIX = 'admin-category-';
const SLUG_PREFIX = 'admin-cat-';
const ADMIN_PASSWORD = 'admin-password-that-is-long-enough';
const CUSTOMER_PASSWORD = 'customer-password-long-enough';

interface ErrorBody {
  readonly error: { code: string };
}
interface AuthBody {
  readonly data: { accessToken: string; user: { id: string } };
}
interface ChallengeBody {
  readonly data: { mfaChallengeToken: string };
}
interface CategoryBody {
  readonly data: {
    id: string;
    parentId: string | null;
    path: string[];
    depth: number;
    name: string;
    slug: string;
    riskLevel: string;
    requirements: {
      requiresHsn: boolean;
      requiresCountryOfOrigin: boolean;
      requiresNetQuantity: boolean;
    };
    isActive: boolean;
  };
}
interface CategoryListBody {
  readonly data: CategoryBody['data'][];
  readonly meta: { pagination: { nextCursor: string | null; hasMore: boolean } };
}
interface AttributeBody {
  readonly data: {
    readonly id: string;
    readonly categoryId: string;
    readonly key: string;
    readonly label: string;
    readonly dataType: string;
    readonly isRequired: boolean;
    readonly unit: string | null;
    readonly options: string[];
    readonly position: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
}
interface AttributeListBody {
  readonly data: AttributeBody['data'][];
  readonly meta: { requestId: string };
}

/**
 * The admin taxonomy surface (S2-2a), end to end.
 *
 * Real admin two-step authentication, real `adminPrisma`, real PostgreSQL —
 * because the half of this feature that matters most is the authorisation
 * matrix and the database constraints, neither of which exists against a fake.
 */
describe('admin category endpoints', () => {
  let container: Container;
  let app: Express;
  let db: PrismaClient;

  const ids = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
  const now = clock.now();
  const seededUserIds: string[] = [];

  let counter = 0;
  const uniqueSlug = (): string => `${SLUG_PREFIX}${Date.now()}-${(counter += 1)}`;
  const uniqueEmail = (label: string): string =>
    `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@leenmart.in`.toLowerCase();

  const currentTotpCode = async (secret: string): Promise<string> =>
    new OTP({ strategy: 'totp' }).generate({
      secret,
      algorithm: 'sha1',
      digits: 6,
      period: 30,
      epoch: Math.floor(Date.now() / 1000),
    });

  /** One signed-in admin per role, cached — `LOGIN_PER_IP` caps logins at 20/min. */
  const adminTokens = new Map<string, string>();
  const adminFor = async (role: RoleName): Promise<string> => {
    const cached = adminTokens.get(role);
    if (cached) return cached;

    const email = uniqueEmail(role.toLowerCase());
    const admin = User.registerAdmin({
      id: toUserId(ids.generate()),
      email,
      passwordHash: await new Argon2PasswordHasher().hash(ADMIN_PASSWORD),
      role: Role.fromName(role),
      now,
    });
    await new PrismaUserRepository(db).create(admin);
    seededUserIds.push(admin.id);

    const secret = new OtplibTotpService().generateSecret();
    await new PrismaMfaSecretRepository(db).create(
      MfaSecret.enroll({
        id: toMfaSecretId(ids.generate()),
        userId: admin.id,
        encryptedSecret: new AesGcmMfaSecretCipher(
          Buffer.from(container.env.MFA_ENCRYPTION_KEY, 'hex'),
        ).encrypt(secret),
        now,
      }).confirm(now),
    );

    const stepOne = await request(app)
      .post('/api/v1/admin/login')
      .send({ email, password: ADMIN_PASSWORD })
      .expect(200);
    const verified = await request(app)
      .post('/api/v1/admin/mfa/verify')
      .send({
        mfaChallengeToken: (stepOne.body as ChallengeBody).data.mfaChallengeToken,
        totpCode: await currentTotpCode(secret),
      })
      .expect(200);

    const token = (verified.body as AuthBody).data.accessToken;
    adminTokens.set(role, token);
    return token;
  };

  const asCustomer = async (): Promise<string> => {
    const cached = adminTokens.get('CUSTOMER');
    if (cached) return cached;
    const response = await request(app)
      .post('/api/v1/identity/register')
      .send({ email: uniqueEmail('customer'), password: CUSTOMER_PASSWORD })
      .expect(201);
    const body = response.body as AuthBody;
    seededUserIds.push(body.data.user.id);
    adminTokens.set('CUSTOMER', body.data.accessToken);
    return body.data.accessToken;
  };

  const createCategory = (token: string, overrides: Record<string, unknown> = {}): request.Test => {
    const slug = uniqueSlug();
    return request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ parentId: null, name: slug, slug, ...overrides });
  };

  const seed = async (parentId: string | null = null): Promise<CategoryBody['data']> => {
    const token = await adminFor('SUPER_ADMIN');
    const response = await createCategory(token, { parentId }).expect(201);
    return (response.body as CategoryBody).data;
  };

  // Synchronous on purpose: supertest's `Test` is thenable, so an `async`
  // builder would fire the request the moment it was awaited, before
  // `.expect()` could ever be attached. Shared at this scope (not just by
  // `describe('update')`/`describe('delete')`) because the attribute tests
  // below also need to deactivate and delete categories.
  const patch = (token: string, id: string, body: Record<string, unknown>): request.Test =>
    request(app)
      .patch(`/api/v1/admin/categories/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const remove = (token: string, id: string): request.Test =>
    request(app).delete(`/api/v1/admin/categories/${id}`).set('Authorization', `Bearer ${token}`);

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
  });

  afterAll(async () => {
    // Attribute rows first: `category_attributes.category_id` is a plain FK
    // (no `ON DELETE CASCADE` — the app cascades by soft-deleting both in one
    // transaction, which a hard test-cleanup DELETE bypasses entirely), so a
    // leftover attribute row on any seeded category blocks the category
    // deletes below with a foreign-key violation.
    await db.$executeRawUnsafe(
      `DELETE FROM category_attributes WHERE category_id IN (SELECT id FROM categories WHERE slug LIKE $1)`,
      `${SLUG_PREFIX}%`,
    );
    await db.$executeRawUnsafe(
      `DELETE FROM categories WHERE slug LIKE $1 AND id NOT IN (SELECT unnest(path) FROM categories WHERE slug LIKE $1)`,
      `${SLUG_PREFIX}%`,
    );
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, `${SLUG_PREFIX}%`);
    // Audit rows are deliberately *not* cleaned up: `audit_logs` is append-only
    // and a trigger rejects DELETE (SDD 18.4). `actor_id` carries no foreign
    // key precisely so the log outlives the account it names.
    await db.mfaSecret.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.user.deleteMany({ where: { id: { in: seededUserIds } } });
    await db.$disconnect();
    await container.dispose();
  });

  describe('authentication and authorization', () => {
    it('refuses an unauthenticated caller', async () => {
      await request(app).get('/api/v1/admin/categories').expect(401);
    });

    it('refuses a customer', async () => {
      const response = await request(app)
        .get('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${await asCustomer()}`)
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    // VENDOR_OWNER is deliberately absent: `User.registerAdmin` refuses a
    // non-admin role, and the customer case above already covers a principal
    // from outside the admin console.
    it.each(['SUPPORT_AGENT', 'RISK_ANALYST'] as RoleName[])(
      'refuses %s entirely — the matrix grants them nothing here',
      async (role) => {
        await request(app)
          .get('/api/v1/admin/categories')
          .set('Authorization', `Bearer ${await adminFor(role)}`)
          .expect(403);
      },
    );

    it.each(['FINANCE_ADMIN', 'SUPER_ADMIN'] as RoleName[])('lets %s write', async (role) => {
      // SDD 8.2 grants `MANAGE_CATEGORIES_OR_COMMISSION` FULL to FINANCE_ADMIN
      // and SUPER_ADMIN — counter-intuitive, and reproduced faithfully.
      await createCategory(await adminFor(role)).expect(201);
    });

    it('lets CATALOGUE_MODERATOR read', async () => {
      await request(app)
        .get('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${await adminFor('CATALOGUE_MODERATOR')}`)
        .expect(200);
    });

    it.each([
      ['post', '/api/v1/admin/categories'],
      ['patch', '/api/v1/admin/categories/:id'],
      ['delete', '/api/v1/admin/categories/:id'],
      ['post', '/api/v1/admin/categories/:id/parent'],
    ] as ['post' | 'patch' | 'delete', string][])(
      'refuses CATALOGUE_MODERATOR on %s %s — READ_ONLY is not FULL',
      async (method, template) => {
        const token = await adminFor('CATALOGUE_MODERATOR');
        const existing = await seed();
        const path = template.replace(':id', existing.id);

        const response = await request(app)
          [method](path)
          .set('Authorization', `Bearer ${token}`)
          .send(method === 'delete' ? undefined : { parentId: null })
          .expect(403);

        expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
      },
    );
  });

  describe('create', () => {
    it('creates a root and returns it with depth 1 and no ancestors', async () => {
      const created = await seed();

      expect(created.parentId).toBeNull();
      expect(created.depth).toBe(1);
      expect(created.path).toEqual([]);
      expect(created.isActive).toBe(true);
      expect(created.riskLevel).toBe('LOW');
    });

    it('creates a child carrying its parent in the path', async () => {
      const root = await seed();
      const child = await seed(root.id);

      expect(child.parentId).toBe(root.id);
      expect(child.path).toEqual([root.id]);
      expect(child.depth).toBe(2);
    });

    it('accepts an explicit risk level and requirement flags', async () => {
      const token = await adminFor('SUPER_ADMIN');
      const response = await createCategory(token, {
        riskLevel: 'RESTRICTED',
        requirements: {
          requiresHsn: true,
          requiresCountryOfOrigin: true,
          requiresNetQuantity: false,
        },
      }).expect(201);

      const { data } = response.body as CategoryBody;
      expect(data.riskLevel).toBe('RESTRICTED');
      expect(data.requirements).toEqual({
        requiresHsn: true,
        requiresCountryOfOrigin: true,
        requiresNetQuantity: false,
      });
    });

    it('returns 404 for a parent that does not exist', async () => {
      const token = await adminFor('SUPER_ADMIN');
      const response = await createCategory(token, { parentId: ids.generate() }).expect(404);

      expect((response.body as ErrorBody).error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('returns 409 for a duplicate slug', async () => {
      const token = await adminFor('SUPER_ADMIN');
      const existing = await seed();
      const response = await createCategory(token, { slug: existing.slug }).expect(409);

      expect((response.body as ErrorBody).error.code).toBe('CATEGORY_SLUG_CONFLICT');
    });

    it('returns 409 for a sibling name collision', async () => {
      const token = await adminFor('SUPER_ADMIN');
      const existing = await seed();
      const response = await createCategory(token, { name: existing.name }).expect(409);

      expect((response.body as ErrorBody).error.code).toBe('CATEGORY_NAME_CONFLICT');
    });

    it('returns 422 when nesting would exceed five levels', async () => {
      let parentId: string | null = null;
      for (let level = 0; level < 5; level += 1) {
        parentId = (await seed(parentId)).id;
      }

      const response = await createCategory(await adminFor('SUPER_ADMIN'), { parentId }).expect(
        422,
      );

      expect((response.body as ErrorBody).error.code).toBe('INVALID_CATEGORY_OPERATION');
    });

    it.each([
      ['a malformed slug', { slug: 'Not A Slug' }],
      ['an unknown risk level', { riskLevel: 'CRITICAL' }],
      ['a non-uuid parent', { parentId: 'not-a-uuid' }],
      ['an unexpected field', { colour: 'blue' }],
      ['a partial requirements object', { requirements: { requiresHsn: true } }],
    ])('returns 400 for %s', async (_label, overrides) => {
      await createCategory(await adminFor('SUPER_ADMIN'), overrides).expect(400);
    });
  });

  describe('read', () => {
    it('returns one category by id', async () => {
      const created = await seed();
      const response = await request(app)
        .get(`/api/v1/admin/categories/${created.id}`)
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(200);

      expect((response.body as CategoryBody).data.id).toBe(created.id);
    });

    it('returns 404 for an unknown id', async () => {
      const response = await request(app)
        .get(`/api/v1/admin/categories/${ids.generate()}`)
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(404);

      expect((response.body as ErrorBody).error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('pages the list on the platform’s cursor envelope', async () => {
      await seed();
      const response = await request(app)
        .get('/api/v1/admin/categories?limit=1')
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(200);

      const body = response.body as CategoryListBody;
      expect(body.data).toHaveLength(1);
      expect(body.meta.pagination).toHaveProperty('hasMore');
      expect(body.meta.pagination).toHaveProperty('nextCursor');
    });

    it('never exposes deletedAt', async () => {
      const created = await seed();
      const response = await request(app)
        .get(`/api/v1/admin/categories/${created.id}`)
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain('deletedAt');
    });
  });

  describe('update', () => {
    it('renames without disturbing placement', async () => {
      const root = await seed();
      const child = await seed(root.id);

      const response = await patch(await adminFor('SUPER_ADMIN'), child.id, {
        name: `${child.name}-renamed`,
      }).expect(200);

      const { data } = response.body as CategoryBody;
      expect(data.name).toBe(`${child.name}-renamed`);
      expect(data.parentId).toBe(root.id);
      expect(data.slug).toBe(child.slug);
    });

    it('changes risk level and requirements', async () => {
      const created = await seed();

      const response = await patch(await adminFor('SUPER_ADMIN'), created.id, {
        riskLevel: 'MEDIUM',
        requirements: {
          requiresHsn: true,
          requiresCountryOfOrigin: false,
          requiresNetQuantity: true,
        },
      }).expect(200);

      const { data } = response.body as CategoryBody;
      expect(data.riskLevel).toBe('MEDIUM');
      expect(data.requirements.requiresNetQuantity).toBe(true);
    });

    it('deactivates without deleting', async () => {
      const created = await seed();

      const response = await patch(await adminFor('SUPER_ADMIN'), created.id, {
        isActive: false,
      }).expect(200);

      expect((response.body as CategoryBody).data.isActive).toBe(false);
    });

    it('refuses a slug change outright', async () => {
      const created = await seed();

      // A slug that can change is not a stable public URL; `.strict()` turns
      // the attempt into a 400 rather than a silent no-op.
      await patch(await adminFor('SUPER_ADMIN'), created.id, { slug: uniqueSlug() }).expect(400);
    });

    it('refuses a parentId in the body — moving is its own action', async () => {
      const created = await seed();

      await patch(await adminFor('SUPER_ADMIN'), created.id, { parentId: null }).expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      await patch(await adminFor('SUPER_ADMIN'), ids.generate(), { name: 'x' }).expect(404);
    });
  });

  describe('reparent', () => {
    const move = (token: string, id: string, parentId: string | null): request.Test =>
      request(app)
        .post(`/api/v1/admin/categories/${id}/parent`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parentId });

    it('moves a subtree and rewrites its descendants', async () => {
      const rootA = await seed();
      const mid = await seed(rootA.id);
      const leaf = await seed(mid.id);
      const rootB = await seed();

      await move(await adminFor('SUPER_ADMIN'), mid.id, rootB.id).expect(200);

      const moved = await db.category.findUniqueOrThrow({ where: { id: leaf.id } });
      expect(moved.path).toEqual([rootB.id, mid.id]);
      expect(moved.depth).toBe(3);
    });

    it('moves a category to the root', async () => {
      const root = await seed();
      const child = await seed(root.id);

      const response = await move(await adminFor('SUPER_ADMIN'), child.id, null).expect(200);

      const { data } = response.body as CategoryBody;
      expect(data.parentId).toBeNull();
      expect(data.depth).toBe(1);
    });

    it('returns 422 for a move beneath its own descendant', async () => {
      const root = await seed();
      const child = await seed(root.id);

      const response = await move(await adminFor('SUPER_ADMIN'), root.id, child.id).expect(422);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_CATEGORY_OPERATION');
    });

    it('returns 422 when the move would push a descendant past five levels', async () => {
      const branchRoot = await seed();
      const branchMid = await seed(branchRoot.id);
      await seed(branchMid.id);

      let deepId: string | null = null;
      for (let level = 0; level < 4; level += 1) {
        deepId = (await seed(deepId)).id;
      }

      await move(await adminFor('SUPER_ADMIN'), branchRoot.id, deepId).expect(422);
    });

    it('returns 404 for an unknown new parent, and moves nothing', async () => {
      const root = await seed();
      const child = await seed(root.id);

      await move(await adminFor('SUPER_ADMIN'), child.id, ids.generate()).expect(404);

      const unmoved = await db.category.findUniqueOrThrow({ where: { id: child.id } });
      expect(unmoved.parentId).toBe(root.id);
    });
  });

  describe('delete', () => {
    it('soft-deletes a childless category and hides it from reads', async () => {
      const created = await seed();

      await remove(await adminFor('SUPER_ADMIN'), created.id).expect(200);

      await request(app)
        .get(`/api/v1/admin/categories/${created.id}`)
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(404);

      const row = await db.category.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.deletedAt).not.toBeNull();
    });

    it('returns 409 for a category with children, and deletes nothing', async () => {
      const root = await seed();
      await seed(root.id);

      const response = await remove(await adminFor('SUPER_ADMIN'), root.id).expect(409);

      expect((response.body as ErrorBody).error.code).toBe('CATEGORY_NOT_EMPTY');
      const row = await db.category.findUniqueOrThrow({ where: { id: root.id } });
      expect(row.deletedAt).toBeNull();
    });

    it('never cascades into the subtree', async () => {
      const root = await seed();
      const child = await seed(root.id);

      await remove(await adminFor('SUPER_ADMIN'), root.id).expect(409);

      const row = await db.category.findUniqueOrThrow({ where: { id: child.id } });
      expect(row.deletedAt).toBeNull();
    });

    it('returns 404 for an unknown id', async () => {
      await remove(await adminFor('SUPER_ADMIN'), ids.generate()).expect(404);
    });
  });

  describe('audit (SDD 18.4)', () => {
    const entriesFor = async (categoryId: string): Promise<{ action: string }[]> =>
      db.auditLog.findMany({
        where: { entityId: categoryId, entityType: 'Category' },
        select: { action: true },
        orderBy: { createdAt: 'asc' },
      });

    it('records a create with the acting admin', async () => {
      const created = await seed();
      const rows = await db.auditLog.findMany({
        where: { entityId: created.id, entityType: 'Category' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.CATEGORY_CREATED);
      expect(rows[0]?.actorId).not.toBeNull();
    });

    it('records a rename and a settings change as distinct actions', async () => {
      const created = await seed();
      await request(app)
        .patch(`/api/v1/admin/categories/${created.id}`)
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .send({ name: `${created.name}-x`, riskLevel: 'MEDIUM' })
        .expect(200);

      expect((await entriesFor(created.id)).map((row) => row.action)).toEqual([
        CATALOGUE_AUDIT_ACTIONS.CATEGORY_CREATED,
        CATALOGUE_AUDIT_ACTIONS.CATEGORY_RENAMED,
        CATALOGUE_AUDIT_ACTIONS.CATEGORY_SETTINGS_UPDATED,
      ]);
    });

    it('records a delete', async () => {
      const created = await seed();
      await request(app)
        .delete(`/api/v1/admin/categories/${created.id}`)
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(200);

      expect((await entriesFor(created.id)).map((row) => row.action)).toContain(
        CATALOGUE_AUDIT_ACTIONS.CATEGORY_DELETED,
      );
    });

    it('records nothing for a refused delete', async () => {
      const root = await seed();
      await seed(root.id);

      await request(app)
        .delete(`/api/v1/admin/categories/${root.id}`)
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(409);

      expect((await entriesFor(root.id)).map((row) => row.action)).toEqual([
        CATALOGUE_AUDIT_ACTIONS.CATEGORY_CREATED,
      ]);
    });

    it('records nothing for a read', async () => {
      const created = await seed();
      await request(app)
        .get(`/api/v1/admin/categories/${created.id}`)
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(200);
      await request(app)
        .get('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(200);

      // SDD 18.4 logs admin *actions*; reading a taxonomy changes nothing.
      expect(await entriesFor(created.id)).toHaveLength(1);
    });
  });

  describe('attributes (S2-2b)', () => {
    const attributesPath = (categoryId: string): string =>
      `/api/v1/admin/categories/${categoryId}/attributes`;

    // Synchronous builders: supertest's `Test` is thenable, so an `async`
    // builder would fire the request the moment it was awaited.
    const addAttribute = (
      token: string,
      categoryId: string,
      overrides: Record<string, unknown> = {},
    ): request.Test =>
      request(app)
        .post(attributesPath(categoryId))
        .set('Authorization', `Bearer ${token}`)
        .send({
          key: `key_${(counter += 1)}`,
          label: 'Label',
          dataType: 'STRING',
          position: 0,
          ...overrides,
        });

    const seedAttribute = async (
      categoryId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<AttributeBody['data']> => {
      const token = await adminFor('SUPER_ADMIN');
      const response = await addAttribute(token, categoryId, overrides).expect(201);
      return (response.body as AttributeBody).data;
    };

    describe('create', () => {
      it('defines a STRING attribute with no unit and no options', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id);

        expect(attribute.categoryId).toBe(category.id);
        expect(attribute.dataType).toBe('STRING');
        expect(attribute.unit).toBeNull();
        expect(attribute.options).toEqual([]);
      });

      it('defines a NUMBER attribute with a unit', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id, { dataType: 'NUMBER', unit: 'kg' });

        expect(attribute.unit).toBe('kg');
      });

      it('defines an ENUM attribute with options', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id, {
          dataType: 'ENUM',
          options: ['small', 'large'],
        });

        expect(attribute.options).toEqual(['small', 'large']);
      });

      it('allows configuring an inactive category', async () => {
        const category = await seed();
        await patch(await adminFor('SUPER_ADMIN'), category.id, { isActive: false }).expect(200);

        await addAttribute(await adminFor('SUPER_ADMIN'), category.id).expect(201);
      });

      it('returns 404 for an unknown category', async () => {
        const response = await addAttribute(await adminFor('SUPER_ADMIN'), ids.generate()).expect(
          404,
        );

        expect((response.body as ErrorBody).error.code).toBe('CATEGORY_NOT_FOUND');
      });

      it('returns 404 for a soft-deleted category', async () => {
        const category = await seed();
        await remove(await adminFor('SUPER_ADMIN'), category.id).expect(200);

        await addAttribute(await adminFor('SUPER_ADMIN'), category.id).expect(404);
      });

      it('returns 409 for a duplicate key in the same category', async () => {
        const category = await seed();
        const first = await seedAttribute(category.id);

        const response = await addAttribute(await adminFor('SUPER_ADMIN'), category.id, {
          key: first.key,
        }).expect(409);

        expect((response.body as ErrorBody).error.code).toBe('CATEGORY_ATTRIBUTE_KEY_CONFLICT');
      });

      it('allows the same key under a different category', async () => {
        const a = await seed();
        const b = await seed();
        const first = await seedAttribute(a.id);

        await addAttribute(await adminFor('SUPER_ADMIN'), b.id, { key: first.key }).expect(201);
      });

      it.each([
        ['a unit on a STRING', { dataType: 'STRING', unit: 'kg' }],
        ['a unit on a BOOLEAN', { dataType: 'BOOLEAN', unit: 'kg' }],
        ['a unit on an ENUM', { dataType: 'ENUM', options: ['a'], unit: 'kg' }],
        ['options on a STRING', { dataType: 'STRING', options: ['a'] }],
        ['options on a NUMBER', { dataType: 'NUMBER', options: ['a'] }],
        ['an ENUM with no options', { dataType: 'ENUM' }],
        ['an ENUM with an empty options list', { dataType: 'ENUM', options: [] }],
        ['an unknown data type', { dataType: 'DATE' }],
        ['a malformed key', { key: 'Not A Key' }],
        ['a negative position', { position: -1 }],
        ['an unexpected field', { colour: 'blue' }],
      ])('returns 400 for %s', async (_label, overrides) => {
        // Every one of these is refused by the discriminated union at the
        // boundary, before the domain or the database is reached.
        const category = await seed();

        await addAttribute(await adminFor('SUPER_ADMIN'), category.id, overrides).expect(400);
      });
    });

    describe('read', () => {
      it('lists a category’s attributes ordered by position then key', async () => {
        const category = await seed();
        await seedAttribute(category.id, { key: 'zebra', position: 1 });
        await seedAttribute(category.id, { key: 'apple', position: 1 });
        await seedAttribute(category.id, { key: 'first', position: 0 });

        const response = await request(app)
          .get(attributesPath(category.id))
          .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
          .expect(200);

        const body = response.body as AttributeListBody;
        expect(body.data.map((a) => a.key)).toEqual(['first', 'apple', 'zebra']);
        // Deliberately not paginated — the list is small and only useful whole.
        expect(body.meta).not.toHaveProperty('pagination');
      });

      it('returns 404 listing an unknown category rather than an empty array', async () => {
        await request(app)
          .get(attributesPath(ids.generate()))
          .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
          .expect(404);
      });

      it('reads one attribute by id', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id);

        const response = await request(app)
          .get(`${attributesPath(category.id)}/${attribute.id}`)
          .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
          .expect(200);

        expect((response.body as AttributeBody).data.id).toBe(attribute.id);
      });

      it('returns 404 for an attribute belonging to another category', async () => {
        const owner = await seed();
        const other = await seed();
        const attribute = await seedAttribute(owner.id);

        const response = await request(app)
          .get(`${attributesPath(other.id)}/${attribute.id}`)
          .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
          .expect(404);

        expect((response.body as ErrorBody).error.code).toBe('CATEGORY_ATTRIBUTE_NOT_FOUND');
      });

      it('never exposes deletedAt', async () => {
        const category = await seed();
        await seedAttribute(category.id);

        const response = await request(app)
          .get(attributesPath(category.id))
          .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
          .expect(200);

        expect(JSON.stringify(response.body)).not.toContain('deletedAt');
      });
    });

    describe('update', () => {
      const patchAttribute = (
        token: string,
        categoryId: string,
        attributeId: string,
        body: Record<string, unknown>,
      ): request.Test =>
        request(app)
          .patch(`${attributesPath(categoryId)}/${attributeId}`)
          .set('Authorization', `Bearer ${token}`)
          .send(body);

      it('relabels, requires and repositions', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id);

        const response = await patchAttribute(
          await adminFor('SUPER_ADMIN'),
          category.id,
          attribute.id,
          { label: 'Renamed', isRequired: true, position: 4 },
        ).expect(200);

        const { data } = response.body as AttributeBody;
        expect(data.label).toBe('Renamed');
        expect(data.isRequired).toBe(true);
        expect(data.position).toBe(4);
        expect(data.key).toBe(attribute.key);
      });

      it('edits an ENUM’s options and can clear a NUMBER’s unit', async () => {
        const category = await seed();
        const enumAttr = await seedAttribute(category.id, { dataType: 'ENUM', options: ['a'] });
        const numberAttr = await seedAttribute(category.id, { dataType: 'NUMBER', unit: 'kg' });
        const token = await adminFor('SUPER_ADMIN');

        const edited = await patchAttribute(token, category.id, enumAttr.id, {
          options: ['a', 'b'],
        }).expect(200);
        expect((edited.body as AttributeBody).data.options).toEqual(['a', 'b']);

        const cleared = await patchAttribute(token, category.id, numberAttr.id, {
          unit: null,
        }).expect(200);
        expect((cleared.body as AttributeBody).data.unit).toBeNull();
      });

      it.each([
        ['key', { key: 'other_key' }],
        ['dataType', { dataType: 'NUMBER' }],
        ['categoryId', { categoryId: 'x' }],
      ])('returns 400 when the body carries %s', async (_label, body) => {
        const category = await seed();
        const attribute = await seedAttribute(category.id);

        await patchAttribute(await adminFor('SUPER_ADMIN'), category.id, attribute.id, body).expect(
          400,
        );
      });

      it('returns 422 for a unit on a stored non-NUMBER', async () => {
        // The schema cannot catch this — `dataType` is immutable and so is not
        // on the wire. The aggregate checks it against the stored type.
        const category = await seed();
        const attribute = await seedAttribute(category.id, { dataType: 'STRING' });

        const response = await patchAttribute(
          await adminFor('SUPER_ADMIN'),
          category.id,
          attribute.id,
          { unit: 'kg' },
        ).expect(422);

        expect((response.body as ErrorBody).error.code).toBe(
          'INVALID_CATEGORY_ATTRIBUTE_OPERATION',
        );
      });

      it('returns 422 for options on a stored non-ENUM, and for emptying an ENUM', async () => {
        const category = await seed();
        const stringAttr = await seedAttribute(category.id, { dataType: 'STRING' });
        const enumAttr = await seedAttribute(category.id, { dataType: 'ENUM', options: ['a'] });
        const token = await adminFor('SUPER_ADMIN');

        await patchAttribute(token, category.id, stringAttr.id, { options: ['a'] }).expect(422);
        await patchAttribute(token, category.id, enumAttr.id, { options: [] }).expect(422);
      });

      it('returns 404 for an unknown attribute', async () => {
        const category = await seed();

        await patchAttribute(await adminFor('SUPER_ADMIN'), category.id, ids.generate(), {
          label: 'x',
        }).expect(404);
      });
    });

    describe('delete', () => {
      const removeAttribute = (
        token: string,
        categoryId: string,
        attributeId: string,
      ): request.Test =>
        request(app)
          .delete(`${attributesPath(categoryId)}/${attributeId}`)
          .set('Authorization', `Bearer ${token}`);

      it('soft-deletes and hides it from every read', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id);
        const token = await adminFor('SUPER_ADMIN');

        await removeAttribute(token, category.id, attribute.id).expect(200);

        await request(app)
          .get(`${attributesPath(category.id)}/${attribute.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(404);
        const row = await db.categoryAttribute.findUniqueOrThrow({ where: { id: attribute.id } });
        expect(row.deletedAt).not.toBeNull();
      });

      it('frees the key for reuse', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id);
        const token = await adminFor('SUPER_ADMIN');

        await removeAttribute(token, category.id, attribute.id).expect(200);

        await addAttribute(token, category.id, { key: attribute.key }).expect(201);
      });

      it('returns 404 for an attribute belonging to another category', async () => {
        const owner = await seed();
        const other = await seed();
        const attribute = await seedAttribute(owner.id);

        await removeAttribute(await adminFor('SUPER_ADMIN'), other.id, attribute.id).expect(404);

        const row = await db.categoryAttribute.findUniqueOrThrow({ where: { id: attribute.id } });
        expect(row.deletedAt).toBeNull();
      });
    });

    describe('category deletion cascade', () => {
      it('takes the category’s attributes with it, in the same transaction', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id);

        await remove(await adminFor('SUPER_ADMIN'), category.id).expect(200);

        const row = await db.categoryAttribute.findUniqueOrThrow({ where: { id: attribute.id } });
        expect(row.deletedAt).not.toBeNull();
      });

      it('leaves attributes untouched when the delete is refused for children', async () => {
        const root = await seed();
        const attribute = await seedAttribute(root.id);
        await seed(root.id);

        await remove(await adminFor('SUPER_ADMIN'), root.id).expect(409);

        const row = await db.categoryAttribute.findUniqueOrThrow({ where: { id: attribute.id } });
        expect(row.deletedAt).toBeNull();
      });

      it('records how many attribute definitions went with it', async () => {
        const category = await seed();
        await seedAttribute(category.id);
        await seedAttribute(category.id);

        await remove(await adminFor('SUPER_ADMIN'), category.id).expect(200);

        const row = await db.auditLog.findFirstOrThrow({
          where: { entityId: category.id, action: CATALOGUE_AUDIT_ACTIONS.CATEGORY_DELETED },
        });
        expect(row.before).toMatchObject({ attributesRemoved: 2 });
      });
    });

    describe('authorization', () => {
      it('refuses an unauthenticated caller', async () => {
        const category = await seed();

        await request(app).get(attributesPath(category.id)).expect(401);
      });

      it('lets CATALOGUE_MODERATOR read', async () => {
        const category = await seed();

        await request(app)
          .get(attributesPath(category.id))
          .set('Authorization', `Bearer ${await adminFor('CATALOGUE_MODERATOR')}`)
          .expect(200);
      });

      it('refuses CATALOGUE_MODERATOR on every write — READ_ONLY is not FULL', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id);
        const token = await adminFor('CATALOGUE_MODERATOR');
        const detail = `${attributesPath(category.id)}/${attribute.id}`;

        await addAttribute(token, category.id).expect(403);
        await request(app)
          .patch(detail)
          .set('Authorization', `Bearer ${token}`)
          .send({ label: 'x' })
          .expect(403);
        await request(app).delete(detail).set('Authorization', `Bearer ${token}`).expect(403);
      });

      it.each(['SUPPORT_AGENT', 'RISK_ANALYST'] as RoleName[])('refuses %s', async (role) => {
        const category = await seed();

        await request(app)
          .get(attributesPath(category.id))
          .set('Authorization', `Bearer ${await adminFor(role)}`)
          .expect(403);
      });

      it('refuses a customer', async () => {
        const category = await seed();

        await request(app)
          .get(attributesPath(category.id))
          .set('Authorization', `Bearer ${await asCustomer()}`)
          .expect(403);
      });

      it('lets FINANCE_ADMIN write', async () => {
        const category = await seed();

        await addAttribute(await adminFor('FINANCE_ADMIN'), category.id).expect(201);
      });
    });

    describe('audit', () => {
      const attributeActions = async (categoryId: string): Promise<string[]> =>
        (
          await db.auditLog.findMany({
            where: { entityId: categoryId, entityType: 'Category' },
            select: { action: true },
            orderBy: { createdAt: 'asc' },
          })
        ).map((row) => row.action);

      it('records add, update and remove against the owning category', async () => {
        const category = await seed();
        const attribute = await seedAttribute(category.id);
        const token = await adminFor('SUPER_ADMIN');

        await request(app)
          .patch(`${attributesPath(category.id)}/${attribute.id}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ label: 'Renamed' })
          .expect(200);
        await request(app)
          .delete(`${attributesPath(category.id)}/${attribute.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(await attributeActions(category.id)).toEqual([
          CATALOGUE_AUDIT_ACTIONS.CATEGORY_CREATED,
          CATALOGUE_AUDIT_ACTIONS.CATEGORY_ATTRIBUTE_ADDED,
          CATALOGUE_AUDIT_ACTIONS.CATEGORY_ATTRIBUTE_UPDATED,
          CATALOGUE_AUDIT_ACTIONS.CATEGORY_ATTRIBUTE_REMOVED,
        ]);
      });

      it('records nothing for a read or a refused write', async () => {
        const category = await seed();
        const before = await attributeActions(category.id);

        await request(app)
          .get(attributesPath(category.id))
          .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
          .expect(200);
        await addAttribute(await adminFor('CATALOGUE_MODERATOR'), category.id).expect(403);

        expect(await attributeActions(category.id)).toEqual(before);
      });
    });
  });
});
