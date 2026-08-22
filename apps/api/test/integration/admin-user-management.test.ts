import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { OTP } from 'otplib';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';
import { IDENTITY_AUDIT_ACTIONS } from '../../src/modules/identity/domain/audit-actions.js';
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

const EMAIL_PREFIX = 'admin-user-mgmt-';
const ADMIN_PASSWORD = 'admin-password-that-is-long-enough';
const CUSTOMER_PASSWORD = 'customer-password-long-enough';
const NEW_ADMIN_PASSWORD = 'a-new-subordinate-admin-password';

interface ErrorBody {
  readonly error: { code: string };
}
interface AuthBody {
  readonly data: { accessToken: string; user: { id: string } };
}
interface ChallengeBody {
  readonly data: { mfaChallengeToken: string };
}
interface EnrollBody {
  readonly data: { secret: string; otpauthUri: string };
}
interface AdminUserBody {
  readonly data: {
    readonly id: string;
    readonly email: string;
    readonly role: string;
    readonly status: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
}
interface AdminUserListBody {
  readonly data: AdminUserBody['data'][];
  readonly meta: { pagination: { nextCursor: string | null; hasMore: boolean } };
}

/**
 * The SUPER_ADMIN-gated subordinate-admin management surface (Phase L.2),
 * end to end. Real admin two-step authentication, real PostgreSQL — the
 * same conventions `admin-category.test.ts` already establishes for this
 * class of surface.
 */
describe('admin user management endpoints', () => {
  let container: Container;
  let app: Express;
  let db: PrismaClient;

  const ids = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
  const seededUserIds: string[] = [];

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
    const now = clock.now();
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

  const createAdminUser = (token: string, overrides: Record<string, unknown> = {}): request.Test =>
    request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: uniqueEmail('subordinate'),
        password: NEW_ADMIN_PASSWORD,
        role: 'SUPPORT_AGENT',
        ...overrides,
      });

