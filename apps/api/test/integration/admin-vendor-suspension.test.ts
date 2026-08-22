import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { OTP } from 'otplib';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import {
  signUpCustomer,
  signUpVendorOwner,
  TEST_PASSWORD,
  type VendorActor,
} from '../support/actors.js';
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

const EMAIL_PREFIX = 'admin-vendor-suspension-';
const ADMIN_PASSWORD = 'admin-password-that-is-long-enough';
const REASON = 'Repeated late fulfilment and multiple unresolved customer complaints';

interface ErrorBody {
  readonly error: { code: string };
}
interface ChallengeBody {
  readonly data: { mfaChallengeToken: string };
}
interface AuthBody {
  readonly data: { accessToken: string };
}
interface VendorStatusBody {
  readonly data: { id: string; status: string };
}
interface AuditLogRow {
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly reason: string | null;
}

/**
 * The `SUSPEND_VENDOR_OR_USER`-gated vendor suspend/reinstate surface
 * (Phase L.4), end to end. Real admin two-step authentication, real
 * PostgreSQL, real vendor self-service login — the same conventions
 * `admin-user-management.test.ts`/`admin-audit-log.test.ts` already
 * establish for this class of surface.
 *
 * This suite exists to prove one thing above all others: suspension is not
 * cosmetic. See "security regression" below.
 */
