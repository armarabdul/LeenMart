import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { OTP } from 'otplib';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';
import type { AuditWriter } from '../../src/modules/audit/index.js';
import { VENDOR_AUDIT_ACTIONS } from '../../src/modules/vendor/domain/audit-actions.js';
import { StartKycReviewUseCase } from '../../src/modules/vendor/application/use-cases/start-kyc-review.use-case.js';
import { DecideVendorKycUseCase } from '../../src/modules/vendor/application/use-cases/decide-vendor-kyc.use-case.js';
import { PrismaVendorKycRepository } from '../../src/modules/vendor/infrastructure/persistence/prisma-vendor-kyc.repository.js';
import { PrismaVendorRepository } from '../../src/modules/vendor/infrastructure/persistence/prisma-vendor.repository.js';
import { AdminTransactionRunner } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { toKycId } from '../../src/modules/vendor/domain/value-objects/kyc-id.value-object.js';
import { toSessionId } from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { Principal } from '../../src/modules/identity/application/ports/principal.js';
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

/** Fails every write, for the audit-rollback proofs — same shape as the unit fakes. */
class FailingAuditWriter implements AuditWriter {
  withTransaction(): AuditWriter {
    return this;
  }

  record(): Promise<void> {
    return Promise.reject(new Error('audit log unavailable'));
  }
}

const EMAIL_PREFIX = 'kyc-decide-';
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
interface ReviewBody {
  readonly data: { kycId: string; vendorStatus: string; reviewedBy: string; startedAt: string };
}
interface DecisionBody {
  readonly data: {
    kycId: string;
    vendorStatus: string;
    decidedBy: string;
    decidedAt: string;
    rejectionReason: string | null;
    rejectionNote: string | null;
  };
}

/**
 * Admin KYC claim and decision (KYC-5 Commit 3), end to end.
 *
 * Real admin authentication, real `adminPrisma`, real PostgreSQL with RLS —
 * including the concurrency cases, which are the point of the commit and
 * cannot be demonstrated against a fake.
 */
