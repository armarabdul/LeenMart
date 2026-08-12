import type { Request, Response } from 'express';
import type {
  AdminKycQueueItem,
  AdminKycQueueQuery,
  AdminKycSubmissionDetail,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import { toKycId } from '../../domain/value-objects/kyc-id.value-object.js';
import type {
  KycReviewQueueItem,
  KycReviewSubmissionDetail,
} from '../../application/ports/kyc-review-query.port.js';
import type { GetKycReviewSubmissionUseCase } from '../../application/use-cases/get-kyc-review-submission.use-case.js';
import type { ListKycReviewQueueUseCase } from '../../application/use-cases/list-kyc-review-queue.use-case.js';

export interface AdminKycController {
  readonly listQueue: (req: Request, res: Response) => Promise<void>;
  readonly getSubmission: (req: Request, res: Response) => Promise<void>;
}

export interface AdminKycControllerDeps {
  readonly listKycReviewQueueUseCase: ListKycReviewQueueUseCase;
  readonly getKycReviewSubmissionUseCase: GetKycReviewSubmissionUseCase;
}

/**
 * Mapped field by field, never spread. The read model and the wire shape are
 * allowed to diverge, and a spread would publish whatever a future field is
 * called — which on this row would eventually mean a fingerprint or a wrapped
 * key.
 */
const toQueueItem = (item: KycReviewQueueItem): AdminKycQueueItem => ({
  kycId: item.kycId,
  vendorId: item.vendorId,
  vendorStatus: item.vendorStatus,
  panLast4: item.panLast4,
  gstin: item.gstin,
  submittedAt: item.submittedAt.toISOString(),
  reviewedBy: item.reviewedBy,
  startedAt: item.startedAt ? item.startedAt.toISOString() : null,
});

const toDetail = (detail: KycReviewSubmissionDetail): AdminKycSubmissionDetail => ({
  kycId: detail.kycId,
  vendorId: detail.vendorId,
  vendorStatus: detail.vendorStatus,
  panLast4: detail.panLast4,
  gstin: detail.gstin,
  bankAccountLast4: detail.bankAccountLast4,
  ifsc: detail.ifsc,
  submittedAt: detail.submittedAt.toISOString(),
  reviewedBy: detail.reviewedBy,
  startedAt: detail.startedAt ? detail.startedAt.toISOString() : null,
  decidedBy: detail.decidedBy,
  decidedAt: detail.decidedAt ? detail.decidedAt.toISOString() : null,
  rejectionReason: detail.rejectionReason as AdminKycSubmissionDetail['rejectionReason'],
  rejectionNote: detail.rejectionNote,
  documents: detail.documents.map((document) => ({
    type: document.type as AdminKycSubmissionDetail['documents'][number]['type'],
    contentType:
      document.contentType as AdminKycSubmissionDetail['documents'][number]['contentType'],
    sizeBytes: document.sizeBytes,
    status: document.status,
    uploadedAt: document.uploadedAt ? document.uploadedAt.toISOString() : null,
  })),
});

/**
 * Thin HTTP adapter for the admin review queue. Parses nothing itself, decides
 * nothing, and translates no errors — `validate()` and the global error handler
 * own those (SDD 17.1).
 *
 * Both handlers are `GET` and neither writes: opening the queue or a submission
 * must leave every row exactly as it was, so that reading a submission is not
 * the same act as claiming it (KYC-5 Commit 3).
 */
export const createAdminKycController = (deps: AdminKycControllerDeps): AdminKycController => ({
  listQueue: async (req: Request, res: Response): Promise<void> => {
    const { query } = validatedData<unknown, AdminKycQueueQuery>(req);

    const page = await deps.listKycReviewQueueUseCase.execute({
      statuses: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });

    res.status(200).json({
      data: page.items.map(toQueueItem),
      // The platform's existing pagination envelope (SDD 9.3), not a shape
      // invented here.
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  },

  getSubmission: async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { kycId: string }>(req);

    const submission = await deps.getKycReviewSubmissionUseCase.execute({
      kycId: toKycId(params.kycId),
    });

    res.status(200).json({ data: toDetail(submission), meta: { requestId: getRequestId() } });
  },
});
