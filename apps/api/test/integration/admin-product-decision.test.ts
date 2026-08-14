import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { PrismaClient as PrismaClientCtor, type PrismaClient } from '@prisma/client';
import { OTP } from 'otplib';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import { signUpVendorOwner, type VendorActor } from '../support/actors.js';
import type { AuditWriter } from '../../src/modules/audit/index.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../src/modules/catalogue/domain/audit-actions.js';
import { DecideProductUseCase } from '../../src/modules/catalogue/application/use-cases/decide-product.use-case.js';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductMediaRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-media.repository.js';
import { AdminTransactionRunner } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { toProductId } from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toSessionId } from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
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

const EMAIL_PREFIX = 'product-moderation-';
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
interface CreateBody {
  readonly data: { product: { id: string } };
}
interface ProductBody {
  readonly data: {
    id: string;
    status: string;
    rejectionReason: string | null;
    rejectionNote: string | null;
  };
}
interface QueueBody {
  readonly data: { productId: string; status: string }[];
}
interface DecisionBody {
  readonly data: {
    productId: string;
    status: string;
    rejectionReason: string | null;
    rejectionNote: string | null;
  };
}

/**
 * The product moderation core (S2-5), end to end: vendor submission and
 * admin decision, against real authentication, real `adminPrisma`, real
 * PostgreSQL with RLS — including the concurrency cases, which cannot be
 * demonstrated against a fake. Mirrors `admin-kyc-decision.test.ts`.
 */
