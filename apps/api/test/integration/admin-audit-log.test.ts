import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { OTP } from 'otplib';
import { FixedClock, UuidV7Generator, toUuid } from '@leen-mart/domain-kit';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';
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
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/persistence/prisma-audit-log.repository.js';
import {
  AuditLogEntry,
  type AuditLogActor,
  type AuditLogRequestContext,
} from '../../src/modules/audit/domain/entities/audit-log-entry.entity.js';
import { toAuditLogEntryId } from '../../src/modules/audit/domain/value-objects/audit-log-entry-id.value-object.js';
import { signUpCustomer, signUpVendorOwner } from '../support/actors.js';

const EMAIL_PREFIX = 'admin-audit-log-';
const ADMIN_PASSWORD = 'admin-password-that-is-long-enough';

interface ErrorBody {
  readonly error: { code: string };
}
interface ChallengeBody {
  readonly data: { mfaChallengeToken: string };
}
interface AuthBody {
  readonly data: { accessToken: string };
}
interface AuditLogEntryBody {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorRole: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly createdAt: string;
}
interface AuditLogListBody {
  readonly data: readonly AuditLogEntryBody[];
  readonly meta: {
    readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

/** SEC verification (Phase L.3): the full response body must never carry any of these shapes, regardless of what any current fixture happens to contain. */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /password/i,
  /passwordHash/i,
  /password_hash/i,
  /mfaSecret/i,
  /mfa_secret/i,
  /refreshToken/i,
  /refresh_token/i,
  /accessToken/i,
  /access_token/i,
  /\btoken\b/i,
  /wrappedDataKey/i,
  /wrapped_data_key/i,
  /presigned/i,
];

const assertNoSensitiveFields = (body: unknown): void => {
  const serialized = JSON.stringify(body);
  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(serialized).not.toMatch(pattern);
  }
};

/**
 * The `VIEW_AUDIT_LOG`-gated read surface (Phase L.3), end to end. Real
 * admin two-step authentication, real PostgreSQL — the same conventions
 * `admin-user-management.test.ts` already establishes for this class of
 * surface. Audit rows are written directly through `PrismaAuditLogRepository`
 * rather than through any HTTP flow: no use case in this codebase writes
 * audit entries from an HTTP request yet (only the identity module's own
 * internal `AuditWriter` calls do), so seeding here mirrors
 * `prisma-audit-log.repository.test.ts`'s own approach.
 */
