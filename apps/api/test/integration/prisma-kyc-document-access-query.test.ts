import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { createContainer, type Container } from '../../src/container.js';
import { PrismaKycDocumentAccessQuery } from '../../src/modules/vendor/infrastructure/persistence/prisma-kyc-document-access-query.js';
import { toKycId } from '../../src/modules/vendor/domain/value-objects/kyc-id.value-object.js';
import { toKycDocumentId } from '../../src/modules/vendor/domain/value-objects/kyc-document-id.value-object.js';

/**
 * `PrismaKycDocumentAccessQuery`, proven against real PostgreSQL — including
 * that it runs on the real `leenmart_admin` credential (`container.adminPrisma`),
 * not a superuser connection that would demonstrate nothing about RLS.
 *
 * KYC-7 preparatory (Commit A): this is read-only infrastructure with no
 * caller yet. No route, controller, use case, presigned GET, or unwrap exists
 * to exercise — only the query itself.
 */
describe('PrismaKycDocumentAccessQuery', () => {
  let container: Container;
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
  const ids = new UuidV7Generator();
  const now = new Date('2026-03-01T00:00:00.000Z');

  const ownerAId = ids.generate();
  const ownerBId = ids.generate();
  const vendorAId = ids.generate();
  const vendorBId = ids.generate();
  const kycAId = ids.generate();
  const kycBId = ids.generate();
  const documentAId = ids.generate();
  const documentBId = ids.generate();
  const documentCId = ids.generate();
  const seededUserIds = [ownerAId, ownerBId];
  const seededVendorIds = [vendorAId, vendorBId];

  beforeAll(async () => {
    container = createContainer();

    await db.user.createMany({
      data: [
        {
          id: ownerAId,
          email: `kyc-doc-access-owner-a-${Date.now()}@leenmart.in`,
          passwordHash: 'not-used',
          role: 'CUSTOMER',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: ownerBId,
          email: `kyc-doc-access-owner-b-${Date.now()}@leenmart.in`,
          passwordHash: 'not-used',
          role: 'CUSTOMER',
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    await db.vendorProfile.createMany({
      data: [
        {
          id: vendorAId,
          userId: ownerAId,
          status: 'KYC_UNDER_REVIEW',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: vendorBId,
          userId: ownerBId,
          status: 'KYC_UNDER_REVIEW',
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    await db.vendorKycSubmission.createMany({
      data: [
        {
          id: kycAId,
          vendorId: vendorAId,
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
        {
          id: kycBId,
          vendorId: vendorBId,
          panFingerprint: 'c'.repeat(64),
          panLast4: '567G',
          gstin: '29ABCDE1234F1Z1',
          bankFingerprint: 'd'.repeat(64),
          bankAccountLast4: '3456',
          ifsc: 'ICIC0005678',
          submittedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    await db.kycDocument.createMany({
      data: [
        {
          id: documentAId,
          kycId: kycAId,
          vendorId: vendorAId,
          type: 'PAN',
          objectKey: `vendor/${vendorAId}/${kycAId}/PAN.enc`,
          wrappedDataKey: Buffer.from('wrapped-key-a'),
          contentType: 'application/pdf',
          sizeBytes: 2048,
          status: 'UPLOADED',
          uploadedAt: now,
          createdAt: now,
        },
        {
          id: documentBId,
          kycId: kycBId,
          vendorId: vendorBId,
          type: 'PAN',
          objectKey: `vendor/${vendorBId}/${kycBId}/PAN.enc`,
          wrappedDataKey: Buffer.from('wrapped-key-b'),
          contentType: 'application/pdf',
          sizeBytes: 2048,
          status: 'UPLOADED',
          uploadedAt: now,
          createdAt: now,
        },
        {
          id: documentCId,
          kycId: kycAId,
          vendorId: vendorAId,
          type: 'GSTIN',
          objectKey: `vendor/${vendorAId}/${kycAId}/GSTIN.enc`,
          wrappedDataKey: Buffer.from('wrapped-key-c'),
          contentType: 'application/pdf',
          sizeBytes: 2048,
          status: 'AWAITING_UPLOAD',
          uploadedAt: null,
          createdAt: now,
        },
      ],
    });
  });

  afterAll(async () => {
    await db.kycDocument.deleteMany({ where: { vendorId: { in: seededVendorIds } } });
    await db.vendorKycSubmission.deleteMany({ where: { vendorId: { in: seededVendorIds } } });
    await db.vendorProfile.deleteMany({ where: { id: { in: seededVendorIds } } });
    await db.user.deleteMany({ where: { id: { in: seededUserIds } } });
    await db.$disconnect();
    await container.dispose();
  });

  const query = (): PrismaKycDocumentAccessQuery =>
    new PrismaKycDocumentAccessQuery(container.adminPrisma);

  it('returns the document for a matching (kycId, documentId) pair', async () => {
    const record = await query().findForAccess(toKycId(kycAId), toKycDocumentId(documentAId));

    expect(record).not.toBeNull();
    expect(record?.id).toBe(documentAId);
    expect(record?.kycId).toBe(kycAId);
    expect(record?.vendorId).toBe(vendorAId);
    expect(record?.type).toBe('PAN');
    expect(record?.objectKey).toBe(`vendor/${vendorAId}/${kycAId}/PAN.enc`);
    expect(record?.wrappedDataKey.toString()).toBe('wrapped-key-a');
    expect(record?.status).toBe('UPLOADED');
  });

  it('reports AWAITING_UPLOAD for a document with no completed object', async () => {
    const record = await query().findForAccess(toKycId(kycAId), toKycDocumentId(documentCId));

    expect(record).not.toBeNull();
    expect(record?.status).toBe('AWAITING_UPLOAD');
  });

  it('returns null when the documentId belongs to a different kycId', async () => {
    // documentBId genuinely exists — just not under kycAId.
    const record = await query().findForAccess(toKycId(kycAId), toKycDocumentId(documentBId));

    expect(record).toBeNull();
  });

  it('returns null for a nonexistent document id', async () => {
    const record = await query().findForAccess(toKycId(kycAId), toKycDocumentId(ids.generate()));

    expect(record).toBeNull();
  });

  it('reads across tenants through the leenmart_admin credential', async () => {
    // One query instance, two different vendors' documents — proving the read
    // is not scoped to a single tenant the way the vendor-facing client is.
    const instance = query();

    const fromA = await instance.findForAccess(toKycId(kycAId), toKycDocumentId(documentAId));
    const fromB = await instance.findForAccess(toKycId(kycBId), toKycDocumentId(documentBId));

    expect(fromA?.vendorId).toBe(vendorAId);
    expect(fromB?.vendorId).toBe(vendorBId);
  });
});
