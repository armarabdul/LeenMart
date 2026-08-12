import type { Logger } from '@leen-mart/domain-kit';
import { KycSubmissionNotFoundError } from '../../domain/errors/kyc-errors.js';
import type { KycId } from '../../domain/value-objects/kyc-id.value-object.js';
import type {
  KycReviewQueryPort,
  KycReviewSubmissionDetail,
} from '../ports/kyc-review-query.port.js';

export interface GetKycReviewSubmissionInput {
  readonly kycId: KycId;
}

export interface GetKycReviewSubmissionDeps {
  readonly kycReviewQuery: KycReviewQueryPort;
  readonly logger: Logger;
}

/**
 * One KYC submission, as the reviewing administrator sees it (SDD 15.1).
 *
 * Read-only. Opening a submission is not claiming it — `startReview` is a
 * distinct, deliberate act that belongs to KYC-5 Commit 3, and a reviewer who
 * merely looks must not find they have taken ownership of it.
 *
 * Not scoped to a vendor, by design: this is the cross-tenant admin path, and
 * the authority for it is the `leenmart_admin` credential's SELECT policies
 * plus `requirePermission` at the edge — not a tenant context, which these
 * routes deliberately never establish.
 */
export class GetKycReviewSubmissionUseCase {
  constructor(private readonly deps: GetKycReviewSubmissionDeps) {}

  async execute(input: GetKycReviewSubmissionInput): Promise<KycReviewSubmissionDetail> {
    const { kycReviewQuery, logger } = this.deps;

    const submission = await kycReviewQuery.findDetailById(input.kycId);
    if (!submission) {
      throw new KycSubmissionNotFoundError();
    }

    // The kyc id only. A reviewer reading a submission is expected; recording
    // *which vendor* they read, on every read, would accumulate a browsing
    // history of tenants in log storage. Auditing this access properly is
    // KYC-6's, against the audit log rather than the application log.
    logger.info({ kycId: input.kycId }, 'Admin KYC submission read');

    return submission;
  }
}
