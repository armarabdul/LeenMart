import type { Request, Response } from 'express';
import type {
  AdminKycDocumentAccessResponse,
  AdminKycQueueItem,
  AdminKycQueueQuery,
  AdminKycSubmissionDetail,
  DecideVendorKycRequest,
  DecideVendorKycResponse,
  StartKycReviewResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import { toKycDocumentId } from '../../domain/value-objects/kyc-document-id.value-object.js';
import { toKycId } from '../../domain/value-objects/kyc-id.value-object.js';
import type { VendorKyc } from '../../domain/entities/vendor-kyc.entity.js';
import type {
  KycReviewQueueItem,
  KycReviewSubmissionDetail,
} from '../../application/ports/kyc-review-query.port.js';
import type {
  AccessKycDocumentResult,
  AccessKycDocumentUseCase,
} from '../../application/use-cases/access-kyc-document.use-case.js';
import type { GetKycReviewSubmissionUseCase } from '../../application/use-cases/get-kyc-review-submission.use-case.js';
import type { ListKycReviewQueueUseCase } from '../../application/use-cases/list-kyc-review-queue.use-case.js';
import type { StartKycReviewUseCase } from '../../application/use-cases/start-kyc-review.use-case.js';
import type { DecideVendorKycUseCase } from '../../application/use-cases/decide-vendor-kyc.use-case.js';

export interface AdminKycController {
  readonly listQueue: (req: Request, res: Response) => Promise<void>;
  readonly getSubmission: (req: Request, res: Response) => Promise<void>;
  readonly startReview: (req: Request, res: Response) => Promise<void>;
  readonly decide: (req: Request, res: Response) => Promise<void>;
  readonly accessDocument: (req: Request, res: Response) => Promise<void>;
}

export interface AdminKycControllerDeps {
  readonly listKycReviewQueueUseCase: ListKycReviewQueueUseCase;
  readonly getKycReviewSubmissionUseCase: GetKycReviewSubmissionUseCase;
  readonly startKycReviewUseCase: StartKycReviewUseCase;
  readonly decideVendorKycUseCase: DecideVendorKycUseCase;
  readonly accessKycDocumentUseCase: AccessKycDocumentUseCase;
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
 * The review is present on both paths: the use cases return an aggregate that
 * carries one or they throw. Reading it once, here, keeps that assumption in a
 * single place rather than as a fallback value at each field.
 */
const reviewOf = (kyc: VendorKyc): NonNullable<VendorKyc['review']> => {
  const { review } = kyc;
  if (!review) {
    throw new Error(`KYC ${kyc.id} came back from a review operation without a review.`);
  }
  return review;
};

const toReviewResponse = (kyc: VendorKyc): StartKycReviewResponse => {
  const review = reviewOf(kyc);
  return {
    kycId: kyc.id,
    vendorStatus: 'KYC_UNDER_REVIEW',
    reviewedBy: review.reviewedBy,
    startedAt: review.startedAt.toISOString(),
  };
};

const toDecisionResponse = (
  kyc: VendorKyc,
  vendorStatus: DecideVendorKycResponse['vendorStatus'],
): DecideVendorKycResponse => {
  const review = reviewOf(kyc);
  return {
    kycId: kyc.id,
    vendorStatus,
    decidedBy: review.decidedBy ?? '',
    decidedAt: (review.decidedAt ?? review.startedAt).toISOString(),
    rejectionReason:
      (review.rejectionReason?.name as DecideVendorKycResponse['rejectionReason']) ?? null,
    rejectionNote: review.rejectionNote,
  };
};

/** Mapped field by field, for the same reason `toQueueItem`/`toDetail` are. */
const toDocumentAccessResponse = (
  result: AccessKycDocumentResult,
): AdminKycDocumentAccessResponse => ({
  kycId: result.kycId,
  documentId: result.documentId,
  type: result.type as AdminKycDocumentAccessResponse['type'],
  url: result.url,
  expiresAt: result.expiresAt.toISOString(),
});

/** Narrows the wire union to the use case's command; the two shapes are deliberately separate. */
const toDecisionCommand = (
  body: DecideVendorKycRequest,
): { decision: 'APPROVE' } | { decision: 'REJECT'; reason: string; note?: string | undefined } =>
  body.decision === 'APPROVE'
    ? { decision: 'APPROVE' }
    : { decision: 'REJECT', reason: body.reason, note: body.note };

/** Split out of `createAdminKycController` purely to stay under this file's max-lines-per-function budget. */
const createAccessDocumentHandler =
  (accessKycDocumentUseCase: AccessKycDocumentUseCase): AdminKycController['accessDocument'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /admin/kyc/submissions/:kycId/documents/:documentId reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { kycId: string; documentId: string }>(req);

    const result = await accessKycDocumentUseCase.execute({
      principal: req.principal,
      kycId: toKycId(params.kycId),
      documentId: toKycDocumentId(params.documentId),
    });

    res
      .status(200)
      .json({ data: toDocumentAccessResponse(result), meta: { requestId: getRequestId() } });
  };

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

  startReview: async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /admin/kyc/submissions/:kycId/review reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { kycId: string }>(req);

    const { kyc } = await deps.startKycReviewUseCase.execute({
      principal: req.principal,
      kycId: toKycId(params.kycId),
    });

    res.status(200).json({ data: toReviewResponse(kyc), meta: { requestId: getRequestId() } });
  },

  decide: async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /admin/kyc/submissions/:kycId/decision reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { body, params } = validatedData<DecideVendorKycRequest, unknown, { kycId: string }>(req);

    const { kyc, vendor } = await deps.decideVendorKycUseCase.execute({
      principal: req.principal,
      kycId: toKycId(params.kycId),
      command: toDecisionCommand(body),
    });

    res.status(200).json({
      data: toDecisionResponse(kyc, vendor.status.name),
      meta: { requestId: getRequestId() },
    });
  },

  getSubmission: async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { kycId: string }>(req);

    const submission = await deps.getKycReviewSubmissionUseCase.execute({
      kycId: toKycId(params.kycId),
    });

    res.status(200).json({ data: toDetail(submission), meta: { requestId: getRequestId() } });
  },

  accessDocument: createAccessDocumentHandler(deps.accessKycDocumentUseCase),
});