describe('admin vendor suspend/reinstate endpoints', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;

  const ids = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));

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

    const secret = new OtplibTotpService().generateSecret();
    await new PrismaMfaSecretRepository(db).create(
      MfaSecret.enroll({
        id: toMfaSecretId(ids.generate()),
        userId: admin.id,
        encryptedSecret: new AesGcmMfaSecretCipher(
          Buffer.from(harness.container.env.MFA_ENCRYPTION_KEY, 'hex'),
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
    customerToken = actor.token;
    return customerToken;
  };

  let vendorCounter = 0;
  /** A freshly registered, then directly-activated, vendor — mirrors `vendor-order.test.ts`'s own `seedActiveVendorWithStock`: the KYC walk is not what this suite tests, so it is skipped the same pragmatic way that suite skips it. */
  const activeVendor = async (label: string): Promise<VendorActor> => {
    vendorCounter += 1;
    const vendor = await signUpVendorOwner(app, EMAIL_PREFIX, `${label}-${vendorCounter}`);
    await db.vendorProfile.update({ where: { id: vendor.vendorId }, data: { status: 'ACTIVE' } });
    return vendor;
  };

  const suspend = (
    token: string,
    vendorId: string,
    body: Record<string, unknown> = { reason: REASON },
  ): request.Test =>
    request(app)
      .post(`/api/v1/admin/vendors/${vendorId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const reinstate = (
    token: string,
    vendorId: string,
    body: Record<string, unknown> = {},
  ): request.Test =>
    request(app)
      .post(`/api/v1/admin/vendors/${vendorId}/reinstate`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  /**
   * One vendor, shared by every test that never actually reaches the domain
   * transition (401/403 authorization refusals, 400 validation refusals) —
   * each of those leaves the vendor exactly ACTIVE, so nothing here races or
   * corrupts state across tests. `LOGIN_PER_IP` (20/min) caps real
   * `/identity/login` calls; `activeVendor()` costs one each via
   * `signUpVendorOwner`'s own re-login, and this suite would otherwise mint
   * roughly twice the vendors it actually needs to.
   */
  let rejectableVendor: VendorActor | undefined;
  const sharedRejectableVendor = async (): Promise<VendorActor> => {
    rejectableVendor ??= await activeVendor('shared-rejectable');
    return rejectableVendor;
  };

  beforeAll(() => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
  });

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
  });

  describe('authorization', () => {
    it('refuses an unauthenticated caller on suspend', async () => {
      const vendor = await sharedRejectableVendor();
      await request(app)
        .post(`/api/v1/admin/vendors/${vendor.vendorId}/suspend`)
        .send({ reason: REASON })
        .expect(401);
    });

    it('refuses an unauthenticated caller on reinstate', async () => {
      const vendor = await sharedRejectableVendor();
      await request(app)
        .post(`/api/v1/admin/vendors/${vendor.vendorId}/reinstate`)
        .send({})
        .expect(401);
    });

    it('refuses a customer', async () => {
      const vendor = await sharedRejectableVendor();
      const response = await suspend(await asCustomer(), vendor.vendorId).expect(403);
      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('refuses the vendor owner acting on their own vendor', async () => {
      const vendor = await sharedRejectableVendor();
      const response = await suspend(vendor.token, vendor.vendorId).expect(403);
      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it.each(['SUPPORT_AGENT', 'CATALOGUE_MODERATOR', 'FINANCE_ADMIN'] as RoleName[])(
      'refuses %s — SUSPEND_VENDOR_OR_USER grants them NONE',
      async (role) => {
        const vendor = await sharedRejectableVendor();
        const response = await suspend(await adminFor(role), vendor.vendorId).expect(403);
        expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
      },
    );

    it.each(['RISK_ANALYST', 'SUPER_ADMIN'] as RoleName[])(
      'lets %s suspend — SUSPEND_VENDOR_OR_USER is FULL for both',
      async (role) => {
        const vendor = await activeVendor(`authz-ok-${role}`);
        const response = await suspend(await adminFor(role), vendor.vendorId).expect(200);
        expect((response.body as VendorStatusBody).data.status).toBe('SUSPENDED');
      },
    );
  });

  describe('suspension', () => {
    it('suspends an ACTIVE vendor', async () => {
      const vendor = await activeVendor('suspend-basic');

      const response = await suspend(await adminFor('SUPER_ADMIN'), vendor.vendorId).expect(200);

      const body = response.body as VendorStatusBody;
      expect(body.data.id).toBe(vendor.vendorId);
      expect(body.data.status).toBe('SUSPENDED');
      const row = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendor.vendorId } });
      expect(row.status).toBe('SUSPENDED');
    });

    it('suspends the linked User, not just the vendor profile', async () => {
      const vendor = await activeVendor('suspend-user');

      await suspend(await adminFor('SUPER_ADMIN'), vendor.vendorId).expect(200);

      const user = await db.user.findUniqueOrThrow({ where: { id: vendor.userId } });
      expect(user.status).toBe('SUSPENDED');
    });

    it('rejects a missing reason', async () => {
      const vendor = await sharedRejectableVendor();

      const response = await suspend(await adminFor('SUPER_ADMIN'), vendor.vendorId, {}).expect(
        400,
      );
      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an empty-string reason', async () => {
      const vendor = await sharedRejectableVendor();

      await suspend(await adminFor('SUPER_ADMIN'), vendor.vendorId, { reason: '   ' }).expect(400);
    });

    it('records an audit entry with the actor, the vendor, and the exact reason', async () => {
      const vendor = await activeVendor('suspend-audit');
      const token = await adminFor('RISK_ANALYST');

      await suspend(token, vendor.vendorId, { reason: REASON }).expect(200);

      const entries = await db.auditLog.findMany({
        where: {
          entityType: 'VendorProfile',
          entityId: vendor.vendorId,
          action: 'vendor.suspended',
        },
      });
      expect(entries).toHaveLength(1);
      const entry = entries[0] as unknown as AuditLogRow;
      expect(entry.reason).toBe(REASON);
      expect(entry.actorId).not.toBeNull();
    });

    it('a second suspension fails as an illegal transition, and touches nothing (atomicity)', async () => {
      const vendor = await activeVendor('suspend-twice');
      const token = await adminFor('SUPER_ADMIN');
      await suspend(token, vendor.vendorId).expect(200);

      const response = await suspend(token, vendor.vendorId).expect(422);
      expect((response.body as ErrorBody).error.code).toBe('VENDOR_INVALID_STATUS_TRANSITION');

      // The failed second attempt must leave both rows exactly as the first
      // (successful) suspension left them — never re-written, never
      // half-changed.
      const vendorRow = await db.vendorProfile.findUniqueOrThrow({
        where: { id: vendor.vendorId },
      });
      const userRow = await db.user.findUniqueOrThrow({ where: { id: vendor.userId } });
      expect(vendorRow.status).toBe('SUSPENDED');
      expect(userRow.status).toBe('SUSPENDED');
    });

    describe('security regression — the point of this whole suite', () => {
      it('an already-issued access token is rejected on the very next authenticated request after suspension', async () => {
        // 1. A real vendor login, holding a real, valid access token for a
        // self-service route they legitimately have access to.
        const vendor = await activeVendor('security-regression');
        await request(app)
          .get('/api/v1/vendors/me/shop-address')
          .set('Authorization', `Bearer ${vendor.token}`)
          .expect(200);

        // 2. An admin suspends them.
        await suspend(await adminFor('SUPER_ADMIN'), vendor.vendorId).expect(200);

        // 3. The exact same, still-unexpired token, against the exact same
        // route. If suspension were cosmetic (only `VendorProfile.status`
        // flipped), this would still return 200 — the token's signature is
        // still valid and nothing but the session denylist can stop it.
        const response = await request(app)
          .get('/api/v1/vendors/me/shop-address')
          .set('Authorization', `Bearer ${vendor.token}`)
          .expect(401);
        expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
      });

      it('a fresh login attempt after suspension fails with the account-suspended error', async () => {
        const vendor = await activeVendor('security-relogin');
        await suspend(await adminFor('SUPER_ADMIN'), vendor.vendorId).expect(200);

        const response = await request(app)
          .post('/api/v1/identity/login')
          .send({ email: vendor.email, password: TEST_PASSWORD })
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe('ACCOUNT_SUSPENDED');
      });
    });
  });

  describe('reinstatement', () => {
    const suspendedVendor = async (label: string): Promise<VendorActor> => {
      const vendor = await activeVendor(label);
      await suspend(await adminFor('SUPER_ADMIN'), vendor.vendorId).expect(200);
      return vendor;
    };

    it('reinstates a SUSPENDED vendor back to ACTIVE', async () => {
      const vendor = await suspendedVendor('reinstate-basic');

      const response = await reinstate(await adminFor('RISK_ANALYST'), vendor.vendorId).expect(200);

      expect((response.body as VendorStatusBody).data.status).toBe('ACTIVE');
      const row = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendor.vendorId } });
      expect(row.status).toBe('ACTIVE');
    });

    it('leaves the linked User ACTIVE, not PENDING — able to authenticate again', async () => {
      const vendor = await suspendedVendor('reinstate-user');

      await reinstate(await adminFor('SUPER_ADMIN'), vendor.vendorId).expect(200);

      const user = await db.user.findUniqueOrThrow({ where: { id: vendor.userId } });
      expect(user.status).toBe('ACTIVE');
    });

    it('the vendor can authenticate again through the ordinary login flow', async () => {
      const vendor = await suspendedVendor('reinstate-login');
      await reinstate(await adminFor('SUPER_ADMIN'), vendor.vendorId).expect(200);

      const response = await request(app)
        .post('/api/v1/identity/login')
        .send({ email: vendor.email, password: TEST_PASSWORD })
        .expect(200);
      expect((response.body as AuthBody).data.accessToken).toBeTruthy();
    });

    it('reinstating an ACTIVE vendor fails as an illegal transition', async () => {
      const vendor = await activeVendor('reinstate-not-suspended');

      const response = await reinstate(await adminFor('SUPER_ADMIN'), vendor.vendorId).expect(422);
      expect((response.body as ErrorBody).error.code).toBe('VENDOR_INVALID_STATUS_TRANSITION');
    });

    it('records a reinstatement audit entry; reason is optional', async () => {
      const vendor = await suspendedVendor('reinstate-audit');

      await reinstate(await adminFor('SUPER_ADMIN'), vendor.vendorId, {}).expect(200);

      const entries = await db.auditLog.findMany({
        where: {
          entityType: 'VendorProfile',
          entityId: vendor.vendorId,
          action: 'vendor.reinstated',
        },
      });
      expect(entries).toHaveLength(1);
      expect((entries[0] as unknown as AuditLogRow).reason).toBeNull();
    });

    it('records a supplied reinstatement reason when given one', async () => {
      const vendor = await suspendedVendor('reinstate-audit-reason');

      await reinstate(await adminFor('SUPER_ADMIN'), vendor.vendorId, {
        reason: 'Appeal upheld after review',
      }).expect(200);

      const entries = await db.auditLog.findMany({
        where: {
          entityType: 'VendorProfile',
          entityId: vendor.vendorId,
          action: 'vendor.reinstated',
        },
      });
      expect((entries[0] as unknown as AuditLogRow).reason).toBe('Appeal upheld after review');
    });
  });
});
