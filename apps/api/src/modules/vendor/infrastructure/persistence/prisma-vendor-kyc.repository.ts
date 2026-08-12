import { runInTenantTransaction } from '../../../../shared/infrastructure/persistence/tenant-prisma.js';
import type { PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { toUserId, toVendorId, type VendorId } from '../../../identity/index.js';
import { KycDocument } from '../../domain/entities/kyc-document.entity.js';
import { VendorKyc, type KycReview } from '../../domain/entities/vendor-kyc.entity.js';
import type { VendorKycRepository } from '../../domain/repositories/vendor-kyc.repository.js';
import { KycDocumentType } from '../../domain/value-objects/kyc-document-type.value-object.js';
import {
  KycRejectionReason,
  type KycRejectionReasonName,
} from '../../domain/value-objects/kyc-rejection-reason.value-object.js';
import { toKycDocumentId } from '../../domain/value-objects/kyc-document-id.value-object.js';
import { toKycId, type KycId } from '../../domain/value-objects/kyc-id.value-object.js';
import type { SensitiveFingerprint } from '../../domain/value-objects/sensitive-fingerprint.value-object.js';

interface DocumentRow {
  readonly id: string;
  readonly type: string;
  readonly objectKey: string;
  readonly wrappedDataKey: Buffer | Uint8Array;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly uploadedAt: Date | null;
  readonly createdAt: Date;
}

interface SubmissionRow {
  readonly id: string;
  readonly vendorId: string;
  readonly panFingerprint: string;
  readonly panLast4: string;
  readonly gstin: string;
  readonly bankFingerprint: string;
  readonly bankAccountLast4: string;
  readonly ifsc: string;
  readonly reviewedBy: string | null;
  readonly startedAt: Date | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly rejectionReason: string | null;
  readonly rejectionNote: string | null;
  readonly submittedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly documents: readonly DocumentRow[];
}

const toDocument = (row: DocumentRow): KycDocument =>
  KycDocument.reconstitute({
    id: toKycDocumentId(row.id),
    type: KycDocumentType.fromName(row.type),
    objectKey: row.objectKey,
    // Prisma hands back a Buffer for BYTEA, but the width of that promise
    // differs across driver versions; normalising here keeps `KycDocument`
    // holding the Buffer its contract says it holds.
    wrappedDataKey: Buffer.from(row.wrappedDataKey),
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status === 'UPLOADED' ? 'UPLOADED' : 'AWAITING_UPLOAD',
    uploadedAt: row.uploadedAt,
    createdAt: row.createdAt,
  });

/**
 * `reviewed_by`/`started_at` move together and `decided_by`/`decided_at` move
 * together — both pairs are held to that by CHECK constraints — so the
 * reviewer alone decides whether there is a review to rebuild at all.
 */
const toReview = (row: SubmissionRow): KycReview | null => {
  if (!row.reviewedBy || !row.startedAt) {
    return null;
  }
  return {
    reviewedBy: toUserId(row.reviewedBy),
    startedAt: row.startedAt,
    decidedBy: row.decidedBy ? toUserId(row.decidedBy) : null,
    decidedAt: row.decidedAt,
    rejectionReason: row.rejectionReason ? KycRejectionReason.fromName(row.rejectionReason) : null,
    rejectionNote: row.rejectionNote,
  };
};

const toDomain = (row: SubmissionRow): VendorKyc =>
  VendorKyc.reconstitute({
    id: toKycId(row.id),
    vendorId: toVendorId(row.vendorId),
    identifiers: {
      panFingerprint: row.panFingerprint as SensitiveFingerprint,
      panLast4: row.panLast4,
      gstin: row.gstin,
      bankFingerprint: row.bankFingerprint as SensitiveFingerprint,
      bankAccountLast4: row.bankAccountLast4,
      ifsc: row.ifsc,
    },
    documents: row.documents.map(toDocument),
    review: toReview(row),
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/**
 * The six review columns, typed explicitly so a renamed or mistyped column is
 * a compile error rather than a silently ignored key in Prisma's `data`.
 */
interface ReviewColumns {
  readonly reviewedBy: string | null;
  readonly startedAt: Date | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly rejectionReason: KycRejectionReasonName | null;
  readonly rejectionNote: string | null;
}

/**
 * The review columns for a submission nobody has claimed. Named rather than
 * inlined so "no review" is one branch instead of six independent
 * null-coalescings, each of which could drift from the others.
 */
const NO_REVIEW_COLUMNS: ReviewColumns = {
  reviewedBy: null,
  startedAt: null,
  decidedBy: null,
  decidedAt: null,
  rejectionReason: null,
  rejectionNote: null,
};

const toReviewColumns = (review: KycReview | null): ReviewColumns =>
  review === null
    ? NO_REVIEW_COLUMNS
    : {
        reviewedBy: review.reviewedBy,
        startedAt: review.startedAt,
        decidedBy: review.decidedBy,
        decidedAt: review.decidedAt,
        rejectionReason: review.rejectionReason?.name ?? null,
        rejectionNote: review.rejectionNote,
      };

/** Documents come back in a stable order so a round trip compares equal. */
const INCLUDE_DOCUMENTS = { documents: { orderBy: { type: 'asc' } } } as const;

/** Maps rows to `VendorKyc`; Prisma types never escape this file (SDD 3.4). */
export class PrismaVendorKycRepository implements VendorKycRepository {
  /**
   * @param inCallerTransaction True only for an instance produced by
   * `withTransaction`, meaning `prisma` is already a transaction client whose
   * connection carries the tenant GUCs. Private to this file — the only way to
   * set it is to hand over a `TransactionScope`, which only
   * `TransactionRunner.run` can produce.
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly inCallerTransaction = false,
  ) {}

  /**
   * Unwraps the opaque scope back into the Prisma transaction client it
   * actually is, exactly as `PrismaVendorRepository.withTransaction` does. The
   * cast is confined to this layer: the port cannot name `PrismaClient`
   * (SDD 2.3), and a `TransactionScope` can only come from
   * `TransactionRunner.run`, so nothing else can fabricate one.
   */
  withTransaction(scope: TransactionScope): VendorKycRepository {
    return new PrismaVendorKycRepository(scope as unknown as PrismaClient, true);
  }

  /**
   * One transaction, because a submission without its documents is not a
   * submission — the aggregate refuses to exist in that shape, and the
   * database should not hold it either.
   *
   * Where that transaction comes from depends on how this repository was
   * built. Unscoped, it opens its own via `runInTenantTransaction` — not a
   * bare `$transaction`, because both models here are tenant-scoped and only
   * the sanctioned helper sets `app.vendor_id` on the pinned connection these
   * statements actually run on.
   *
   * Scoped, it opens **nothing** and writes straight to the caller's
   * transaction client. Opening one here would be a nested `$transaction`,
   * which acquires a *different* connection — one the outer transaction never
   * configured — so RLS would see no `app.vendor_id` and return zero rows
   * rather than failing, and a small pool would deadlock waiting for the
   * connection the outer transaction is still holding (`tenant-prisma.ts`).
   */
  async create(kyc: VendorKyc): Promise<void> {
    if (this.inCallerTransaction) {
      await this.writeSubmission(this.prisma, kyc);
      return;
    }
    await runInTenantTransaction(this.prisma, (tx) => this.writeSubmission(tx, kyc));
  }

  /** The two statements themselves, identical on both paths — only the client differs. */
  private async writeSubmission(tx: PrismaClient, kyc: VendorKyc): Promise<void> {
    await tx.vendorKycSubmission.create({
      data: {
        id: kyc.id,
        vendorId: kyc.vendorId,
        panFingerprint: kyc.identifiers.panFingerprint,
        panLast4: kyc.identifiers.panLast4,
        gstin: kyc.identifiers.gstin,
        bankFingerprint: kyc.identifiers.bankFingerprint,
        bankAccountLast4: kyc.identifiers.bankAccountLast4,
        ifsc: kyc.identifiers.ifsc,
        submittedAt: kyc.submittedAt,
        createdAt: kyc.createdAt,
        updatedAt: kyc.updatedAt,
      },
    });

    await tx.kycDocument.createMany({
      data: kyc.documents.map((document) => ({
        id: document.id,
        kycId: kyc.id,
        // Denormalised, then held to the parent by the composite foreign
        // key — it cannot be written to a different vendor than the
        // submission it hangs off.
        vendorId: kyc.vendorId,
        type: document.type.name,
        objectKey: document.objectKey,
        wrappedDataKey: document.wrappedDataKey,
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        status: document.status,
        uploadedAt: document.uploadedAt,
        createdAt: document.createdAt,
      })),
    });
  }

  async findById(id: KycId): Promise<VendorKyc | null> {
    const row = await this.prisma.vendorKycSubmission.findUnique({
      where: { id },
      include: INCLUDE_DOCUMENTS,
    });
    return row ? toDomain(row) : null;
  }

  async findCurrentByVendorId(vendorId: VendorId): Promise<VendorKyc | null> {
    const row = await this.prisma.vendorKycSubmission.findFirst({
      where: { vendorId, decidedAt: null },
      include: INCLUDE_DOCUMENTS,
    });
    return row ? toDomain(row) : null;
  }

  async listByVendorId(vendorId: VendorId): Promise<VendorKyc[]> {
    const rows = await this.prisma.vendorKycSubmission.findMany({
      where: { vendorId },
      include: INCLUDE_DOCUMENTS,
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  /** Review columns only — everything else about a submission is immutable. */
  async saveReview(kyc: VendorKyc): Promise<void> {
    await this.prisma.vendorKycSubmission.update({
      where: { id: kyc.id },
      data: { ...toReviewColumns(kyc.review), updatedAt: kyc.updatedAt },
    });
  }

  async findByIdentifierFingerprints(input: {
    vendorId: VendorId;
    panFingerprint: SensitiveFingerprint;
    bankFingerprint: SensitiveFingerprint;
  }): Promise<VendorKyc[]> {
    const rows = await this.prisma.vendorKycSubmission.findMany({
      where: {
        vendorId: { not: input.vendorId },
        OR: [{ panFingerprint: input.panFingerprint }, { bankFingerprint: input.bankFingerprint }],
      },
      include: INCLUDE_DOCUMENTS,
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(toDomain);
  }
}
