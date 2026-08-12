import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { OTP } from 'otplib';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
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

const EMAIL_PREFIX = 'kyc-review-';
const ADMIN_PASSWORD = 'admin-password-that-is-long-enough';
const CUSTOMER_PASSWORD = 'customer-password-long-enough';

interface QueueBody {
  readonly data: {
    kycId: string;
    vendorId: string;
    vendorStatus: string;
    panLast4: string;
    gstin: string;
    submittedAt: string;
    reviewedBy: string | null;
    startedAt: string | null;
  }[];
  readonly meta: { pagination?: { nextCursor: string | null; hasMore: boolean } };
}
interface DetailBody {
  readonly data: Record<string, unknown> & { documents: Record<string, unknown>[] };
}
interface ErrorBody {
  readonly error: { code: string };
}
interface AuthBody {
  readonly data: { accessToken: string };
}
interface ChallengeBody {
  readonly data: { mfaChallengeToken: string };
}

/**
 * The admin KYC review queue (KYC-5 Commit 2), end to end.
 *
 * Exercises the **real** admin authentication flow — password then TOTP — and
 * the real `adminPrisma` credential against real PostgreSQL with RLS enabled.
 * Seeding a token by hand would skip the very middleware chain this suite
 * exists to prove, and running as the owner credential would prove nothing at
 * all about the policies.
 */
