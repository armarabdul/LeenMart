import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { OTP } from 'otplib';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaClient } from '@prisma/client';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createApp } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';
import type { AuditWriter } from '../../src/modules/audit/index.js';
import { VENDOR_AUDIT_ACTIONS } from '../../src/modules/vendor/domain/audit-actions.js';
import { AccessKycDocumentUseCase } from '../../src/modules/vendor/application/use-cases/access-kyc-document.use-case.js';
import { PrismaKycDocumentAccessQuery } from '../../src/modules/vendor/infrastructure/persistence/prisma-kyc-document-access-query.js';
import { S3ObjectStore } from '../../src/modules/vendor/infrastructure/storage/s3-object-store.js';
import { DevDataKeyCipher } from '../../src/modules/vendor/infrastructure/crypto/dev-data-key-cipher.js';
import { AesGcmDocumentCipher } from '../../src/modules/vendor/infrastructure/crypto/aes-gcm-document-cipher.js';
import { toKycId } from '../../src/modules/vendor/domain/value-objects/kyc-id.value-object.js';
import { toKycDocumentId } from '../../src/modules/vendor/domain/value-objects/kyc-document-id.value-object.js';
import { toSessionId } from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
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
import type { Principal } from '../../src/modules/identity/application/ports/principal.js';

const EMAIL_PREFIX = 'kyc-doc-access-';
const ADMIN_PASSWORD = 'admin-password-that-is-long-enough';
const CUSTOMER_PASSWORD = 'customer-password-long-enough';

interface ErrorBody {
  readonly error: { code: string };
}
interface AccessBody {
  readonly data: {
    kycId: string;
    documentId: string;
    type: string;
    url: string;
    expiresAt: string;
  };
}
interface AuthBody {
  readonly data: { accessToken: string; user: { id: string } };
}
interface ChallengeBody {
  readonly data: { mfaChallengeToken: string };
}

/** Fails every write, for the audit-rollback proof — same shape as the unit fakes. */
class FailingAuditWriter implements AuditWriter {
  withTransaction(): AuditWriter {
    return this;
  }

  record(): Promise<void> {
    return Promise.reject(new Error('audit log unavailable'));
  }
}

/**
 * `GET /api/v1/admin/kyc/submissions/:kycId/documents/:documentId` (KYC-7),
 * end to end: real admin authentication, real `adminPrisma`, real
 * PostgreSQL, real MinIO, and — since the preparatory commit — genuinely
 * encrypted document bytes, decrypted through the real `DataKeyCipher` and
 * `DocumentCipher` this endpoint actually uses in production.
 */
