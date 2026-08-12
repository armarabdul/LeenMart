import type { PrismaClient } from '@prisma/client';
import { toVendorId } from '../../../identity/index.js';
import {
  toKycDocumentId,
  type KycDocumentId,
} from '../../domain/value-objects/kyc-document-id.value-object.js';
import { toKycId, type KycId } from '../../domain/value-objects/kyc-id.value-object.js';
import type {
  KycDocumentAccessQueryPort,
  KycDocumentAccessRecord,
} from '../../application/ports/kyc-document-access-query.port.js';

/**
 * The columns this query is allowed to read.
 *
 * Written as an explicit `select`, the same convention `PrismaKycReviewQuery`
 * uses and for the same reason: naming what comes back means every other
 * column on the row — including nothing sensitive here, since this port's
 * whole purpose is to carry `wrappedDataKey`/`objectKey` — is still a
 * deliberate choice rather than whatever `findFirst` happens to fetch.
 */
const ACCESS_SELECT = {
  id: true,
  kycId: true,
  vendorId: true,
  type: true,
  objectKey: true,
  wrappedDataKey: true,
} as const;

/**
 * The administrator's cross-tenant read path to one document's location and
 * wrapped key, on the `leenmart_admin` credential (KYC-2B-1) — mirrors
 * `PrismaKycReviewQuery` exactly: constructed on `adminPrisma`, never the
 * tenant-scoped client, and read-only (no write method to implement).
 *
 * `findFirst` on `{ id, kycId }` rather than `findUnique` on `id` alone: the
 * table's only unique constraints are `id` and `(kycId, type)`, neither of
 * which is the `(kycId, documentId)` pair a caller actually has, and filtering
 * on both is what makes a document id that belongs to a *different*
 * submission resolve to `null` instead of quietly returning it.
 */
export class PrismaKycDocumentAccessQuery implements KycDocumentAccessQueryPort {
  constructor(private readonly adminPrisma: PrismaClient) {}

  async findForAccess(
    kycId: KycId,
    documentId: KycDocumentId,
  ): Promise<KycDocumentAccessRecord | null> {
    const row = await this.adminPrisma.kycDocument.findFirst({
      where: { id: documentId, kycId },
      select: ACCESS_SELECT,
    });
    if (!row) {
      return null;
    }

    return {
      id: toKycDocumentId(row.id),
      kycId: toKycId(row.kycId),
      vendorId: toVendorId(row.vendorId),
      type: row.type,
      objectKey: row.objectKey,
      wrappedDataKey: Buffer.from(row.wrappedDataKey),
    };
  }
}