describe('admin KYC review queue', () => {
  let container: Container;
  let app: Express;
  let db: PrismaClient;

  const ids = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const now = clock.now();

  const vendorA = ids.generate();
  const vendorB = ids.generate();
  const vendorApproved = ids.generate();
  const kycA = ids.generate();
  const kycB = ids.generate();
  const kycApproved = ids.generate();
  const kycRejected = ids.generate();
  const seededUserIds: string[] = [];
  let reviewerId = '';

  // Lower-cased: role names are upper-case and the login path normalises the
  // address, so an upper-case local part would be stored one way and looked up
  // another.
  const uniqueEmail = (label: string): string =>
    `${EMAIL_PREFIX}${label}-${Date.now()}@leenmart.in`.toLowerCase();

  const currentTotpCode = async (secret: string): Promise<string> =>
    new OTP({ strategy: 'totp' }).generate({
      secret,
      algorithm: 'sha1',
      digits: 6,
      period: 30,
      epoch: Math.floor(Date.now() / 1000),
    });

  /**
   * One signed-in admin per role, minted once and reused.
   *
   * Not a shortcut: `LOGIN_PER_IP` caps logins at 20 a minute, and a fresh
   * login per test would exhaust that budget mid-suite and fail with a 401
   * that had nothing to do with what was being tested.
   */
  const adminTokens = new Map<RoleName, string>();
  const adminTokenFor = async (role: RoleName, label: string): Promise<string> => {
    const cached = adminTokens.get(role);
    if (cached) return cached;

    const email = uniqueEmail(label);
    const passwordHasher = new Argon2PasswordHasher();
    const cipher = new AesGcmMfaSecretCipher(Buffer.from(container.env.MFA_ENCRYPTION_KEY, 'hex'));
    const userRepository = new PrismaUserRepository(db);
    const mfaSecretRepository = new PrismaMfaSecretRepository(db);

    const admin = User.registerAdmin({
      id: toUserId(ids.generate()),
      email,
      passwordHash: await passwordHasher.hash(ADMIN_PASSWORD),
      role: Role.fromName(role),
      now,
    });
    await userRepository.create(admin);
    seededUserIds.push(admin.id);

    const secret = new OtplibTotpService().generateSecret();
    await mfaSecretRepository.create(
      MfaSecret.enroll({
        id: toMfaSecretId(ids.generate()),
        userId: admin.id,
        encryptedSecret: cipher.encrypt(secret),
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

  /** A customer, and optionally a vendor owner — the two roles that must be refused. */
  const customerToken = async (label: string): Promise<string> => {
    const response = await request(app)
      .post('/api/v1/identity/register')
      .send({ email: uniqueEmail(label), password: CUSTOMER_PASSWORD })
      .expect(201);
    const body = response.body as AuthBody & { data: { user: { id: string } } };
    seededUserIds.push(body.data.user.id);
    return body.data.accessToken;
  };

  let cachedVendorToken: string | undefined;
  const vendorOwnerToken = async (label: string): Promise<string> => {
    if (cachedVendorToken) return cachedVendorToken;
    const email = uniqueEmail(label);
    const registered = await request(app)
      .post('/api/v1/identity/register')
      .send({ email, password: CUSTOMER_PASSWORD })
      .expect(201);
    const body = registered.body as AuthBody & { data: { user: { id: string } } };
    seededUserIds.push(body.data.user.id);

    await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .send({})
      .expect(201);

    // Registration promotes the account and revokes every session, so the
    // VENDOR_OWNER claim only exists on a fresh login.
    const relogin = await request(app)
      .post('/api/v1/identity/login')
      .send({ email, password: CUSTOMER_PASSWORD })
      .expect(200);
    cachedVendorToken = (relogin.body as AuthBody).data.accessToken;
    return cachedVendorToken;
  };

  const queue = (token: string, query = ''): request.Test =>
    request(app)
      .get(`/api/v1/admin/kyc/submissions${query}`)
      .set('Authorization', `Bearer ${token}`);

  const detail = (token: string, kycId: string): request.Test =>
    request(app)
      .get(`/api/v1/admin/kyc/submissions/${kycId}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    // Seeding and assertions observe as the owner; the runtime clients are
    // deliberately constrained and would fail closed outside a request.
    db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });

    const owners = await Promise.all(
      ['a', 'b', 'approved'].map(async (label) => {
        const user = User.registerAdmin({
          id: toUserId(ids.generate()),
          email: uniqueEmail(`owner-${label}`),
          passwordHash: await new Argon2PasswordHasher().hash(ADMIN_PASSWORD),
          role: Role.SUPER_ADMIN,
          now,
        });
        await new PrismaUserRepository(db).create(user);
        seededUserIds.push(user.id);
        return user.id;
      }),
    );
    reviewerId = owners[0] ?? '';

    await db.vendorProfile.createMany({
      data: [
        {
          id: vendorA,
          userId: owners[0] ?? '',
          status: 'KYC_SUBMITTED',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: vendorB,
          userId: owners[1] ?? '',
          status: 'KYC_UNDER_REVIEW',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: vendorApproved,
          userId: owners[2] ?? '',
          status: 'KYC_APPROVED',
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const identifiers = {
      panFingerprint: 'a'.repeat(64),
      panLast4: '234F',
      gstin: '27ABCDE1234F1Z0',
      bankFingerprint: 'b'.repeat(64),
      bankAccountLast4: '9012',
      ifsc: 'HDFC0001234',
      createdAt: now,
      updatedAt: now,
    };

    await db.vendorKycSubmission.createMany({
      data: [
        {
          id: kycA,
          vendorId: vendorA,
          submittedAt: new Date(now.getTime() - 2000),
          ...identifiers,
        },
        {
          id: kycB,
          vendorId: vendorB,
          submittedAt: new Date(now.getTime() - 1000),
          reviewedBy: reviewerId,
          startedAt: now,
          ...identifiers,
        },
        // A decided attempt for the approved vendor, plus a rejected one, so
        // the default queue can be shown to exclude both.
        {
          id: kycApproved,
          vendorId: vendorApproved,
          submittedAt: now,
          reviewedBy: reviewerId,
          startedAt: now,
          decidedBy: reviewerId,
          decidedAt: now,
          ...identifiers,
        },
      ],
    });

    await db.kycDocument.create({
      data: {
        id: kycRejected,
        kycId: kycA,
        vendorId: vendorA,
        type: 'PAN',
        objectKey: `vendor/${vendorA}/${kycA}/PAN.enc`,
        wrappedDataKey: Buffer.from('wrapped-key-material'),
        contentType: 'application/pdf',
        sizeBytes: 2048,
        status: 'UPLOADED',
        uploadedAt: now,
        createdAt: now,
      },
    });
  });

  afterAll(async () => {
    await db.vendorKycSubmission.deleteMany({
      where: { vendorId: { in: [vendorA, vendorB, vendorApproved] } },
    });
    await db.vendorProfile.deleteMany({
      where: { id: { in: [vendorA, vendorB, vendorApproved] } },
    });
    await db.mfaChallenge.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.mfaSecret.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.user.deleteMany({ where: { email: { contains: EMAIL_PREFIX } } });
    await db.$disconnect();
    await container.dispose();
  });

  describe('authentication', () => {
    it('refuses an unauthenticated queue request', async () => {
      const response = await request(app).get('/api/v1/admin/kyc/submissions').expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('refuses an unauthenticated detail request', async () => {
      await request(app).get(`/api/v1/admin/kyc/submissions/${kycA}`).expect(401);
    });
  });

  describe('authorization', () => {
    it.each(['RISK_ANALYST', 'SUPER_ADMIN', 'FINANCE_ADMIN', 'CATALOGUE_MODERATOR'] as RoleName[])(
      'allows %s to read the queue',
      async (role) => {
        // FULL and READ_ONLY both read; the distinction becomes load-bearing
        // only when Commit 3 adds the decision routes.
        await queue(await adminTokenFor(role, `allow-${role}`)).expect(200);
      },
    );

    it('refuses SUPPORT_AGENT', async () => {
      const response = await queue(await adminTokenFor('SUPPORT_AGENT', 'deny-support')).expect(
        403,
      );

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('refuses a CUSTOMER', async () => {
      const response = await queue(await customerToken('deny-customer')).expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('refuses a VENDOR_OWNER', async () => {
      // The role that owns KYC submissions must not be able to review them.
      const response = await queue(await vendorOwnerToken('deny-vendor')).expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('refuses a VENDOR_OWNER the detail endpoint too', async () => {
      await detail(await vendorOwnerToken('deny-vendor-detail'), kycA).expect(403);
    });
  });

  describe('queue', () => {
    it('returns submissions belonging to more than one vendor', async () => {
      const response = await queue(await adminTokenFor('RISK_ANALYST', 'multi')).expect(200);
      const vendors = (response.body as QueueBody).data.map((item) => item.vendorId);

      expect(vendors).toContain(vendorA);
      expect(vendors).toContain(vendorB);
    });

    it('includes both KYC_SUBMITTED and KYC_UNDER_REVIEW by default', async () => {
      const response = await queue(await adminTokenFor('RISK_ANALYST', 'default')).expect(200);
      const byId = new Map(
        (response.body as QueueBody).data.map((item) => [item.kycId, item.vendorStatus]),
      );

      expect(byId.get(kycA)).toBe('KYC_SUBMITTED');
      expect(byId.get(kycB)).toBe('KYC_UNDER_REVIEW');
    });

    it('excludes already-decided submissions from the default queue', async () => {
      const response = await queue(await adminTokenFor('RISK_ANALYST', 'decided')).expect(200);
      const ids = (response.body as QueueBody).data.map((item) => item.kycId);

      expect(ids).not.toContain(kycApproved);
    });

    it('shows who has claimed an item already under review', async () => {
      // Without this a second reviewer cannot tell "being worked" from "free".
      const response = await queue(await adminTokenFor('RISK_ANALYST', 'claimed')).expect(200);
      const claimed = (response.body as QueueBody).data.find((item) => item.kycId === kycB);

      expect(claimed?.reviewedBy).toBe(reviewerId);
      expect(claimed?.startedAt).not.toBeNull();
    });

    it('leaves an unclaimed item with no reviewer', async () => {
      const response = await queue(await adminTokenFor('RISK_ANALYST', 'unclaimed')).expect(200);
      const unclaimed = (response.body as QueueBody).data.find((item) => item.kycId === kycA);

      expect(unclaimed?.reviewedBy).toBeNull();
      expect(unclaimed?.startedAt).toBeNull();
    });

    it('paginates with the platform cursor convention', async () => {
      const token = await adminTokenFor('RISK_ANALYST', 'page');

      const first = await queue(token, '?limit=1').expect(200);
      const firstBody = first.body as QueueBody;
      expect(firstBody.data).toHaveLength(1);
      expect(firstBody.meta.pagination?.hasMore).toBe(true);
      expect(firstBody.meta.pagination?.nextCursor).toBe(firstBody.data[0]?.kycId);

      const second = await queue(
        token,
        `?limit=1&cursor=${firstBody.meta.pagination?.nextCursor ?? ''}`,
      ).expect(200);
      expect((second.body as QueueBody).data[0]?.kycId).not.toBe(firstBody.data[0]?.kycId);
    });

    it('filters by an explicit lifecycle status', async () => {
      const response = await queue(
        await adminTokenFor('RISK_ANALYST', 'filter'),
        '?status=KYC_UNDER_REVIEW',
      ).expect(200);
      const statuses = new Set((response.body as QueueBody).data.map((item) => item.vendorStatus));

      expect(statuses).toEqual(new Set(['KYC_UNDER_REVIEW']));
    });

    it('rejects a status outside the KYC lifecycle', async () => {
      await queue(await adminTokenFor('RISK_ANALYST', 'badstatus'), '?status=ACTIVE').expect(400);
    });

    it('rejects a limit beyond the platform cap', async () => {
      await queue(await adminTokenFor('RISK_ANALYST', 'badlimit'), '?limit=500').expect(400);
    });

    it('exposes no key material, fingerprint, object key or URL', async () => {
      const response = await queue(await adminTokenFor('RISK_ANALYST', 'safe')).expect(200);
      const serialised = JSON.stringify(response.body);

      for (const forbidden of [
        'wrappedDataKey',
        'wrapped-key-material',
        'dataKey',
        'panFingerprint',
        'bankFingerprint',
        'a'.repeat(64),
        'b'.repeat(64),
        'objectKey',
        '.enc',
        'X-Amz-Signature',
      ]) {
        expect(serialised).not.toContain(forbidden);
      }
    });
  });

  describe('detail', () => {
    it('returns one submission with its safe identifiers', async () => {
      const response = await detail(await adminTokenFor('SUPER_ADMIN', 'detail'), kycA).expect(200);
      const { data } = response.body as DetailBody;

      expect(data.kycId).toBe(kycA);
      expect(data.vendorId).toBe(vendorA);
      expect(data.panLast4).toBe('234F');
      expect(data.bankAccountLast4).toBe('9012');
      expect(data.ifsc).toBe('HDFC0001234');
      expect(data.gstin).toBe('27ABCDE1234F1Z0');
    });

    it('returns document metadata without any storage reference', async () => {
      const response = await detail(await adminTokenFor('SUPER_ADMIN', 'docs'), kycA).expect(200);
      const [document] = (response.body as DetailBody).data.documents;

      expect(document).toBeDefined();
      expect(Object.keys(document ?? {}).sort()).toEqual([
        'contentType',
        'sizeBytes',
        'status',
        'type',
        'uploadedAt',
      ]);
    });

    it('exposes no key material, fingerprint, object key or URL', async () => {
      const response = await detail(await adminTokenFor('SUPER_ADMIN', 'detail-safe'), kycA).expect(
        200,
      );
      const serialised = JSON.stringify(response.body);

      for (const forbidden of [
        'wrappedDataKey',
        'wrapped-key-material',
        'dataKey',
        'panFingerprint',
        'bankFingerprint',
        'a'.repeat(64),
        'b'.repeat(64),
        'objectKey',
        '.enc',
        'X-Amz-Signature',
        'AWS4-HMAC',
      ]) {
        expect(serialised).not.toContain(forbidden);
      }
    });

    it('returns the standard not-found envelope for an unknown id', async () => {
      const response = await detail(
        await adminTokenFor('SUPER_ADMIN', 'missing'),
        ids.generate(),
      ).expect(404);

      expect((response.body as ErrorBody).error.code).toBe('KYC_SUBMISSION_NOT_FOUND');
    });

    it('rejects a malformed id before reaching the database', async () => {
      await detail(await adminTokenFor('SUPER_ADMIN', 'malformed'), 'not-a-uuid').expect(400);
    });

    it('returns a decided submission with its decision intact', async () => {
      const response = await detail(
        await adminTokenFor('SUPER_ADMIN', 'decided-detail'),
        kycApproved,
      ).expect(200);
      const { data } = response.body as DetailBody;

      expect(data.decidedBy).toBe(reviewerId);
      expect(data.decidedAt).not.toBeNull();
    });
  });

  describe('read-only guarantee', () => {
    it('leaves every review column untouched after a queue and a detail read', async () => {
      // The point of Commit 2: opening a submission is not claiming it.
      const before = await db.vendorKycSubmission.findMany({
        where: { vendorId: { in: [vendorA, vendorB, vendorApproved] } },
        orderBy: { id: 'asc' },
      });
      const vendorsBefore = await db.vendorProfile.findMany({
        where: { id: { in: [vendorA, vendorB, vendorApproved] } },
        orderBy: { id: 'asc' },
      });

      const token = await adminTokenFor('RISK_ANALYST', 'nomutate');
      await queue(token).expect(200);
      await detail(token, kycA).expect(200);
      await detail(token, kycB).expect(200);

      const after = await db.vendorKycSubmission.findMany({
        where: { vendorId: { in: [vendorA, vendorB, vendorApproved] } },
        orderBy: { id: 'asc' },
      });
      const vendorsAfter = await db.vendorProfile.findMany({
        where: { id: { in: [vendorA, vendorB, vendorApproved] } },
        orderBy: { id: 'asc' },
      });

      expect(after).toEqual(before);
      expect(vendorsAfter).toEqual(vendorsBefore);
    });

    it('does not touch document rows', async () => {
      const before = await db.kycDocument.findMany({ where: { kycId: kycA } });

      const token = await adminTokenFor('SUPER_ADMIN', 'nomutate-docs');
      await detail(token, kycA).expect(200);

      expect(await db.kycDocument.findMany({ where: { kycId: kycA } })).toEqual(before);
    });
  });

  describe('cross-tenant boundaries', () => {
    it('serves the admin path with no vendor tenant context established', async () => {
      // The admin routes deliberately omit `tenantContext`; if the query
      // depended on `app.vendor_id` it would return nothing here.
      const response = await queue(await adminTokenFor('RISK_ANALYST', 'notenant')).expect(200);

      expect((response.body as QueueBody).data.length).toBeGreaterThanOrEqual(2);
    });

    it('still refuses a vendor credential reading another vendor row', async () => {
      // The tenant boundary is unchanged by this commit: the app role sees
      // only its own vendor, whatever the admin path can see.
      const appClient = new PrismaClient({
        datasources: { db: { url: process.env.APP_DATABASE_URL ?? '' } },
      });
      try {
        const rows = await appClient.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.vendor_id', ${vendorA}, TRUE)`;
          return tx.$queryRawUnsafe<{ count: bigint }[]>(
            'SELECT count(*) AS count FROM vendor_kyc_submissions WHERE vendor_id = $1::uuid',
            vendorB,
          );
        });

        expect(Number(rows[0]?.count)).toBe(0);
      } finally {
        await appClient.$disconnect();
      }
    });
  });
});