describe('GET /api/v1/admin/kyc/submissions/:kycId/documents/:documentId', () => {
  let container: Container;
  let app: Express;
  let db: PrismaClient;
  let s3: S3Client;
  let documentCipher: AesGcmDocumentCipher;
  let dataKeyCipher: DevDataKeyCipher;

  const ids = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-04-01T00:00:00.000Z'));
  const now = clock.now();
  const seededUserIds: string[] = [];
  const seededVendorIds: string[] = [];
  const writtenObjectKeys: string[] = [];

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

  /** A vendor owner, real HTTP registration + promotion, for the "vendor credentials refused" proof. */
  const signUpVendorOwner = async (
    label: string,
  ): Promise<{ token: string; userId: string; vendorId: string }> => {
    const email = uniqueEmail(label);
    const registered = await request(app)
      .post('/api/v1/identity/register')
      .send({ email, password: CUSTOMER_PASSWORD })
      .expect(201);
    const { user } = (registered.body as AuthBody).data;
    seededUserIds.push(user.id);
    await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${(registered.body as AuthBody).data.accessToken}`)
      .send({})
      .expect(201);
    const relogin = await request(app)
      .post('/api/v1/identity/login')
      .send({ email, password: CUSTOMER_PASSWORD })
      .expect(200);
    const vendor = await db.vendorProfile.findFirstOrThrow({ where: { userId: user.id } });
    seededVendorIds.push(vendor.id);
    return {
      token: (relogin.body as AuthBody).data.accessToken,
      userId: user.id,
      vendorId: vendor.id,
    };
  };

  /**
   * A submission with one document. For `UPLOADED` (the default), the
   * ciphertext is **genuine**: a real data key is generated and wrapped by
   * the same `DevDataKeyCipher` the running server uses, the plaintext is
   * really encrypted with `AesGcmDocumentCipher` under `{vendorId, kycId,
   * documentType}`, and the resulting bytes are actually `PUT` to MinIO at
   * the permanent object key — so the endpoint under test has to do real
   * decryption to succeed, not decrypt a fixture that was never encrypted.
   */
  const seedDocument = async (
    options: { documentStatus?: 'UPLOADED' | 'AWAITING_UPLOAD'; plaintext?: Buffer } = {},
  ): Promise<{
    kycId: string;
    vendorId: string;
    documentId: string;
    objectKey: string;
    plaintext: Buffer;
  }> => {
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
    const documentId = ids.generate();
    seededVendorIds.push(vendorId);
    const status = options.documentStatus ?? 'UPLOADED';
    const objectKey = `vendor/${vendorId}/${kycId}/PAN.enc`;
    const plaintext = options.plaintext ?? Buffer.from(`real PDF bytes for ${documentId}`);

    let wrappedDataKey = Buffer.from('reserved-not-uploaded');
    if (status === 'UPLOADED') {
      const context = { vendorId, kycId, documentType: 'PAN' };
      const dataKey = await dataKeyCipher.generateDataKey(context);
      wrappedDataKey = dataKey.wrapped;
      const ciphertext = documentCipher.encrypt(plaintext, dataKey.plaintext, {
        vendorId: toVendorId(vendorId),
        kycId: toKycId(kycId),
        documentType: 'PAN',
      });
      dataKeyCipher.shred(dataKey.plaintext);

      await s3.send(
        new PutObjectCommand({
          Bucket: container.env.KYC_S3_BUCKET,
          Key: objectKey,
          Body: ciphertext,
          ContentType: 'application/pdf',
        }),
      );
      writtenObjectKeys.push(objectKey);
    }

    await db.vendorProfile.create({
      data: {
        id: vendorId,
        userId: owner.id,
        status: 'KYC_SUBMITTED',
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
      },
    });
    await db.kycDocument.create({
      data: {
        id: documentId,
        kycId,
        vendorId,
        type: 'PAN',
        objectKey,
        wrappedDataKey,
        contentType: 'application/pdf',
        sizeBytes: plaintext.byteLength,
        status,
        uploadedAt: status === 'UPLOADED' ? now : null,
        createdAt: now,
      },
    });
    return { kycId, vendorId, documentId, objectKey, plaintext };
  };

  const access = (token: string | null, kycId: string, documentId: string): request.Test => {
    const req = request(app).get(`/api/v1/admin/kyc/submissions/${kycId}/documents/${documentId}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  interface AuditRow {
    action: string;
    entity_type: string;
    entity_id: string;
    actor_id: string;
    actor_role: string;
    after: { vendorId?: string; documentId?: string } | null;
  }

  const auditRowsFor = async (kycId: string): Promise<AuditRow[]> =>
    db.$queryRawUnsafe<AuditRow[]>(
      `SELECT action, entity_type, entity_id, actor_id, actor_role, after
         FROM audit_logs
        WHERE entity_id = $1::uuid AND action = $2
        ORDER BY created_at DESC`,
      kycId,
      VENDOR_AUDIT_ACTIONS.KYC_DOCUMENT_ACCESSED,
    );

  /** Builds the use case directly on real infrastructure, for the failure-path proofs HTTP alone cannot inject. */
  const buildUseCase = (auditWriter: AuditWriter): AccessKycDocumentUseCase =>
    new AccessKycDocumentUseCase({
      documentAccessQuery: new PrismaKycDocumentAccessQuery(container.adminPrisma),
      objectStore: new S3ObjectStore(s3, { bucket: container.env.KYC_S3_BUCKET }),
      dataKeyCipher: new DevDataKeyCipher(
        Buffer.from(container.env.KYC_DEV_WRAPPING_KEY, 'hex'),
        'test',
      ),
      documentCipher: new AesGcmDocumentCipher(),
      auditWriter,
      logger: new NullLogger(),
    });

  const adminPrincipalFor = (userId: string): Principal => ({
    userId: toUserId(userId),
    sessionId: toSessionId(ids.generate()),
    role: 'RISK_ANALYST',
  });

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
    s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.KYC_S3_ENDPOINT ?? 'http://localhost:9000',
      forcePathStyle: true,
      credentials: { accessKeyId: 'leenmart', secretAccessKey: 'leenmart-dev-secret' },
    });
    documentCipher = new AesGcmDocumentCipher();
    dataKeyCipher = new DevDataKeyCipher(
      Buffer.from(container.env.KYC_DEV_WRAPPING_KEY, 'hex'),
      'test',
    );
  });

  afterAll(async () => {
    await Promise.all(
      writtenObjectKeys.map((key) =>
        new S3ObjectStore(s3, { bucket: container.env.KYC_S3_BUCKET }).delete(key),
      ),
    );
    await db.kycDocument.deleteMany({ where: { vendorId: { in: seededVendorIds } } });
    await db.vendorKycSubmission.deleteMany({ where: { vendorId: { in: seededVendorIds } } });
    await db.vendorProfile.deleteMany({ where: { id: { in: seededVendorIds } } });
    await db.mfaChallenge.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.mfaSecret.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: seededUserIds } } });
    await db.user.deleteMany({ where: { id: { in: seededUserIds } } });
    await db.$disconnect();
    s3.destroy();
    await container.dispose();
  });

  describe('authentication and authorization', () => {
    it('refuses an unauthenticated caller', async () => {
      const { kycId, documentId } = await seedDocument();

      await access(null, kycId, documentId).expect(401);
    });

    it('refuses a CUSTOMER', async () => {
      const { kycId, documentId } = await seedDocument();
      const email = uniqueEmail('customer');
      const registered = await request(app)
        .post('/api/v1/identity/register')
        .send({ email, password: CUSTOMER_PASSWORD })
        .expect(201);
      const body = registered.body as AuthBody;
      seededUserIds.push(body.data.user.id);

      const response = await access(body.data.accessToken, kycId, documentId).expect(403);
      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('refuses the vendor owner whose own document it is', async () => {
      const owner = await signUpVendorOwner('doc-owner');
      const kycId = ids.generate();
      const documentId = ids.generate();
      seededVendorIds.push(owner.vendorId);
      await db.vendorKycSubmission.create({
        data: {
          id: kycId,
          vendorId: owner.vendorId,
          panFingerprint: 'e'.repeat(64),
          panLast4: '111A',
          gstin: '27ABCDE1234F1Z2',
          bankFingerprint: 'f'.repeat(64),
          bankAccountLast4: '2222',
          ifsc: 'HDFC0009999',
          submittedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
      await db.kycDocument.create({
        data: {
          id: documentId,
          kycId,
          vendorId: owner.vendorId,
          type: 'PAN',
          objectKey: `vendor/${owner.vendorId}/${kycId}/PAN.enc`,
          wrappedDataKey: Buffer.from('wrapped-key-material'),
          contentType: 'application/pdf',
          sizeBytes: 2048,
          status: 'UPLOADED',
          uploadedAt: now,
          createdAt: now,
        },
      });

      await access(owner.token, kycId, documentId).expect(403);
    });

    it.each(['SUPPORT_AGENT', 'FINANCE_ADMIN', 'CATALOGUE_MODERATOR'] as RoleName[])(
      'refuses %s',
      async (role) => {
        const { kycId, documentId } = await seedDocument();
        const { token } = await adminFor(role);

        await access(token, kycId, documentId).expect(403);
      },
    );

    it.each(['RISK_ANALYST', 'SUPER_ADMIN'] as RoleName[])('allows %s', async (role) => {
      const { kycId, documentId } = await seedDocument();
      const { token } = await adminFor(role);

      const response = await access(token, kycId, documentId).expect(200);
      expect((response.body as AccessBody).data.documentId).toBe(documentId);
    });
  });

  describe('lookup', () => {
    it('returns 404 for a nonexistent kycId', async () => {
      const { token } = await adminFor('RISK_ANALYST');

      const response = await access(token, ids.generate(), ids.generate()).expect(404);
      expect((response.body as ErrorBody).error.code).toBe('KYC_DOCUMENT_NOT_FOUND');
    });

    it('returns 404 for a nonexistent documentId', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId } = await seedDocument();

      await access(token, kycId, ids.generate()).expect(404);
    });

    it('returns 404 when the document belongs to a different kycId', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const first = await seedDocument();
      const second = await seedDocument();

      await access(token, first.kycId, second.documentId).expect(404);
    });

    it('returns 422 for a document that has not been uploaded', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId, documentId } = await seedDocument({ documentStatus: 'AWAITING_UPLOAD' });

      const response = await access(token, kycId, documentId);
      expect(response.status).toBe(422);
    });
  });

  describe('cross-tenant admin access', () => {
    it('reads a document belonging to any vendor, through admin authorization alone', async () => {
      const { token } = await adminFor('SUPER_ADMIN');
      const vendorA = await seedDocument();
      const vendorB = await seedDocument();

      await access(token, vendorA.kycId, vendorA.documentId).expect(200);
      await access(token, vendorB.kycId, vendorB.documentId).expect(200);
    });
  });

  describe('decryption and temporary delivery', () => {
    it('the returned url points to a temporary delivery object, never the permanent one', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId, documentId, objectKey } = await seedDocument();

      const response = await access(token, kycId, documentId).expect(200);
      const { url } = (response.body as AccessBody).data;

      expect(new URL(url).pathname).toContain('kyc-temp-delivery/');
      expect(new URL(url).pathname).not.toContain(objectKey);
    });

    it('the returned url actually serves the original plaintext, decrypted', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const plaintext = Buffer.from('a specific, checkable plaintext payload');
      const { kycId, documentId } = await seedDocument({ plaintext });

      const response = await access(token, kycId, documentId).expect(200);
      const { url } = (response.body as AccessBody).data;

      const fetched = await fetch(url);
      expect(fetched.status).toBe(200);
      expect(Buffer.from(await fetched.arrayBuffer())).toEqual(plaintext);
    });

    it('the temporary url expires within the existing 60-second ceiling', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId, documentId } = await seedDocument();
      const before = Date.now();

      const response = await access(token, kycId, documentId).expect(200);
      const { url, expiresAt } = (response.body as AccessBody).data;

      expect((new Date(expiresAt).getTime() - before) / 1000).toBeLessThanOrEqual(61);
      expect(Number(new URL(url).searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(60);
    });

    it('leaves the permanent encrypted object byte-for-byte unchanged', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId, documentId, objectKey } = await seedDocument();
      const before = await s3.send(
        new GetObjectCommand({ Bucket: container.env.KYC_S3_BUCKET, Key: objectKey }),
      );
      const beforeBytes = Buffer.from((await before.Body?.transformToByteArray()) ?? []);

      await access(token, kycId, documentId).expect(200);

      const after = await s3.send(
        new GetObjectCommand({ Bucket: container.env.KYC_S3_BUCKET, Key: objectKey }),
      );
      const afterBytes = Buffer.from((await after.Body?.transformToByteArray()) ?? []);
      expect(afterBytes).toEqual(beforeBytes);
      // Still ciphertext, not the plaintext this access decrypted.
      expect(afterBytes.equals(Buffer.from('a specific, checkable plaintext payload'))).toBe(false);
    });

    it('leaves the wrapped data key in the database unchanged and never returns it', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId, documentId } = await seedDocument();
      const before = await db.kycDocument.findUniqueOrThrow({ where: { id: documentId } });

      const response = await access(token, kycId, documentId).expect(200);

      const after = await db.kycDocument.findUniqueOrThrow({ where: { id: documentId } });
      expect(Buffer.from(after.wrappedDataKey)).toEqual(Buffer.from(before.wrappedDataKey));
      expect(JSON.stringify(response.body)).not.toContain(
        Buffer.from(before.wrappedDataKey).toString('base64'),
      );
    });
  });

  describe('data exposure', () => {
    it('contains only the approved fields — no key material, fingerprint, object key or credentials', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId, documentId, plaintext } = await seedDocument();

      const response = await access(token, kycId, documentId).expect(200);
      const serialised = JSON.stringify(response.body);

      for (const forbidden of [
        'wrappedDataKey',
        'wrapped-key-material',
        'dataKey',
        'panFingerprint',
        'bankFingerprint',
        'a'.repeat(64),
        'b'.repeat(64),
        '"objectKey"',
        'secretAccessKey',
        'leenmart-dev-secret',
        plaintext.toString('base64'),
      ]) {
        expect(serialised).not.toContain(forbidden);
      }

      const body = response.body as AccessBody;
      expect(Object.keys(body.data).sort()).toEqual(
        ['documentId', 'expiresAt', 'kycId', 'type', 'url'].sort(),
      );
    });
  });

  describe('audit (KYC-7)', () => {
    it('writes exactly one audit row on successful access', async () => {
      const { token, userId } = await adminFor('RISK_ANALYST');
      const { kycId, documentId } = await seedDocument();

      await access(token, kycId, documentId).expect(200);

      const rows = await auditRowsFor(kycId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actor_id).toBe(userId);
      expect(rows[0]?.entity_type).toBe('VendorKyc');
      expect(rows[0]?.after?.documentId).toBe(documentId);
    });

    it('writes no audit row when authorization is refused', async () => {
      const { kycId, documentId } = await seedDocument();
      const email = uniqueEmail('audit-403');
      const registered = await request(app)
        .post('/api/v1/identity/register')
        .send({ email, password: CUSTOMER_PASSWORD })
        .expect(201);
      seededUserIds.push((registered.body as AuthBody).data.user.id);

      await access((registered.body as AuthBody).data.accessToken, kycId, documentId).expect(403);

      expect(await auditRowsFor(kycId)).toHaveLength(0);
    });

    it('writes no audit row for a nonexistent document', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId } = await seedDocument();

      await access(token, kycId, ids.generate()).expect(404);

      expect(await auditRowsFor(kycId)).toHaveLength(0);
    });

    it('prevents a successful response and deletes the temporary object when the audit write fails', async () => {
      const { kycId, documentId } = await seedDocument();
      const useCase = buildUseCase(new FailingAuditWriter());
      const { userId } = await adminFor('RISK_ANALYST');

      await expect(
        useCase.execute({
          principal: adminPrincipalFor(userId),
          kycId: toKycId(kycId),
          documentId: toKycDocumentId(documentId),
        }),
      ).rejects.toThrow(/audit log unavailable/);

      expect(await auditRowsFor(kycId)).toHaveLength(0);
      // The row itself is untouched — a read that fails to audit is still just a read.
      const row = await db.kycDocument.findUniqueOrThrow({ where: { id: documentId } });
      expect(row.status).toBe('UPLOADED');
    });
  });

  describe('idempotency', () => {
    it('does not mutate the KYC submission or document on repeated access', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId, documentId } = await seedDocument();

      const before = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      const beforeDocument = await db.kycDocument.findUniqueOrThrow({ where: { id: documentId } });

      await access(token, kycId, documentId).expect(200);
      await access(token, kycId, documentId).expect(200);

      const after = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      const afterDocument = await db.kycDocument.findUniqueOrThrow({ where: { id: documentId } });

      expect(after).toEqual(before);
      expect(afterDocument).toEqual(beforeDocument);
    });

    it('leaves review/decision state untouched', async () => {
      const { token } = await adminFor('RISK_ANALYST');
      const { kycId, documentId } = await seedDocument();

      await access(token, kycId, documentId).expect(200);

      const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: kycId } });
      expect(row.reviewedBy).toBeNull();
      expect(row.decidedAt).toBeNull();
    });
  });
});