  const seed = async (overrides: Record<string, unknown> = {}): Promise<AdminUserBody['data']> => {
    const token = await adminFor('SUPER_ADMIN');
    const response = await createAdminUser(token, overrides).expect(201);
    const created = (response.body as AdminUserBody).data;
    seededUserIds.push(created.id);
    return created;
  };

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
  });

  afterAll(async () => {
    // Audit rows are deliberately *not* cleaned up: `audit_logs` is append-only
    // and a trigger rejects DELETE (SDD 18.4). `actor_id` carries no foreign
    // key precisely so the log outlives the account it names.
    await db.mfaSecret.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.user.deleteMany({ where: { id: { in: seededUserIds } } });
    await db.$disconnect();
    await container.dispose();
  });

  describe('authentication and authorization', () => {
    it('refuses an unauthenticated caller on create', async () => {
      await request(app).post('/api/v1/admin/users').send({}).expect(401);
    });

    it('refuses an unauthenticated caller on list', async () => {
      await request(app).get('/api/v1/admin/users').expect(401);
    });

    it('refuses a customer', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${await asCustomer()}`)
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it.each([
      'CATALOGUE_MODERATOR',
      'FINANCE_ADMIN',
      'RISK_ANALYST',
      'SUPPORT_AGENT',
    ] as RoleName[])(
      'refuses %s on create — MANAGE_ADMIN_USERS_OR_ROLES is FULL only for SUPER_ADMIN',
      async (role) => {
        const response = await createAdminUser(await adminFor(role)).expect(403);
        expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
      },
    );

    it.each([
      'CATALOGUE_MODERATOR',
      'FINANCE_ADMIN',
      'RISK_ANALYST',
      'SUPPORT_AGENT',
    ] as RoleName[])(
      'refuses %s on list — there is no READ_ONLY grant on this permission',
      async (role) => {
        const response = await request(app)
          .get('/api/v1/admin/users')
          .set('Authorization', `Bearer ${await adminFor(role)}`)
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
      },
    );

    it('lets SUPER_ADMIN create and list', async () => {
      const token = await adminFor('SUPER_ADMIN');
      const created = await createAdminUser(token).expect(201);
      seededUserIds.push((created.body as AdminUserBody).data.id);
      await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('create', () => {
    it.each(['CATALOGUE_MODERATOR', 'FINANCE_ADMIN', 'RISK_ANALYST', 'SUPPORT_AGENT'])(
      'creates a %s account, ACTIVE, with no field a client could use to bypass MFA',
      async (role) => {
        const created = await seed({ role });

        expect(created.role).toBe(role);
        expect(created.status).toBe('ACTIVE');
        expect(JSON.stringify(created)).not.toMatch(/mfa|secret|token/i);
      },
    );

    it('never exposes the password or its hash', async () => {
      const created = await seed();

      expect(JSON.stringify(created)).not.toContain(NEW_ADMIN_PASSWORD);
      expect(JSON.stringify(created)).not.toContain('passwordHash');
    });

    it('refuses to create a second SUPER_ADMIN — the request schema has no room for it', async () => {
      const response = await createAdminUser(await adminFor('SUPER_ADMIN'), {
        role: 'SUPER_ADMIN',
      }).expect(400);
      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it.each([
      ['an unknown role', { role: 'RISK_MANAGER' }],
      ['a malformed email', { email: 'not-an-email' }],
      ['a too-short password', { password: 'short' }],
      ['an unexpected field', { colour: 'blue' }],
      ['a missing role', { role: undefined }],
    ])('returns 400 for %s', async (_label, overrides) => {
      await createAdminUser(await adminFor('SUPER_ADMIN'), overrides).expect(400);
    });

    it('returns 409 for a duplicate email', async () => {
      const existing = await seed();

      const response = await createAdminUser(await adminFor('SUPER_ADMIN'), {
        email: existing.email,
      }).expect(409);
      expect((response.body as ErrorBody).error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('does not create a duplicate account when refused', async () => {
      const existing = await seed();
      const before = await db.user.count({ where: { email: existing.email } });

      await createAdminUser(await adminFor('SUPER_ADMIN'), { email: existing.email }).expect(409);

      expect(await db.user.count({ where: { email: existing.email } })).toBe(before);
    });
  });

  describe('list', () => {
    it('pages on the platform cursor envelope', async () => {
      await seed();
      const response = await request(app)
        .get('/api/v1/admin/users?limit=1')
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(200);

      const body = response.body as AdminUserListBody;
      expect(body.data).toHaveLength(1);
      expect(body.meta.pagination).toHaveProperty('hasMore');
      expect(body.meta.pagination).toHaveProperty('nextCursor');
    });

    it('includes the caller’s own SUPER_ADMIN account alongside subordinates', async () => {
      const token = await adminFor('SUPER_ADMIN');
      const created = await seed();

      const response = await request(app)
        .get('/api/v1/admin/users?limit=100')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const roles = (response.body as AdminUserListBody).data.map((row) => row.role);
      expect(roles).toContain('SUPER_ADMIN');
      expect((response.body as AdminUserListBody).data.some((row) => row.id === created.id)).toBe(
        true,
      );
    });

    it('never exposes password hashes or MFA state', async () => {
      await seed();
      const response = await request(app)
        .get('/api/v1/admin/users?limit=100')
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|mfaSecret/i);
    });
  });

  describe('audit (SDD 18.4)', () => {
    it('records a create with the acting SUPER_ADMIN', async () => {
      const created = await seed();

      const rows = await db.auditLog.findMany({
        where: { entityId: created.id, entityType: 'User' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe(IDENTITY_AUDIT_ACTIONS.ADMIN_USER_CREATED);
      expect(rows[0]?.actorId).not.toBeNull();
    });

    it('records nothing for a refused create', async () => {
      const existing = await seed();
      const before = await db.auditLog.count({ where: { entityType: 'User' } });

      await createAdminUser(await adminFor('SUPER_ADMIN'), { email: existing.email }).expect(409);

      expect(await db.auditLog.count({ where: { entityType: 'User' } })).toBe(before);
    });

    it('records nothing for a list', async () => {
      const before = await db.auditLog.count({ where: { entityType: 'User' } });

      await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${await adminFor('SUPER_ADMIN')}`)
        .expect(200);

      expect(await db.auditLog.count({ where: { entityType: 'User' } })).toBe(before);
    });
  });

  describe('newly created admins follow the existing MFA enrollment flow', () => {
    it('cannot sign in without enrolling first — step one itself refuses, uniformly (SEC-15)', async () => {
      const created = await seed();

      // `AdminLoginStepOneUseCase` refuses a correct email/password with the
      // identical `InvalidCredentialsError` an unenrolled admin gets — a
      // missing confirmed MFA secret is indistinguishable, from outside,
      // from any other step-one failure. No challenge token is ever issued
      // for this account until it enrolls.
      const stepOne = await request(app)
        .post('/api/v1/admin/login')
        .send({ email: created.email, password: NEW_ADMIN_PASSWORD })
        .expect(401);
      expect((stepOne.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    });

    it('enrolls through the real admin MFA surface and signs in — no field bypasses this', async () => {
      const created = await seed();

      const enroll = await request(app)
        .post('/api/v1/admin/mfa/enroll')
        .send({ email: created.email, password: NEW_ADMIN_PASSWORD })
        .expect(200);
      const { secret } = (enroll.body as EnrollBody).data;
      expect(secret).toBeTruthy();

      const confirmed = await request(app)
        .post('/api/v1/admin/mfa/enroll/confirm')
        .send({
          email: created.email,
          password: NEW_ADMIN_PASSWORD,
          totpCode: await currentTotpCode(secret),
        })
        .expect(200);

      const session = confirmed.body as AuthBody;
      expect(session.data.accessToken).toBeTruthy();
      expect(session.data.user.id).toBe(created.id);
    });
  });
});