describe('admin audit log endpoints', () => {
  let container: Container;
  let app: Express;
  let db: PrismaClient;
  let auditLogRepository: PrismaAuditLogRepository;

  const ids = new UuidV7Generator();
  const run = Date.now();
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

  let customerToken: string | undefined;
  const asCustomer = async (): Promise<string> => {
    if (customerToken) return customerToken;
    const actor = await signUpCustomer(app, EMAIL_PREFIX, 'customer');
    seededUserIds.push(actor.userId);
    customerToken = actor.token;
    return customerToken;
  };

  let vendorToken: string | undefined;
  const asVendorOwner = async (): Promise<string> => {
    if (vendorToken) return vendorToken;
    const actor = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor');
    seededUserIds.push(actor.userId);
    vendorToken = actor.token;
    return vendorToken;
  };

  const listAuditLogs = (token: string, query = ''): request.Test =>
    request(app).get(`/api/v1/admin/audit-logs${query}`).set('Authorization', `Bearer ${token}`);

  /**
   * Seeds one entry directly, bypassing HTTP — this suite tests the read
   * surface, not any writer. Dated far in the future (`2099-*`, offset by
   * `run`) so ordering/pagination assertions never depend on what earlier
   * runs or other suites already left in this append-only table.
   */
  const FAR_FUTURE_MS = new Date('2099-06-01T00:00:00.000Z').getTime() + run;
  const at = (offsetSeconds: number): Date => new Date(FAR_FUTURE_MS + offsetSeconds * 1000);
  const seedEntry = async (
    overrides: Partial<Parameters<typeof AuditLogEntry.record>[0]> = {},
  ): Promise<AuditLogEntry> => {
    const actor: AuditLogActor = {
      actorId: toUserId(ids.generate()),
      actorRole: 'SUPER_ADMIN',
      impersonatedBy: null,
    };
    const context: AuditLogRequestContext = {
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (integration test)',
      requestId: `req-${run}`,
    };
    const entry = AuditLogEntry.record({
      id: toAuditLogEntryId(ids.generate()),
      actor,
      action: `AUDIT_HTTP_TEST-${run}`,
      entityType: `AuditHttpTest-${run}`,
      entityId: toUuid(ids.generate()),
      before: { status: 'BEFORE' },
      after: { status: 'AFTER' },
      reason: 'integration test fixture',
      context,
      now: at(0),
      ...overrides,
    });
    await auditLogRepository.append(entry);
    return entry;
  };

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
    auditLogRepository = new PrismaAuditLogRepository(db);
  });

  afterAll(async () => {
    // Audit rows are deliberately *not* cleaned up: `audit_logs` is
    // append-only and a trigger rejects DELETE (SDD 18.4).
    await db.mfaSecret.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.user.deleteMany({ where: { id: { in: seededUserIds } } });
    await db.$disconnect();
    await container.dispose();
  });

  describe('authentication and authorization', () => {
    it('refuses an unauthenticated caller', async () => {
      await request(app).get('/api/v1/admin/audit-logs').expect(401);
    });

    it('refuses a customer', async () => {
      const response = await listAuditLogs(await asCustomer()).expect(403);
      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('refuses a vendor owner', async () => {
      const response = await listAuditLogs(await asVendorOwner()).expect(403);
      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it.each(['SUPPORT_AGENT', 'CATALOGUE_MODERATOR'] as RoleName[])(
      'refuses %s — VIEW_AUDIT_LOG grants them NONE',
      async (role) => {
        const response = await listAuditLogs(await adminFor(role)).expect(403);
        expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
      },
    );

    it.each(['FINANCE_ADMIN', 'RISK_ANALYST', 'SUPER_ADMIN'] as RoleName[])(
      'lets %s read — VIEW_AUDIT_LOG grants them READ_ONLY or FULL, and this route requires no more than READ_ONLY',
      async (role) => {
        await listAuditLogs(await adminFor(role)).expect(200);
      },
    );
  });

  describe('reads', () => {
    it('never exposes a password, hash, MFA secret, or token — the full response body, not just the current fixture shape', async () => {
      await seedEntry({ action: `AUDIT_SEC_CHECK-${run}` });

      const response = await listAuditLogs(
        await adminFor('SUPER_ADMIN'),
        `?limit=50&action=${encodeURIComponent(`AUDIT_SEC_CHECK-${run}`)}`,
      ).expect(200);

      assertNoSensitiveFields(response.body);
    });

    it('returns entries newest first', async () => {
      const scope = `AuditHttpOrder-${run}`;
      await seedEntry({ entityType: scope, action: 'HTTP_ORDER_OLDEST', now: at(10) });
      await seedEntry({ entityType: scope, action: 'HTTP_ORDER_NEWEST', now: at(11) });

      const response = await listAuditLogs(
        await adminFor('SUPER_ADMIN'),
        `?limit=10&entityType=${encodeURIComponent(scope)}`,
      ).expect(200);

      const actions = (response.body as AuditLogListBody).data.map((entry) => entry.action);
      expect(actions).toEqual(['HTTP_ORDER_NEWEST', 'HTTP_ORDER_OLDEST']);
    });

    it('filters by actorId', async () => {
      const filterActorId = toUserId(ids.generate());
      await seedEntry({
        actor: { actorId: filterActorId, actorRole: 'RISK_ANALYST', impersonatedBy: null },
        action: `HTTP_ACTOR_MATCH-${run}`,
        now: at(20),
      });

      const response = await listAuditLogs(
        await adminFor('SUPER_ADMIN'),
        `?limit=10&actorId=${filterActorId}`,
      ).expect(200);

      const body = response.body as AuditLogListBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.action).toBe(`HTTP_ACTOR_MATCH-${run}`);
    });

    it('filters by entityType', async () => {
      const scope = `AuditHttpEntityType-${run}`;
      await seedEntry({ entityType: scope, action: 'HTTP_ETYPE_MATCH', now: at(30) });
      await seedEntry({ entityType: `${scope}-other`, action: 'HTTP_ETYPE_OTHER', now: at(31) });

      const response = await listAuditLogs(
        await adminFor('SUPER_ADMIN'),
        `?limit=10&entityType=${encodeURIComponent(scope)}`,
      ).expect(200);

      const actions = (response.body as AuditLogListBody).data.map((entry) => entry.action);
      expect(actions).toEqual(['HTTP_ETYPE_MATCH']);
    });

    it('filters by entityId', async () => {
      const filterEntityId = toUuid(ids.generate());
      await seedEntry({
        entityId: filterEntityId,
        action: `HTTP_EID_MATCH-${run}`,
        now: at(40),
      });

      const response = await listAuditLogs(
        await adminFor('SUPER_ADMIN'),
        `?limit=10&entityId=${filterEntityId}`,
      ).expect(200);

      const body = response.body as AuditLogListBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.action).toBe(`HTTP_EID_MATCH-${run}`);
    });

    it('filters by action', async () => {
      const uniqueAction = `HTTP_ACTION_MATCH-${run}`;
      await seedEntry({ action: uniqueAction, now: at(50) });

      const response = await listAuditLogs(
        await adminFor('SUPER_ADMIN'),
        `?limit=10&action=${encodeURIComponent(uniqueAction)}`,
      ).expect(200);

      const body = response.body as AuditLogListBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.action).toBe(uniqueAction);
    });

    it('composes actorId and action filters together', async () => {
      const combinedActorId = toUserId(ids.generate());
      const combinedAction = `HTTP_COMBINED-${run}`;
      await seedEntry({
        actor: { actorId: combinedActorId, actorRole: 'FINANCE_ADMIN', impersonatedBy: null },
        action: combinedAction,
        now: at(60),
      });
      // Wrong actor, same action — must be excluded.
      await seedEntry({ action: combinedAction, now: at(61) });

      const response = await listAuditLogs(
        await adminFor('SUPER_ADMIN'),
        `?limit=10&actorId=${combinedActorId}&action=${encodeURIComponent(combinedAction)}`,
      ).expect(200);

      const body = response.body as AuditLogListBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.action).toBe(combinedAction);
    });

    it('paginates with a working cursor across pages', async () => {
      const scope = `AuditHttpPaging-${run}`;
      await seedEntry({ entityType: scope, action: 'HTTP_PAGE_1', now: at(70) });
      await seedEntry({ entityType: scope, action: 'HTTP_PAGE_2', now: at(71) });
      await seedEntry({ entityType: scope, action: 'HTTP_PAGE_3', now: at(72) });

      const token = await adminFor('SUPER_ADMIN');
      const first = await listAuditLogs(
        token,
        `?limit=2&entityType=${encodeURIComponent(scope)}`,
      ).expect(200);
      const firstBody = first.body as AuditLogListBody;
      expect(firstBody.data.map((entry) => entry.action)).toEqual(['HTTP_PAGE_3', 'HTTP_PAGE_2']);
      expect(firstBody.meta.pagination.hasMore).toBe(true);
      expect(firstBody.meta.pagination.nextCursor).not.toBeNull();

      const second = await listAuditLogs(
        token,
        `?limit=2&entityType=${encodeURIComponent(scope)}&cursor=${encodeURIComponent(
          firstBody.meta.pagination.nextCursor ?? '',
        )}`,
      ).expect(200);
      const secondBody = second.body as AuditLogListBody;
      expect(secondBody.data.map((entry) => entry.action)).toEqual(['HTTP_PAGE_1']);
      expect(secondBody.meta.pagination.hasMore).toBe(false);
      expect(secondBody.meta.pagination.nextCursor).toBeNull();
    });

    it('returns an empty page for a filter matching nothing', async () => {
      const response = await listAuditLogs(
        await adminFor('SUPER_ADMIN'),
        `?limit=10&entityType=${encodeURIComponent(`AuditHttpNonexistent-${run}`)}`,
      ).expect(200);

      const body = response.body as AuditLogListBody;
      expect(body.data).toEqual([]);
      expect(body.meta.pagination.hasMore).toBe(false);
      expect(body.meta.pagination.nextCursor).toBeNull();
    });

    it('returns 400 for a malformed filter', async () => {
      await listAuditLogs(await adminFor('SUPER_ADMIN'), '?actorId=not-a-uuid').expect(400);
    });
  });
});