describe('admin KYC decisions', () => {
  let container: Container;
  let app: Express;
  let db: PrismaClient;

  const ids = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-02-01T00:00:00.000Z'));
  const now = clock.now();
  const seededUserIds: string[] = [];
  const seededVendorIds: string[] = [];

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
  const adminTokens = new Map<string, { token: string; userId: string }>();
  const adminFor = async (
    role: RoleName,
    key = role,
  ): Promise<{ token: string; userId: string }> => {
    const cached = adminTokens.get(key);
    if (cached) return cached;

    const email = uniqueEmail(key.toLowerCase());
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

    const entry = { token: (verified.body as AuthBody).data.accessToken, userId: admin.id };
    adminTokens.set(key, entry);
    return entry;
  };

  /** A submission for a fresh vendor, seeded directly at the requested lifecycle point. */
  const seedSubmission = async (
    options: { claimedBy?: string } = {},
  ): Promise<{ kycId: string; vendorId: string }> => {
    const owner = User.registerAdmin({
      id: toUserId(ids.generate()),
      email: uniqueEmail('owner'),
      passwordHash: await new Argon2PasswordHasher().hash(ADMIN_PASSWORD),
      role: Role.SUPER_ADMIN,
      now,
    });
    await new PrismaUserRepository(db).create(owner);
    seededUserIds.push(owner.id);

    const vendorId = ids.generate();
    const kycId = ids.generate();
    seededVendorIds.push(vendorId);

    await db.vendorProfile.create({
      data: {
        id: vendorId,
        userId: owner.id,
        status: options.claimedBy ? 'KYC_UNDER_REVIEW' : 'KYC_SUBMITTED',
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.vendorKycSubmission.create({
      data: {
        id: kycId,
        vendorId,
        panFingerprint: 'a'.repeat(64),
        panLast4: '234F',
        gstin: '27ABCDE1234F1Z0',
        bankFingerprint: 'b'.repeat(64),
        bankAccountLast4: '9012',
        ifsc: 'HDFC0001234',
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
        ...(options.claimedBy ? { reviewedBy: options.claimedBy, startedAt: now } : {}),
      },
    });
    await db.kycDocument.create({
      data: {
        id: ids.generate(),
        kycId,
        vendorId,
        type: 'PAN',
        objectKey: `vendor/${vendorId}/${kycId}/PAN.enc`,
        wrappedDataKey: Buffer.from('wrapped-key-material'),
        contentType: 'application/pdf',
        sizeBytes: 2048,
        status: 'UPLOADED',
        uploadedAt: now,
        createdAt: now,
      },
    });
    return { kycId, vendorId };
  };

  const claim = (token: string, kycId: string): request.Test =>
    request(app)
      .post(`/api/v1/admin/kyc/submissions/${kycId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

  const decide = (token: string, kycId: string, body: object): request.Test =>
    request(app)
      .post(`/api/v1/admin/kyc/submissions/${kycId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
  });

  afterAll(async () => {
    await db.vendorKycSubmission.deleteMany({ where: { vendorId: { in: seededVendorIds } } });
    await db.vendorProfile.deleteMany({ where: { id: { in: seededVendorIds } } });
    await db.mfaChallenge.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.mfaSecret.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.user.deleteMany({ where: { email: { contains: EMAIL_PREFIX } } });
    await db.$disconnect();
    await container.dispose();
  });

  describe('authentication and authorization', () => {
    it('refuses an unauthenticated claim and decision', async () => {
      const { kycId } = await seedSubmission();

      await request(app).post(`/api/v1/admin/kyc/submissions/${kycId}/review`).send({}).expect(401);
      await request(app)
        .post(`/api/v1/admin/kyc/submissions/${kycId}/decision`)
        .send({ decision: 'APPROVE' })
        .expect(401);
    });

    it.each(['FINANCE_ADMIN', 'CATALOGUE_MODERATOR'] as RoleName[])(
      'refuses %s, whose grant is READ_ONLY',
      async (role) => {
        // They may read the queue (Commit 2) but must not decide — the matrix
        // already draws that line, and this is where it starts to bite.
        const { kycId } = await seedSubmission();
        const { token } = await adminFor(role);

        expect(((await claim(token, kycId).expect(403)).body as ErrorBody).error.code).toBe(
          'UNAUTHORIZED',
        );
        await decide(token, kycId, { decision: 'APPROVE' }).expect(403);
      },
    );

    it('refuses a CUSTOMER and a VENDOR_OWNER', async () => {
      const { kycId } = await seedSubmission();

      const customer = await request(app)
        .post('/api/v1/identity/register')
        .send({ email: uniqueEmail('customer'), password: CUSTOMER_PASSWORD })
        .expect(201);
      const customerBody = customer.body as AuthBody;
      seededUserIds.push(customerBody.data.user.id);
      await claim(customerBody.data.accessToken, kycId).expect(403);

      const email = uniqueEmail('vendor');
      const registered = await request(app)
        .post('/api/v1/identity/register')
        .send({ email, password: CUSTOMER_PASSWORD })
        .expect(201);
      const vendorBody = registered.body as AuthBody;
      seededUserIds.push(vendorBody.data.user.id);
      await request(app)
        .post('/api/v1/vendors')
        .set('Authorization', `Bearer ${vendorBody.data.accessToken}`)
        .send({})
        .expect(201);
      const relogin = await request(app)
        .post('/api/v1/identity/login')
        .send({ email, password: CUSTOMER_PASSWORD })
        .expect(200);

      await claim((relogin.body as AuthBody).data.accessToken, kycId).expect(403);
      await decide((relogin.body as AuthBody).data.accessToken, kycId, {
        decision: 'APPROVE',
      }).expect(403);
    });
  });

  describe('claim', () => {
    it('records the claiming administrator and moves nothing else', async () => {
      const { kycId, vendorId } = await seedSubmission();
      const { token, userId } = await adminFor('RISK_ANALYST');

      const body = (await claim(token, kycId).expect(200)).body as ReviewBody;

      expect(body.data.reviewedBy).toBe(userId);
      expect(body.data.startedAt).toEqual(expect.any(String) as unknown as string);

      const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      expect(row.reviewedBy).toBe(userId);
      expect(row.startedAt).not.toBeNull();
      expect(row.decidedBy).toBeNull();
      expect(row.decidedAt).toBeNull();

      // A claim is not a decision: the vendor's lifecycle is untouched here.
      const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
      expect(vendor.status).toBe('KYC_SUBMITTED');
    });

    it('refuses a second, sequential claim through the domain rule', async () => {
      // Sequential, so the second reviewer *loads* an already-claimed
      // submission and the aggregate refuses it — a 422 domain-rule failure.
      // The 409 conflict is reserved for the race below, where both loaded an
      // unclaimed row and only the conditional write could separate them.
      const { kycId } = await seedSubmission();
      const first = await adminFor('RISK_ANALYST');
      const second = await adminFor('SUPER_ADMIN');

      await claim(first.token, kycId).expect(200);
      const response = await claim(second.token, kycId);

      expect(response.status).toBe(422);
      const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      expect(row.reviewedBy).toBe(first.userId);
    });

    it('returns 404 for an unknown submission', async () => {
      const { token } = await adminFor('RISK_ANALYST');

      const response = await claim(token, ids.generate()).expect(404);
      expect((response.body as ErrorBody).error.code).toBe('KYC_SUBMISSION_NOT_FOUND');
    });
  });

  describe('approval', () => {
    it('records the decision and moves the vendor to KYC_APPROVED, not ACTIVE', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId, vendorId } = await seedSubmission({ claimedBy: userId });

      const body = (await decide(token, kycId, { decision: 'APPROVE' }).expect(200))
        .body as DecisionBody;

      expect(body.data.decidedBy).toBe(userId);
      expect(body.data.vendorStatus).toBe('KYC_APPROVED');
      expect(body.data.rejectionReason).toBeNull();

      const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      expect(row.decidedBy).toBe(userId);
      expect(row.decidedAt).not.toBeNull();

      const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
      expect(vendor.status).toBe('KYC_APPROVED');
      expect(vendor.status).not.toBe('ACTIVE');
    });

    it('refuses a decision on a submission nobody claimed', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId } = await seedSubmission();

      const response = await decide(token, kycId, { decision: 'APPROVE' });
      expect(response.status).toBe(422);
    });

    it('leaves document rows untouched', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId } = await seedSubmission({ claimedBy: userId });
      const before = await db.kycDocument.findMany({ where: { kycId } });

      await decide(token, kycId, { decision: 'APPROVE' }).expect(200);

      expect(await db.kycDocument.findMany({ where: { kycId } })).toEqual(before);
    });
  });

  describe('rejection', () => {
    it('records the reason and moves the vendor to KYC_REJECTED', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId, vendorId } = await seedSubmission({ claimedBy: userId });

      const body = (
        await decide(token, kycId, {
          decision: 'REJECT',
          reason: 'DOCUMENT_UNCLEAR',
        }).expect(200)
      ).body as DecisionBody;

      expect(body.data.rejectionReason).toBe('DOCUMENT_UNCLEAR');
      expect(body.data.vendorStatus).toBe('KYC_REJECTED');

      const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
      expect(vendor.status).toBe('KYC_REJECTED');
    });

    it('requires a note for OTHER', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId, vendorId } = await seedSubmission({ claimedBy: userId });

      const response = await decide(token, kycId, { decision: 'REJECT', reason: 'OTHER' });
      expect(response.status).toBe(422);

      // Nothing was written — the vendor is still awaiting a decision.
      const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
      expect(vendor.status).toBe('KYC_UNDER_REVIEW');
    });

    it('accepts OTHER when explained', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId } = await seedSubmission({ claimedBy: userId });

      const body = (
        await decide(token, kycId, {
          decision: 'REJECT',
          reason: 'OTHER',
          note: 'Business name does not match the shop.',
        }).expect(200)
      ).body as DecisionBody;

      expect(body.data.rejectionNote).toBe('Business name does not match the shop.');
    });

    it('rejects a reason outside the closed set at the contract boundary', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId } = await seedSubmission({ claimedBy: userId });

      await decide(token, kycId, { decision: 'REJECT', reason: 'BECAUSE_I_SAID_SO' }).expect(400);
    });

    it('refuses a reviewer identity supplied in the body', async () => {
      // `.strict()` closes the mass-assignment hole: one admin must not be able
      // to record a decision under a colleague's name.
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId } = await seedSubmission({ claimedBy: userId });

      await decide(token, kycId, {
        decision: 'APPROVE',
        decidedBy: ids.generate(),
      }).expect(400);
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of two simultaneous claims win', async () => {
      const { kycId } = await seedSubmission();
      const first = await adminFor('RISK_ANALYST');
      const second = await adminFor('SUPER_ADMIN');

      const results = await Promise.all([claim(first.token, kycId), claim(second.token, kycId)]);
      const statuses = results.map((response) => response.status).sort();

      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status !== 200)).toHaveLength(1);

      const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      expect([first.userId, second.userId]).toContain(row.reviewedBy);
    });

    it('lets exactly one of two simultaneous decisions win, with no last-writer-wins', async () => {
      // The reason `saveDecisionIfUndecided` exists. Under the previous
      // unconditional update both of these would have succeeded and the later
      // write would have silently replaced the earlier decision.
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId, vendorId } = await seedSubmission({ claimedBy: userId });

      const results = await Promise.all([
        decide(token, kycId, { decision: 'APPROVE' }),
        decide(token, kycId, { decision: 'REJECT', reason: 'DOCUMENT_UNCLEAR' }),
      ]);
      const statuses = results.map((response) => response.status);

      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => (status === 200 ? false : true))).toHaveLength(1);

      const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });

      // Exactly one decision persisted, and the vendor agrees with it.
      expect(row.decidedAt).not.toBeNull();
      const approved = row.rejectionReason === null;
      expect(vendor.status).toBe(approved ? 'KYC_APPROVED' : 'KYC_REJECTED');
    });

    it('refuses a second decision after the first has committed', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId } = await seedSubmission({ claimedBy: userId });

      await decide(token, kycId, { decision: 'APPROVE' }).expect(200);
      const second = await decide(token, kycId, {
        decision: 'REJECT',
        reason: 'DOCUMENT_UNCLEAR',
      });

      expect([409, 422]).toContain(second.status);
      const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      expect(row.rejectionReason).toBeNull();
    });
  });

  describe('atomicity', () => {
    it('leaves the vendor untransitioned when the decision is refused', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId, vendorId } = await seedSubmission({ claimedBy: userId });

      await decide(token, kycId, { decision: 'APPROVE' }).expect(200);
      const afterFirst = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });

      await decide(token, kycId, { decision: 'REJECT', reason: 'DOCUMENT_UNCLEAR' });

      const afterSecond = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
      expect(afterSecond.status).toBe(afterFirst.status);
    });

    it('never leaves a decided submission beside an untransitioned vendor', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId, vendorId } = await seedSubmission({ claimedBy: userId });

      await decide(token, kycId, { decision: 'APPROVE' }).expect(200);

      const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });

      expect(row.decidedAt).not.toBeNull();
      expect(vendor.status).toBe('KYC_APPROVED');
    });
  });

  describe('audit (KYC-6)', () => {
    interface AuditRow {
      action: string;
      entity_type: string;
      entity_id: string | null;
      actor_id: string | null;
      actor_role: string;
      reason: string | null;
      after: unknown;
    }

    const auditRowsFor = async (entityId: string): Promise<AuditRow[]> =>
      db.$queryRawUnsafe<AuditRow[]>(
        `SELECT action, entity_type, entity_id, actor_id, actor_role, reason, after
           FROM audit_logs
          WHERE entity_id = $1::uuid
          ORDER BY created_at ASC`,
        entityId,
      );

    /** The claim/decision use cases built directly on `adminPrisma`, exactly as `vendor.module.ts` wires them. */
    const decisionUseCases = (
      auditWriter: AuditWriter,
    ): {
      startKycReviewUseCase: StartKycReviewUseCase;
      decideVendorKycUseCase: DecideVendorKycUseCase;
    } => {
      const vendorKycRepository = new PrismaVendorKycRepository(container.adminPrisma);
      const vendorRepository = new PrismaVendorRepository(container.adminPrisma);
      const transactionRunner = new AdminTransactionRunner(container.adminPrisma);
      return {
        startKycReviewUseCase: new StartKycReviewUseCase({
          vendorKycRepository,
          transactionRunner,
          auditWriter,
          clock,
          logger: new NullLogger(),
        }),
        decideVendorKycUseCase: new DecideVendorKycUseCase({
          vendorKycRepository,
          vendorRepository,
          transactionRunner,
          auditWriter,
          clock,
          logger: new NullLogger(),
        }),
      };
    };

    const principalOf = (userId: string): Principal => ({
      userId: toUserId(userId),
      sessionId: toSessionId(ids.generate()),
      role: 'RISK_ANALYST',
    });

    describe('claim', () => {
      it('writes exactly one audit row for a winning claim, identifying the reviewer', async () => {
        const { kycId } = await seedSubmission();
        const { token, userId } = await adminFor('RISK_ANALYST');

        await claim(token, kycId).expect(200);

        const rows = (await auditRowsFor(kycId)).filter(
          (row) => row.action === VENDOR_AUDIT_ACTIONS.KYC_REVIEW_STARTED,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.entity_type).toBe('VendorKyc');
        expect(rows[0]?.actor_id).toBe(userId);
      });

      it('writes no second audit row for the sequential claim the domain refuses', async () => {
        const { kycId } = await seedSubmission();
        const first = await adminFor('RISK_ANALYST');
        const second = await adminFor('SUPER_ADMIN');

        await claim(first.token, kycId).expect(200);
        await claim(second.token, kycId);

        const rows = (await auditRowsFor(kycId)).filter(
          (row) => row.action === VENDOR_AUDIT_ACTIONS.KYC_REVIEW_STARTED,
        );
        expect(rows).toHaveLength(1);
      });

      it('rolls back the claim and writes no audit row when the audit write fails', async () => {
        const { kycId } = await seedSubmission();
        const { userId } = await adminFor('RISK_ANALYST');
        const { startKycReviewUseCase } = decisionUseCases(new FailingAuditWriter());

        await expect(
          startKycReviewUseCase.execute({ principal: principalOf(userId), kycId: toKycId(kycId) }),
        ).rejects.toThrow(/audit log unavailable/);

        const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
        expect(row.reviewedBy).toBeNull();
        expect(await auditRowsFor(kycId)).toHaveLength(0);
      });
    });

    describe('approval', () => {
      it('writes exactly one audit row identifying the admin and the kyc submission', async () => {
        const { token, userId } = await adminFor('RISK_ANALYST');
        const { kycId } = await seedSubmission({ claimedBy: userId });

        await decide(token, kycId, { decision: 'APPROVE' }).expect(200);

        const rows = await auditRowsFor(kycId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.action).toBe(VENDOR_AUDIT_ACTIONS.KYC_APPROVED);
        expect(rows[0]?.entity_type).toBe('VendorKyc');
        expect(rows[0]?.actor_id).toBe(userId);
        expect(rows[0]?.reason).toBeNull();
      });

      it('carries no key material, fingerprint or object key', async () => {
        const { token, userId } = await adminFor('RISK_ANALYST');
        const { kycId } = await seedSubmission({ claimedBy: userId });

        await decide(token, kycId, { decision: 'APPROVE' }).expect(200);

        const [row] = await auditRowsFor(kycId);
        const serialised = JSON.stringify(row);
        for (const forbidden of [
          'wrappedDataKey',
          'wrapped-key-material',
          'panFingerprint',
          'bankFingerprint',
          'a'.repeat(64),
          'b'.repeat(64),
          'objectKey',
          '.enc',
        ]) {
          expect(serialised).not.toContain(forbidden);
        }
      });

      it('writes no audit row when the decision is refused because nobody claimed it', async () => {
        const { token } = await adminFor('RISK_ANALYST');
        const { kycId } = await seedSubmission();

        await decide(token, kycId, { decision: 'APPROVE' });

        expect(await auditRowsFor(kycId)).toHaveLength(0);
      });

      it('rolls back the decision and the vendor transition when the audit write fails', async () => {
        const { userId } = await adminFor('RISK_ANALYST');
        const { kycId, vendorId } = await seedSubmission({ claimedBy: userId });
        const { decideVendorKycUseCase } = decisionUseCases(new FailingAuditWriter());

        await expect(
          decideVendorKycUseCase.execute({
            principal: principalOf(userId),
            kycId: toKycId(kycId),
            command: { decision: 'APPROVE' },
          }),
        ).rejects.toThrow(/audit log unavailable/);

        const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
        expect(row.decidedAt).toBeNull();
        const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
        expect(vendor.status).toBe('KYC_UNDER_REVIEW');
        expect(await auditRowsFor(kycId)).toHaveLength(0);
      });
    });

    describe('rejection', () => {
      it('writes exactly one audit row with the coded reason and no free-text note', async () => {
        const { token, userId } = await adminFor('RISK_ANALYST');
        const { kycId } = await seedSubmission({ claimedBy: userId });
        const note = 'Business name on the certificate does not match the application.';

        await decide(token, kycId, { decision: 'REJECT', reason: 'OTHER', note }).expect(200);

        const rows = await auditRowsFor(kycId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.action).toBe(VENDOR_AUDIT_ACTIONS.KYC_REJECTED);
        expect(rows[0]?.reason).toBe('OTHER');
        expect(JSON.stringify(rows[0])).not.toContain(note);
      });

      it('records the specific coded reason', async () => {
        const { token, userId } = await adminFor('RISK_ANALYST');
        const { kycId } = await seedSubmission({ claimedBy: userId });

        await decide(token, kycId, {
          decision: 'REJECT',
          reason: 'BANK_DETAILS_MISMATCH',
        }).expect(200);

        const [row] = await auditRowsFor(kycId);
        expect(row?.reason).toBe('BANK_DETAILS_MISMATCH');
      });

      it('rolls back the decision and the vendor transition when the audit write fails', async () => {
        const { userId } = await adminFor('RISK_ANALYST');
        const { kycId, vendorId } = await seedSubmission({ claimedBy: userId });
        const { decideVendorKycUseCase } = decisionUseCases(new FailingAuditWriter());

        await expect(
          decideVendorKycUseCase.execute({
            principal: principalOf(userId),
            kycId: toKycId(kycId),
            command: { decision: 'REJECT', reason: 'DOCUMENT_UNCLEAR' },
          }),
        ).rejects.toThrow(/audit log unavailable/);

        const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
        expect(row.decidedAt).toBeNull();
        const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
        expect(vendor.status).toBe('KYC_UNDER_REVIEW');
        expect(await auditRowsFor(kycId)).toHaveLength(0);
      });
    });

    describe('concurrency', () => {
      it('produces exactly one claim audit row when two claims race', async () => {
        const { kycId } = await seedSubmission();
        const first = await adminFor('RISK_ANALYST');
        const second = await adminFor('SUPER_ADMIN');

        await Promise.all([claim(first.token, kycId), claim(second.token, kycId)]);

        const rows = (await auditRowsFor(kycId)).filter(
          (row) => row.action === VENDOR_AUDIT_ACTIONS.KYC_REVIEW_STARTED,
        );
        expect(rows).toHaveLength(1);
        expect([first.userId, second.userId]).toContain(rows[0]?.actor_id);
      });

      it('produces exactly one decision audit row when two decisions race, agreeing with the winner', async () => {
        const { token, userId } = await adminFor('RISK_ANALYST');
        const { kycId, vendorId } = await seedSubmission({ claimedBy: userId });

        await Promise.all([
          decide(token, kycId, { decision: 'APPROVE' }),
          decide(token, kycId, { decision: 'REJECT', reason: 'DOCUMENT_UNCLEAR' }),
        ]);

        const rows = (await auditRowsFor(kycId)).filter((row) =>
          [
            VENDOR_AUDIT_ACTIONS.KYC_APPROVED as string,
            VENDOR_AUDIT_ACTIONS.KYC_REJECTED as string,
          ].includes(row.action),
        );
        expect(rows).toHaveLength(1);

        const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
        const winnerAction =
          vendor.status === 'KYC_APPROVED'
            ? VENDOR_AUDIT_ACTIONS.KYC_APPROVED
            : VENDOR_AUDIT_ACTIONS.KYC_REJECTED;
        expect(rows[0]?.action).toBe(winnerAction);
      });
    });
  });

  describe('data exposure', () => {
    it('returns no key material, fingerprint, object key or URL', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId } = await seedSubmission({ claimedBy: userId });

      const claimResponse = await claim(token, kycId);
      const decisionResponse = await decide(token, kycId, { decision: 'APPROVE' }).expect(200);
      const serialised = JSON.stringify(claimResponse.body) + JSON.stringify(decisionResponse.body);

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
});
