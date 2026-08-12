import type { PrismaClient } from '@prisma/client';
import { toVendorId } from '../../../identity/index.js';
import { toKycId, type KycId } from '../../domain/value-objects/kyc-id.value-object.js';
import type {
  KycReviewQueryPort,
  KycReviewQueuePage,
  KycReviewStatus,
  KycReviewSubmissionDetail,
} from '../../application/ports/kyc-review-query.port.js';

/**
 * The columns this query is allowed to read.
 *
 * Written as an explicit `select` rather than fetching the row: the same table
 * holds `pan_fingerprint`, `bank_fingerprint` and, on the documents,
 * `wrapped_data_key` and `object_key`. Naming what comes back means the
 * sensitive columns never enter the process, so no later mapping mistake can
 * publish them — as opposed to fetching everything and remembering to strip.
 */
const QUEUE_SELECT = {
  id: true,
  vendorId: true,
  panLast4: true,
  gstin: true,
  submittedAt: true,
  reviewedBy: true,
  startedAt: true,
  vendor: { select: { status: true } },
} as const;

const DETAIL_SELECT = {
  ...QUEUE_SELECT,
  bankAccountLast4: true,
  ifsc: true,
  decidedBy: true,
  decidedAt: true,
  rejectionReason: true,
  rejectionNote: true,
  documents: {
    select: {
      type: true,
      contentType: true,
      sizeBytes: true,
      status: true,
      uploadedAt: true,
    },
    orderBy: { type: 'asc' },
  },
} as const;

/**
 * The administrator's cross-tenant read path, on the `leenmart_admin`
 * credential (KYC-2B-1).
 *
 * **Constructed with `adminPrisma`, never the tenant-scoped client.** That is
 * the whole point of the separation: the vendor-facing client carries RLS
 * policies comparing `vendor_id` to `app.vendor_id`, so a queue query issued
 * through it would return one vendor's rows — or, with no tenant context, none
 * at all. This client's `SELECT` policies (`vendor_kyc_admin_read`,
 * `vendors_admin_read`, `kyc_documents_admin_read`) permit reading every
 * vendor, and it holds **no** `INSERT` or `DELETE` policy and no `BYPASSRLS`.
 *
 * The client also carries no tenant boundary extension, so these queries need
 * no `app.vendor_id` and open no transaction. Reads only — the port has no
 * write method to implement.
 */
export class PrismaKycReviewQuery implements KycReviewQueryPort {
  constructor(private readonly adminPrisma: PrismaClient) {}

  async listForReview(input: {
    statuses: readonly KycReviewStatus[];
    limit: number;
    cursor?: string | undefined;
  }): Promise<KycReviewQueuePage> {
    // One row beyond the page, so `hasMore` is an observation rather than a
    // second `count` query racing the first.
    const take = input.limit + 1;

    const rows = await this.adminPrisma.vendorKycSubmission.findMany({
      where: {
        // The lifecycle lives on `vendors` — `VendorKyc` deliberately carries
        // no status of its own (KYC-1) — so the filter reads through the
        // relation.
        vendor: { status: { in: [...input.statuses] } },
        // …and the submission itself must still be undecided. Without this a
        // vendor's earlier, already-decided attempts would surface alongside
        // the live one, because the vendor's *current* status says nothing
        // about which of their submissions it refers to.
        decidedAt: null,
      },
      select: QUEUE_SELECT,
      // Oldest first: a review queue that surfaced the newest submission first
      // would starve whoever has waited longest. `id` breaks ties so the order
      // is total and the keyset cursor below cannot skip or repeat a row.
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;

    return {
      items: page.map((row) => ({
        kycId: toKycId(row.id),
        vendorId: toVendorId(row.vendorId),
        vendorStatus: row.vendor.status as KycReviewStatus,
        panLast4: row.panLast4,
        gstin: row.gstin,
        submittedAt: row.submittedAt,
        reviewedBy: row.reviewedBy,
        startedAt: row.startedAt,
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async findDetailById(kycId: KycId): Promise<KycReviewSubmissionDetail | null> {
    const row = await this.adminPrisma.vendorKycSubmission.findUnique({
      where: { id: kycId },
      select: DETAIL_SELECT,
    });
    if (!row) {
      return null;
    }

    return {
      kycId: toKycId(row.id),
      vendorId: toVendorId(row.vendorId),
      vendorStatus: row.vendor.status as KycReviewStatus,
      panLast4: row.panLast4,
      gstin: row.gstin,
      bankAccountLast4: row.bankAccountLast4,
      ifsc: row.ifsc,
      submittedAt: row.submittedAt,
      reviewedBy: row.reviewedBy,
      startedAt: row.startedAt,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      rejectionReason: row.rejectionReason,
      rejectionNote: row.rejectionNote,
      documents: row.documents.map((document) => ({
        type: document.type,
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        status: document.status,
        uploadedAt: document.uploadedAt,
      })),
    };
  }
}