describe('product moderation', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let vendor: VendorActor;
  let categoryId: string;
  let categoryIdWithRequirements: string;

  const ids = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
  const now = clock.now();
  const seededUserIds: string[] = [];
  const productsPath = '/api/v1/vendor/products';

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
  const adminFor = async (role: RoleName): Promise<{ token: string; userId: string }> => {
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

    const entry = { token: (verified.body as AuthBody).data.accessToken, userId: admin.id };
    adminTokens.set(role, entry);
    return entry;
  };

  let seq = 0;
  const seedProduct = async (
    actor: VendorActor,
    overrides: Record<string, unknown> = {},
    category = categoryId,
  ): Promise<string> => {
    const response = await request(app)
      .post(productsPath)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        categoryId: category,
        name: `Moderation Product ${(seq += 1)}`,
        variant: {
          sku: `MOD-${Date.now()}-${(seq += 1)}`,
          name: 'Default',
          price: { amount: '19900', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
        ...overrides,
      })
      .expect(201);
    return (response.body as CreateBody).data.product.id;
  };

  const submit = (actor: VendorActor, productId: string): request.Test =>
    request(app)
      .post(`${productsPath}/${productId}/submit`)
      .set('Authorization', `Bearer ${actor.token}`);

  /**
   * Direct DB insert of one live `READY` media row (S2-8's approval gate) —
   * never the real upload/complete/worker pipeline, which is what
   * `vendor-product-media.test.ts`/`product-media-processing.test.ts` already
   * exercise. This suite's job is the moderation *decision*, not the media
   * pipeline that produces a `READY` row in production.
   */
  const seedReadyMedia = async (productId: string, actor: VendorActor): Promise<void> => {
    await db.productMedia.create({
      data: {
        id: randomUUID(),
        productId,
        vendorId: actor.vendorId,
        objectKey: `product-media/${actor.vendorId}/${productId}/${randomUUID()}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        status: 'READY',
      },
    });
  };

  const queuePath = '/api/v1/admin/products/submissions';
  const listQueue = (token: string, query = ''): request.Test =>
    request(app).get(`${queuePath}${query}`).set('Authorization', `Bearer ${token}`);

  const getSubmission = (token: string, productId: string): request.Test =>
    request(app).get(`${queuePath}/${productId}`).set('Authorization', `Bearer ${token}`);

  const decide = (token: string, productId: string, body: object): request.Test =>
    request(app)
      .post(`${queuePath}/${productId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    vendor = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor');

    const slug = `${EMAIL_PREFIX}cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;

    const slugReq = `${EMAIL_PREFIX}cat-req-${Date.now()}`;
    const rowReq = await db.category.create({
      data: {
        id: randomUUID(),
        path: [],
        depth: 1,
        name: slugReq,
        slug: slugReq,
        requiresHsn: true,
      },
    });
    categoryIdWithRequirements = rowReq.id;
  }, 60_000);

  afterAll(async () => {
    // Products reference categories with `onDelete: Restrict`, so the vendor's
    // products must go first — `disposeIntegrationHarness` is what removes
    // them (by `vendorId`), and it must run before the category delete below.
    await db.mfaChallenge.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.mfaSecret.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.user.deleteMany({ where: { id: { in: seededUserIds } } });
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);

    const cleanup = new PrismaClientCtor();
    await cleanup.category.deleteMany({
      where: { id: { in: [categoryId, categoryIdWithRequirements] } },
    });
    await cleanup.$disconnect();
  });

  describe('vendor submission', () => {
    it('moves a DRAFT product to PENDING_REVIEW', async () => {
      const productId = await seedProduct(vendor);
      const body = (await submit(vendor, productId).expect(200)).body as ProductBody;

      expect(body.data.status).toBe('PENDING_REVIEW');
      const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
      expect(row.status).toBe('PENDING_REVIEW');
    });

    it('refuses submission when a category-required field is missing', async () => {
      const productId = await seedProduct(vendor, {}, categoryIdWithRequirements);

      const response = await submit(vendor, productId);
      expect(response.status).toBe(422);
      const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
      expect(row.status).toBe('DRAFT');
    });

    it('succeeds once the required field is supplied', async () => {
      const productId = await seedProduct(vendor, { hsnCode: '0302' }, categoryIdWithRequirements);

      await submit(vendor, productId).expect(200);
    });

    it('refuses a second submission while already PENDING_REVIEW', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);

      const response = await submit(vendor, productId);
      expect(response.status).toBe(422);
    });

    it('returns 404 for an unknown product', async () => {
      await submit(vendor, ids.generate()).expect(404);
    });

    it('refuses an unauthenticated submission', async () => {
      const productId = await seedProduct(vendor);
      await request(app).post(`${productsPath}/${productId}/submit`).expect(401);
    });

    describe('resubmission', () => {
      it('moves a REJECTED product back to PENDING_REVIEW and clears the rejection', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        const { token } = await adminFor('CATALOGUE_MODERATOR');
        await decide(token, productId, {
          decision: 'REJECT',
          reason: 'MISLEADING_LISTING',
          note: 'Fix the title.',
        }).expect(200);

        const body = (await submit(vendor, productId).expect(200)).body as ProductBody;
        expect(body.data.status).toBe('PENDING_REVIEW');
        expect(body.data.rejectionReason).toBeNull();
        expect(body.data.rejectionNote).toBeNull();
      });
    });
  });

  describe('authentication and authorization', () => {
    it('refuses an unauthenticated queue read and decision', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);

      await request(app).get(queuePath).expect(401);
      await request(app)
        .post(`${queuePath}/${productId}/decision`)
        .send({ decision: 'APPROVE' })
        .expect(401);
    });

    it('refuses a VENDOR_OWNER on the admin surface', async () => {
      await request(app).get(queuePath).set('Authorization', `Bearer ${vendor.token}`).expect(403);
    });

    it.each(['SUPPORT_AGENT', 'FINANCE_ADMIN', 'RISK_ANALYST'] as RoleName[])(
      'refuses %s, which holds no grant on APPROVE_OR_REJECT_PRODUCT',
      async (role) => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        const { token } = await adminFor(role);

        expect(((await listQueue(token).expect(403)).body as ErrorBody).error.code).toBe(
          'UNAUTHORIZED',
        );
        await decide(token, productId, { decision: 'APPROVE' }).expect(403);
      },
    );

    it.each(['CATALOGUE_MODERATOR', 'SUPER_ADMIN'] as RoleName[])(
      'allows %s to read the queue and decide',
      async (role) => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        await seedReadyMedia(productId, vendor);
        const { token } = await adminFor(role);

        await listQueue(token).expect(200);
        await decide(token, productId, { decision: 'APPROVE' }).expect(200);
      },
    );
  });

  describe('admin queue and detail', () => {
    it('defaults to PENDING_REVIEW only', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      // A large limit: earlier tests in this suite leave many PENDING_REVIEW
      // rows behind, and the default page size (20) is not guaranteed to
      // include this specific one.
      const body = (await listQueue(token, '?limit=100').expect(200)).body as QueueBody;
      const found = body.data.find((item) => item.productId === productId);
      expect(found?.status).toBe('PENDING_REVIEW');
      expect(body.data.every((item) => item.status === 'PENDING_REVIEW')).toBe(true);
    });

    it('reads a product detail regardless of status', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);
      await seedReadyMedia(productId, vendor);
      const { token } = await adminFor('CATALOGUE_MODERATOR');
      await decide(token, productId, { decision: 'APPROVE' }).expect(200);

      const body = (await getSubmission(token, productId).expect(200)).body as ProductBody;
      expect(body.data.status).toBe('APPROVED');
    });

    it('returns 404 for an unknown product', async () => {
      const { token } = await adminFor('CATALOGUE_MODERATOR');
      await getSubmission(token, ids.generate()).expect(404);
    });
  });

  describe('decision', () => {
    it('approves a PENDING_REVIEW product', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);
      await seedReadyMedia(productId, vendor);
      const { token, userId } = await adminFor('CATALOGUE_MODERATOR');

      const body = (await decide(token, productId, { decision: 'APPROVE' }).expect(200))
        .body as DecisionBody;
      expect(body.data.status).toBe('APPROVED');

      const rows = await db.$queryRawUnsafe<{ actor_id: string }[]>(
        `SELECT actor_id FROM audit_logs WHERE entity_id = $1::uuid AND action = $2 ORDER BY created_at DESC LIMIT 1`,
        productId,
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_APPROVED,
      );
      expect(rows[0]?.actor_id).toBe(userId);
    });

    it('rejects with a reason and note', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      const body = (
        await decide(token, productId, {
          decision: 'REJECT',
          reason: 'DUPLICATE_LISTING',
          note: 'Same as an existing listing.',
        }).expect(200)
      ).body as DecisionBody;

      expect(body.data.status).toBe('REJECTED');
      expect(body.data.rejectionReason).toBe('DUPLICATE_LISTING');
      expect(body.data.rejectionNote).toBe('Same as an existing listing.');
    });

    it('rejects with a reason and no note — SDD 15.2 makes the note optional', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      const body = (
        await decide(token, productId, { decision: 'REJECT', reason: 'PRICING_ISSUE' }).expect(200)
      ).body as DecisionBody;

      expect(body.data.status).toBe('REJECTED');
      expect(body.data.rejectionReason).toBe('PRICING_ISSUE');
      expect(body.data.rejectionNote).toBeNull();

      const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
      expect(row.rejectionReason).toBe('PRICING_ISSUE');
      expect(row.rejectionNote).toBeNull();
    });

    it('refuses a supplied but blank note, at the contract boundary', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      await decide(token, productId, {
        decision: 'REJECT',
        reason: 'PRICING_ISSUE',
        note: '   ',
      }).expect(400);
    });

    it('rejects with no reason at all, at the contract boundary', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      await decide(token, productId, { decision: 'REJECT', note: 'no reason supplied' }).expect(
        400,
      );
    });

    it('rejects a reason outside the closed set at the contract boundary', async () => {
      const productId = await seedProduct(vendor);
      await submit(vendor, productId).expect(200);
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      await decide(token, productId, {
        decision: 'REJECT',
        reason: 'BECAUSE_I_SAID_SO',
        note: 'x',
      }).expect(400);
    });

    it('refuses a decision on a product that is not PENDING_REVIEW', async () => {
      const productId = await seedProduct(vendor);
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      const response = await decide(token, productId, { decision: 'APPROVE' });
      expect(response.status).toBe(422);
    });

    it('returns 404 for an unknown product', async () => {
      const { token } = await adminFor('CATALOGUE_MODERATOR');
      await decide(token, ids.generate(), { decision: 'APPROVE' }).expect(404);
    });

    describe('concurrency', () => {
      it('lets exactly one of two simultaneous submissions win', async () => {
        const productId = await seedProduct(vendor);

        const results = await Promise.all([submit(vendor, productId), submit(vendor, productId)]);
        const statuses = results.map((response) => response.status).sort();

        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
        expect(statuses.filter((status) => status !== 200)).toHaveLength(1);

        const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
        expect(row.status).toBe('PENDING_REVIEW');
      });

      it('lets exactly one of two simultaneous decisions win, with no last-writer-wins', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        // So the race is genuinely between the two decisions themselves —
        // without this, APPROVE would always lose to the S2-8 media gate
        // rather than to the conditional-write race this test proves.
        await seedReadyMedia(productId, vendor);
        const { token } = await adminFor('CATALOGUE_MODERATOR');

        const results = await Promise.all([
          decide(token, productId, { decision: 'APPROVE' }),
          decide(token, productId, {
            decision: 'REJECT',
            reason: 'PRICING_ISSUE',
            note: 'Racing decision.',
          }),
        ]);
        const statuses = results.map((response) => response.status);

        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
        expect(statuses.filter((status) => status !== 200)).toHaveLength(1);

        const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
        expect(['APPROVED', 'REJECTED']).toContain(row.status);
        if (row.status === 'REJECTED') {
          expect(row.rejectionReason).toBe('PRICING_ISSUE');
        }
      });

      it('refuses a second decision after the first has committed', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        await seedReadyMedia(productId, vendor);
        const { token } = await adminFor('CATALOGUE_MODERATOR');

        await decide(token, productId, { decision: 'APPROVE' }).expect(200);
        const second = await decide(token, productId, {
          decision: 'REJECT',
          reason: 'PRICING_ISSUE',
          note: 'too late',
        });

        expect([409, 422]).toContain(second.status);
        const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
        expect(row.status).toBe('APPROVED');
      });
    });

    describe('media readiness gate (S2-8, SDD 12.2 step 6)', () => {
      it('refuses approval with zero media', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        const { token } = await adminFor('CATALOGUE_MODERATOR');

        const response = await decide(token, productId, { decision: 'APPROVE' });

        expect(response.status).toBe(422);
        expect((response.body as ErrorBody).error.code).toBe('PRODUCT_MEDIA_NOT_READY');
        const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
        expect(row.status).toBe('PENDING_REVIEW');
      });

      it('refuses approval while media is still PROCESSING', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        await db.productMedia.create({
          data: {
            id: randomUUID(),
            productId,
            vendorId: vendor.vendorId,
            objectKey: `product-media/${vendor.vendorId}/${productId}/${randomUUID()}.jpg`,
            contentType: 'image/jpeg',
            sizeBytes: 1024,
            status: 'PROCESSING',
          },
        });
        const { token } = await adminFor('CATALOGUE_MODERATOR');

        const response = await decide(token, productId, { decision: 'APPROVE' });

        expect(response.status).toBe(422);
        expect((response.body as ErrorBody).error.code).toBe('PRODUCT_MEDIA_NOT_READY');
      });

      it('allows approval once a live READY media item exists', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        await seedReadyMedia(productId, vendor);
        const { token } = await adminFor('CATALOGUE_MODERATOR');

        const body = (await decide(token, productId, { decision: 'APPROVE' }).expect(200))
          .body as DecisionBody;

        expect(body.data.status).toBe('APPROVED');
      });

      it('does not gate a REJECT decision on media', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        const { token } = await adminFor('CATALOGUE_MODERATOR');

        await decide(token, productId, { decision: 'REJECT', reason: 'PRICING_ISSUE' }).expect(200);
      });
    });

    describe('audit', () => {
      const auditRowsFor = async (
        productId: string,
      ): Promise<{ action: string; reason: string | null; actor_id: string | null }[]> =>
        db.$queryRawUnsafe(
          `SELECT action, reason, actor_id FROM audit_logs WHERE entity_id = $1::uuid ORDER BY created_at ASC`,
          productId,
        );

      it('writes exactly one PRODUCT_SUBMITTED_FOR_REVIEW row', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);

        const rows = (await auditRowsFor(productId)).filter(
          (row) => row.action === CATALOGUE_AUDIT_ACTIONS.PRODUCT_SUBMITTED_FOR_REVIEW,
        );
        expect(rows).toHaveLength(1);
      });

      it('records the coded rejection reason and never the free-text note', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        const { token } = await adminFor('CATALOGUE_MODERATOR');
        const note = 'Reviewer prose naming this specific listing.';

        await decide(token, productId, {
          decision: 'REJECT',
          reason: 'MISLEADING_LISTING',
          note,
        }).expect(200);

        const rows = await auditRowsFor(productId);
        const rejectRow = rows.find(
          (row) => row.action === CATALOGUE_AUDIT_ACTIONS.PRODUCT_REJECTED,
        );
        expect(rejectRow?.reason).toBe('MISLEADING_LISTING');
        expect(JSON.stringify(rows)).not.toContain(note);
      });

      it('rolls back the decision when the audit write fails', async () => {
        const productId = await seedProduct(vendor);
        await submit(vendor, productId).expect(200);
        await seedReadyMedia(productId, vendor);
        const { userId } = await adminFor('CATALOGUE_MODERATOR');

        const productRepository = new PrismaProductRepository(harness.container.adminPrisma);
        const productMediaRepository = new PrismaProductMediaRepository(
          harness.container.adminPrisma,
        );
        const transactionRunner = new AdminTransactionRunner(harness.container.adminPrisma);
        const decideProductUseCase = new DecideProductUseCase({
          productRepository,
          productMediaRepository,
          transactionRunner,
          auditWriter: new FailingAuditWriter(),
          clock,
          logger: new NullLogger(),
        });
        const principal: Principal = {
          userId: toUserId(userId),
          sessionId: toSessionId(ids.generate()),
          role: 'CATALOGUE_MODERATOR',
        };

        await expect(
          decideProductUseCase.execute({
            principal,
            productId: toProductId(productId),
            command: { decision: 'APPROVE' },
          }),
        ).rejects.toThrow(/audit log unavailable/);

        const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
        expect(row.status).toBe('PENDING_REVIEW');
        expect(
          (await auditRowsFor(productId)).filter(
            (r) => r.action === CATALOGUE_AUDIT_ACTIONS.PRODUCT_APPROVED,
          ),
        ).toHaveLength(0);
      });
    });
  });
});
