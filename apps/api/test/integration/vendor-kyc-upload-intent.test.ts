import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

interface IntentBody {
  data: {
    kycId: string;
    expiresAt: string;
    documents: {
      type: string;
      objectKey: string;
      uploadUrl: string;
      contentType: string;
      sizeBytes: number;
      dataKey: string;
      wrappedDataKey: string;
    }[];
  };
}

interface ErrorBody {
  error: { code: string; message: string };
}

const EMAIL_PREFIX = 'kyc-intent-integration-';
const PASSWORD = 'correct horse battery staple';

const uniqueEmail = (label: string): string =>
  `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const REQUESTED = [
  { type: 'PAN', contentType: 'application/pdf', sizeBytes: 512 },
  { type: 'GSTIN', contentType: 'image/png', sizeBytes: 512 },
  { type: 'BANK_ACCOUNT_PROOF', contentType: 'image/jpeg', sizeBytes: 512 },
];

/**
 * Phase 1 of KYC submission, end to end (KYC-4a).
 *
 * Runs against the real MinIO from `infra/docker/docker-compose.yml` — the
 * same stand-in for R2 `s3-object-store.test.ts` already uses — because the
 * claims that matter here cannot be proved against a stub. That a presigned
 * URL *enforces* its content type and length, and that a wrapped key only
 * unwraps under the context it was bound to, are properties of the store and
 * the cipher, not of the object this API returned.
 *
 * Never runs against real R2 or real AWS.
 */
describe('POST /api/v1/vendors/me/kyc/documents', () => {
  let container: Container;
  let app: Express;

  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });

  const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.KYC_S3_ENDPOINT ?? 'http://localhost:9000',
    forcePathStyle: true,
    credentials: { accessKeyId: 'leenmart', secretAccessKey: 'leenmart-dev-secret' },
  });

  /** Registers a customer, then signs back in — registration revokes every session. */
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

  /** A vendor-owner token: register as customer, become a vendor, re-authenticate. */
  const signUpVendorOwner = async (label: string): Promise<string> => {
    const { token, email } = await signUpCustomer(label);
    await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    return logIn(email);
  };

  const requestIntents = (token: string, documents: unknown = REQUESTED): request.Test =>
    request(app)
      .post('/api/v1/vendors/me/kyc/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ documents });

  beforeAll(async () => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);

    try {
      await s3.send(new CreateBucketCommand({ Bucket: container.env.KYC_S3_BUCKET }));
    } catch {
      // Already there from a previous run — the only outcome that matters is
      // that the bucket exists.
    }
  });

  afterAll(async () => {
    const users = await db.user.findMany({
      where: { email: { contains: EMAIL_PREFIX } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    await db.vendorProfile.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    s3.destroy();
    await container.dispose();
  });

  describe('authorisation (SDD 7.4)', () => {
    it('refuses an unauthenticated caller', async () => {
      await request(app)
        .post('/api/v1/vendors/me/kyc/documents')
        .send({ documents: REQUESTED })
        .expect(401);
    });

    it('refuses a CUSTOMER — SDD 8.2 withholds SUBMIT_OR_EDIT_KYC from them', async () => {
      const { token } = await signUpCustomer('customer-denied');

      const response = await requestIntents(token).expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('allows a VENDOR_OWNER', async () => {
      const token = await signUpVendorOwner('owner-allowed');

      await requestIntents(token).expect(201);
    });
  });

  describe('minting', () => {
    it('returns three intents sharing one server-generated kycId', async () => {
      const token = await signUpVendorOwner('one-kyc-id');

      const response = await requestIntents(token).expect(201);

      const { data } = response.body as IntentBody;
      expect(data.documents).toHaveLength(3);
      expect(data.documents.map((document) => document.type).sort()).toEqual([
        'BANK_ACCOUNT_PROOF',
        'GSTIN',
        'PAN',
      ]);
      for (const document of data.documents) {
        expect(document.objectKey).toMatch(
          new RegExp(`^vendor/[0-9a-f-]{36}/${data.kycId}/${document.type}\\.enc$`),
        );
      }
    });

    it('ignores nothing and rejects a client-chosen object key (.strict)', async () => {
      const token = await signUpVendorOwner('strict-body');

      await request(app)
        .post('/api/v1/vendors/me/kyc/documents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          documents: [
            { ...REQUESTED[0], objectKey: 'vendor/someone-else/x/PAN.enc' },
            ...REQUESTED.slice(1),
          ],
        })
        .expect(400);
    });

    it('persists nothing — KYC-4a mints capability only', async () => {
      const token = await signUpVendorOwner('no-persistence');

      const response = await requestIntents(token).expect(201);

      const { data } = response.body as IntentBody;
      expect(await db.vendorKycSubmission.findUnique({ where: { id: data.kycId } })).toBeNull();
      expect(await db.kycDocument.count({ where: { kycId: data.kycId } })).toBe(0);
    });
  });

  describe('the presigned URL actually enforces its conditions', () => {
    it('accepts a PUT matching the signed content type and length', async () => {
      const token = await signUpVendorOwner('put-accepted');
      const { data } = (await requestIntents(token).expect(201)).body as IntentBody;
      const pan = data.documents.find((document) => document.type === 'PAN');

      const response = await fetch(pan?.uploadUrl ?? '', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': '512' },
        body: Buffer.alloc(512, 7),
      });

      expect(response.status).toBe(200);
    });

    it('rejects a PUT of a different length', async () => {
      const token = await signUpVendorOwner('put-wrong-length');
      const { data } = (await requestIntents(token).expect(201)).body as IntentBody;
      const pan = data.documents.find((document) => document.type === 'PAN');

      const response = await fetch(pan?.uploadUrl ?? '', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: Buffer.alloc(1024, 7),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a PUT of a different content type', async () => {
      const token = await signUpVendorOwner('put-wrong-type');
      const { data } = (await requestIntents(token).expect(201)).body as IntentBody;
      const pan = data.documents.find((document) => document.type === 'PAN');

      const response = await fetch(pan?.uploadUrl ?? '', {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'Content-Length': '512' },
        body: Buffer.alloc(512, 7),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('wrapped-key round trip (SDD 12.3)', () => {
    /** The same cipher the module built, reconstructed from the same env. */
    const cipher = (): DevDataKeyCipher =>
      new DevDataKeyCipher(Buffer.from(container.env.KYC_DEV_WRAPPING_KEY, 'hex'), 'test');

    it('unwraps to the plaintext key under the correct context', async () => {
      const token = await signUpVendorOwner('unwrap-ok');
      const { data } = (await requestIntents(token).expect(201)).body as IntentBody;
      const pan = data.documents.find((document) => document.type === 'PAN');
      const vendorId = pan?.objectKey.split('/')[1] ?? '';

      const unwrapped = await cipher().unwrap(Buffer.from(pan?.wrappedDataKey ?? '', 'base64'), {
        vendorId,
        kycId: data.kycId,
        documentType: 'PAN',
      });

      expect(unwrapped.toString('base64')).toBe(pan?.dataKey);
      expect(unwrapped).toHaveLength(32);
    });

    it('refuses to unwrap under a different documentType — the substitution defence', async () => {
      const token = await signUpVendorOwner('unwrap-mismatch');
      const { data } = (await requestIntents(token).expect(201)).body as IntentBody;
      const pan = data.documents.find((document) => document.type === 'PAN');
      const vendorId = pan?.objectKey.split('/')[1] ?? '';

      await expect(
        cipher().unwrap(Buffer.from(pan?.wrappedDataKey ?? '', 'base64'), {
          vendorId,
          kycId: data.kycId,
          documentType: 'GSTIN',
        }),
      ).rejects.toThrow();
    });
  });

  describe('lifecycle and request validation', () => {
    it('refuses an incomplete document set', async () => {
      const token = await signUpVendorOwner('incomplete-set');

      await requestIntents(token, REQUESTED.slice(0, 2)).expect(400);
    });

    it('refuses a file above the 10 MB cap', async () => {
      const token = await signUpVendorOwner('too-large');

      await requestIntents(token, [
        { ...REQUESTED[0], sizeBytes: 11 * 1024 * 1024 },
        ...REQUESTED.slice(1),
      ]).expect(400);
    });

    it('refuses a content type outside the allowlist', async () => {
      const token = await signUpVendorOwner('bad-type');

      await requestIntents(token, [
        { ...REQUESTED[0], contentType: 'image/svg+xml' },
        ...REQUESTED.slice(1),
      ]).expect(400);
    });
  });
});
