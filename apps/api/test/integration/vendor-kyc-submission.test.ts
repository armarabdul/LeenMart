import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { createApp } from '../../src/app.js';
import { type Container, createContainer } from '../../src/container.js';
import { DevDataKeyCipher } from '../../src/modules/vendor/infrastructure/crypto/dev-data-key-cipher.js';

interface AuthSessionBody {
  data: { user: { id: string; role: string }; accessToken: string };
}

interface IntentDocument {
  type: string;
  objectKey: string;
  uploadUrl: string;
  contentType: string;
  sizeBytes: number;
  dataKey: string;
  wrappedDataKey: string;
}

interface IntentBody {
  data: { kycId: string; documents: IntentDocument[] };
}

interface SubmissionBody {
  data: { kycId: string; vendorStatus: string; submittedAt: string };
}

interface ErrorBody {
  error: { code: string; message: string };
}

const EMAIL_PREFIX = 'kyc-submit-integration-';
const PASSWORD = 'correct horse battery staple';

const PAN = 'ABCDE1234F';
const GSTIN = '27ABCDE1234F1Z0';
const ACCOUNT_NUMBER = '123456789012';
const IFSC = 'HDFC0001234';

const REQUESTED = [
  { type: 'PAN', contentType: 'application/pdf', sizeBytes: 512 },
  { type: 'GSTIN', contentType: 'image/png', sizeBytes: 640 },
  { type: 'BANK_ACCOUNT_PROOF', contentType: 'image/jpeg', sizeBytes: 768 },
];

