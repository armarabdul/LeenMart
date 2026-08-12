import type { KycId } from '../../domain/value-objects/kyc-id.value-object.js';
import type { VendorId } from '../../../identity/index.js';

/** The KYC phase of SDD 15.1's vendor lifecycle — the only states this queue reads. */
export type KycReviewStatus =
  | 'KYC_SUBMITTED'
  | 'KYC_UNDER_REVIEW'
  | 'KYC_APPROVED'
  | 'KYC_REJECTED';

/** One queue row: enough to triage, nothing more. */
export interface KycReviewQueueItem {
  readonly kycId: KycId;
  readonly vendorId: VendorId;
  readonly vendorStatus: KycReviewStatus;
  readonly panLast4: string;
  readonly gstin: string;
  readonly submittedAt: Date;
  readonly reviewedBy: string | null;
  readonly startedAt: Date | null;
}

export interface KycReviewDocument {
  readonly type: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: 'AWAITING_UPLOAD' | 'UPLOADED';
  readonly uploadedAt: Date | null;
}

/**
 * One submission in full, as a reviewer sees it.
 *
 * Note what this read model does **not** carry: no `wrappedDataKey`, no
 * `panFingerprint`/`bankFingerprint`, no `objectKey`. Those columns exist on
 * the row and are simply not selected — the omission lives here, in the shape
 * the application layer is allowed to hold, so a later mapping mistake cannot
 * publish something the query never fetched.
 */
export interface KycReviewSubmissionDetail {
  readonly kycId: KycId;
  readonly vendorId: VendorId;
  readonly vendorStatus: KycReviewStatus;
  readonly panLast4: string;
  readonly gstin: string;
  readonly bankAccountLast4: string;
  readonly ifsc: string;
  readonly submittedAt: Date;
  readonly reviewedBy: string | null;
  readonly startedAt: Date | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly rejectionReason: string | null;
  readonly rejectionNote: string | null;
  readonly documents: readonly KycReviewDocument[];
}

export interface KycReviewQueuePage {
  readonly items: readonly KycReviewQueueItem[];
  /** The cursor to pass for the next page, or `null` at the end. */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * The administrator's read-only view of KYC submissions, **across every
 * vendor**.
 *
 * A separate port from `VendorKycRepository` rather than more methods on it,
 * because the two answer to different authorities. That repository is
 * tenant-scoped: every query it issues runs on the vendor-facing credential
 * under RLS policies that compare `vendor_id` to the caller's own. This one is
 * deliberately cross-tenant and runs on `leenmart_admin`, a separate
 * credential whose `SELECT` policies permit reading every vendor's rows. Fusing
 * them would put a method on the vendor repository that vendor-facing code
 * must never call, and the only thing preventing that call would be a comment.
 *
 * **Read-only by construction.** There is no `create`, `update`, `saveReview`,
 * `startReview`, `approve` or `reject` here, and there will not be: claiming
 * and deciding are KYC-5 Commit 3's, and they run through the domain aggregate
 * and `VendorKycRepository`, not through a query port.
 */
export interface KycReviewQueryPort {
  /**
   * The review queue, oldest submission first.
   *
   * FIFO because a review queue that surfaced the newest first would starve
   * the vendor who has waited longest — the opposite of what SDD 15.2's
   * concern about reviewer throughput wants.
   *
   * `cursor` is the `kycId` of the last row of the previous page. Opaque to
   * the caller, and keyset rather than offset (SDD 9.2), so a submission
   * arriving mid-pagination cannot shift rows onto a page already read.
   */
  listForReview(input: {
    statuses: readonly KycReviewStatus[];
    limit: number;
    cursor?: string | undefined;
  }): Promise<KycReviewQueuePage>;

  /** One submission by id, whatever its lifecycle state. `null` when absent. */
  findDetailById(kycId: KycId): Promise<KycReviewSubmissionDetail | null>;
}