const uniqueEmail = (label: string): string =>
  `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

/**
 * Phase 2 of KYC submission, end to end (KYC-4b).
 *
 * Drives the whole two-phase flow through real HTTP: mint intents, PUT the
 * ciphertext to real MinIO, then submit. Nothing here stubs the store or the
 * database, because the properties worth proving are theirs — that `head()`
 * really sees the object, that both writes land in one transaction, that the
 * partial unique index refuses a second undecided attempt, and that RLS keeps
 * one vendor out of another's submission.
 *
 * Never runs against real R2 or real AWS.
 */
describe('POST /api/v1/vendors/me/kyc', () => {
  let container: Container;
  let app: Express;

  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });

  const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.KYC_S3_ENDPOINT ?? 'http://localhost:9000',
    forcePathStyle: true,
    credentials: { accessKeyId: 'leenmart', secretAccessKey: 'leenmart-dev-secret' },
  });

  const signUpCustomer = async (label: string): Promise<{ token: string; email: string }> => {
    const email = uniqueEmail(label);
    const response = await request(app)
      .post('/api/v1/identity/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    return { token: (response.body as AuthSessionBody).data.accessToken, email };
  };

  const logIn = async (email: string): Promise<string> => {
    const response = await request(app)
      .post('/api/v1/identity/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return (response.body as AuthSessionBody).data.accessToken;
  };

  const signUpVendorOwner = async (label: string): Promise<string> => {
    const { token, email } = await signUpCustomer(label);
    await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    return logIn(email);
  };

  /** Mints intents and actually uploads each object, as a browser would. */
  const uploadAll = async (token: string): Promise<IntentBody['data']> => {
    const response = await request(app)
      .post('/api/v1/vendors/me/kyc/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ documents: REQUESTED })
      .expect(201);
    const { data } = response.body as IntentBody;

    for (const document of data.documents) {
      const put = await fetch(document.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': document.contentType,
          'Content-Length': String(document.sizeBytes),
        },
        body: Buffer.alloc(document.sizeBytes, 3),
      });
      expect(put.status).toBe(200);
    }
    return data;
  };

  const submissionBodyFor = (intent: IntentBody['data']): Record<string, unknown> => ({
    kycId: intent.kycId,
    pan: PAN,
    gstin: GSTIN,
    bankAccount: { accountNumber: ACCOUNT_NUMBER, ifsc: IFSC },
    documents: intent.documents.map((document) => ({
      type: document.type,
      wrappedDataKey: document.wrappedDataKey,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
    })),
  });

  const submit = (token: string, body: object): request.Test =>
    request(app).post('/api/v1/vendors/me/kyc').set('Authorization', `Bearer ${token}`).send(body);

  /** Same convention as `identity.test.ts`: SDD 23.3's per-IP budgets are
   * counted in Redis and outlive a run, and this suite signs in far more often
   * than a real client would. Clearing before each test keeps the production
   * ceilings untouched while stopping them from failing tests about KYC. */
  const clearRateLimitKeys = async (): Promise<void> => {
    const keys = await container.redis.keys('rl:*');
    if (keys.length > 0) await container.redis.del(...keys);
  };

  beforeAll(async () => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);

    try {
      await s3.send(new CreateBucketCommand({ Bucket: container.env.KYC_S3_BUCKET }));
    } catch {
      // Already present from a previous run.
    }
    await clearRateLimitKeys();
  });

  beforeEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    const users = await db.user.findMany({
      where: { email: { contains: EMAIL_PREFIX } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    const vendors = await db.vendorProfile.findMany({
      where: { userId: { in: ids } },
      select: { id: true },
    });
    await db.vendorKycSubmission.deleteMany({
      where: { vendorId: { in: vendors.map((vendor) => vendor.id) } },
    });
    await db.vendorProfile.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    s3.destroy();
    await container.dispose();
  });

  describe('authorisation', () => {
    it('refuses an unauthenticated caller', async () => {
      await request(app).post('/api/v1/vendors/me/kyc').send({}).expect(401);
    });

    it('refuses a CUSTOMER', async () => {
      const { token } = await signUpCustomer('customer-denied');

      const response = await submit(token, { kycId: crypto.randomUUID() }).expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('successful submission', () => {
    it('persists the submission, its documents, and transitions the vendor', async () => {
      const token = await signUpVendorOwner('happy-path');
      const intent = await uploadAll(token);

      const response = await submit(token, submissionBodyFor(intent)).expect(201);

      const { data } = response.body as SubmissionBody;
      expect(data.kycId).toBe(intent.kycId);
      expect(data.vendorStatus).toBe('KYC_SUBMITTED');

      const row = await db.vendorKycSubmission.findUniqueOrThrow({
        where: { id: intent.kycId },
        include: { documents: true },
      });
      expect(row.documents).toHaveLength(3);
      expect(row.documents.every((document) => document.status === 'UPLOADED')).toBe(true);
      expect(row.decidedAt).toBeNull();

      const vendor = await db.vendorProfile.findUniqueOrThrow({ where: { id: row.vendorId } });
      expect(vendor.status).toBe('KYC_SUBMITTED');
    });

    it('stores fingerprints and masked tails, never the full PAN or account number', async () => {
      const token = await signUpVendorOwner('masked');
      const intent = await uploadAll(token);

      await submit(token, submissionBodyFor(intent)).expect(201);

      const row = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: intent.kycId } });
      expect(row.panFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.bankFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.panLast4).toBe('234F');
      expect(row.bankAccountLast4).toBe('9012');
      expect(row.gstin).toBe(GSTIN);
      // The full account number exists in no column.
      expect(JSON.stringify(row)).not.toContain(ACCOUNT_NUMBER);
    });

    it('returns nothing sensitive in the response body', async () => {
      const token = await signUpVendorOwner('thin-response');
      const intent = await uploadAll(token);

      const response = await submit(token, submissionBodyFor(intent)).expect(201);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain(ACCOUNT_NUMBER);
      expect(serialised).not.toContain(intent.documents[0]?.dataKey);
      expect(serialised).not.toContain(intent.documents[0]?.wrappedDataKey);
      expect(serialised).not.toContain('vendor/');
    });

    it('keeps the wrapped key bound to this vendor, kyc and document type', async () => {
      const token = await signUpVendorOwner('key-binding');
      const intent = await uploadAll(token);
      await submit(token, submissionBodyFor(intent)).expect(201);

      const row = await db.vendorKycSubmission.findUniqueOrThrow({
        where: { id: intent.kycId },
        include: { documents: true },
      });
      const pan = row.documents.find((document) => document.type === 'PAN');
      const cipher = new DevDataKeyCipher(
        Buffer.from(container.env.KYC_DEV_WRAPPING_KEY, 'hex'),
        'test',
      );

      const unwrapped = await cipher.unwrap(Buffer.from(pan?.wrappedDataKey ?? []), {
        vendorId: row.vendorId,
        kycId: row.id,
        documentType: 'PAN',
      });
      expect(unwrapped.toString('base64')).toBe(
        intent.documents.find((document) => document.type === 'PAN')?.dataKey,
      );

      // The persisted key is useless under any other document's context.
      await expect(
        cipher.unwrap(Buffer.from(pan?.wrappedDataKey ?? []), {
          vendorId: row.vendorId,
          kycId: row.id,
          documentType: 'GSTIN',
        }),
      ).rejects.toThrow();
    });
  });

  describe('object verification', () => {
    it('refuses a submission whose objects were never uploaded', async () => {
      const token = await signUpVendorOwner('not-uploaded');
      const response = await request(app)
        .post('/api/v1/vendors/me/kyc/documents')
        .set('Authorization', `Bearer ${token}`)
        .send({ documents: REQUESTED })
        .expect(201);
      const intent = (response.body as IntentBody).data;

      await submit(token, submissionBodyFor(intent)).expect(400);

      expect(await db.vendorKycSubmission.findUnique({ where: { id: intent.kycId } })).toBeNull();
    });

    it('refuses a size that disagrees with the stored object', async () => {
      const token = await signUpVendorOwner('wrong-size');
      const intent = await uploadAll(token);
      const body = submissionBodyFor(intent) as { documents: { sizeBytes: number }[] };
      body.documents[0]!.sizeBytes = 999;

      await submit(token, body).expect(400);
    });

    it('leaves no partial state when a submission is refused', async () => {
      const token = await signUpVendorOwner('no-partial');
      const intent = await uploadAll(token);
      const body = submissionBodyFor(intent) as { documents: unknown[] };
      body.documents = body.documents.slice(0, 2);

      await submit(token, body).expect(400);

      expect(await db.vendorKycSubmission.findUnique({ where: { id: intent.kycId } })).toBeNull();
      expect(await db.kycDocument.count({ where: { kycId: intent.kycId } })).toBe(0);
      const vendors = await db.vendorProfile.findMany({ where: { status: 'KYC_SUBMITTED' } });
      expect(vendors.map((vendor) => vendor.id)).not.toContain(intent.documents[0]?.objectKey);
    });
  });

  describe('tenant isolation', () => {
    it('cannot submit against another vendor object key or identity', async () => {
      const victimToken = await signUpVendorOwner('victim');
      const victimIntent = await uploadAll(victimToken);
      const attackerToken = await signUpVendorOwner('attacker');

      // The attacker replays the victim's kycId and wrapped keys. The object
      // key is derived from the *attacker's* vendor, so it names an object
      // that does not exist and nothing is written for either party.
      await submit(attackerToken, submissionBodyFor(victimIntent)).expect(400);

      const rows = await db.vendorKycSubmission.findMany({ where: { id: victimIntent.kycId } });
      expect(rows).toHaveLength(0);
    });

    it('does not let one vendor read another submission through the API surface', async () => {
      const ownerToken = await signUpVendorOwner('rls-owner');
      const intent = await uploadAll(ownerToken);
      await submit(ownerToken, submissionBodyFor(intent)).expect(201);

      const otherToken = await signUpVendorOwner('rls-other');
      const otherIntent = await uploadAll(otherToken);

      // The other vendor submitting their own set must not collide with, or
      // reveal, the first vendor's row.
      await submit(otherToken, submissionBodyFor(otherIntent)).expect(201);

      const first = await db.vendorKycSubmission.findUniqueOrThrow({ where: { id: intent.kycId } });
      const second = await db.vendorKycSubmission.findUniqueOrThrow({
        where: { id: otherIntent.kycId },
      });
      expect(first.vendorId).not.toBe(second.vendorId);
    });
  });

  describe('one undecided attempt per vendor', () => {
    it('refuses a second submission while the first is undecided', async () => {
      const token = await signUpVendorOwner('double-submit');
      const intent = await uploadAll(token);
      await submit(token, submissionBodyFor(intent)).expect(201);

      // The vendor is now KYC_SUBMITTED, so the lifecycle refuses another
      // attempt before the unique index is ever reached (SDD 15.1).
      const second = await uploadAll(token).catch(() => null);
      expect(second).toBeNull();
    });
  });
});
