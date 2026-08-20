import type { Request, Response } from 'express';
import type {
  AdminReviewQueueItem,
  AdminReviewQueueQuery,
  DecideReviewModerationRequest,
  DecideReviewModerationResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { Review } from '../../domain/entities/review.entity.js';
import { toReviewId } from '../../domain/value-objects/review-id.value-object.js';
import type { DecideReviewModerationUseCase } from '../../application/use-cases/decide-review-moderation.use-case.js';
import type { ListReviewModerationQueueUseCase } from '../../application/use-cases/list-review-moderation-queue.use-case.js';

export interface AdminReviewController {
  readonly listQueue: (req: Request, res: Response) => Promise<void>;
  readonly decide: (req: Request, res: Response) => Promise<void>;
}

export interface AdminReviewControllerDeps {
  readonly listReviewModerationQueueUseCase: ListReviewModerationQueueUseCase;
  readonly decideReviewModerationUseCase: DecideReviewModerationUseCase;
}

/** Mapped field by field, never spread — the same reason `admin-product.controller.ts`'s own `toQueueItem` gives. */
const toQueueItem = (review: Review): AdminReviewQueueItem => ({
  id: review.id,
  customerId: review.customerId,
  productId: review.productId,
  variantId: review.variantId,
  rating: review.rating,
  body: review.body,
  status: review.status,
  createdAt: review.createdAt.toISOString(),
  updatedAt: review.updatedAt.toISOString(),
});

const toDecisionResponse = (review: Review): DecideReviewModerationResponse => ({
  id: review.id,
  status: review.status,
  updatedAt: review.updatedAt.toISOString(),
});

/**
 * Thin HTTP adapter for the admin review moderation surface (S8-REVIEWS).
 * Parses nothing itself, decides nothing, translates no errors — mirrors
 * `admin-product.controller.ts` exactly.
 */
export const createAdminReviewController = (
  deps: AdminReviewControllerDeps,
): AdminReviewController => ({
  listQueue: async (req: Request, res: Response): Promise<void> => {
    const { query } = validatedData<unknown, AdminReviewQueueQuery>(req);

    const page = await deps.listReviewModerationQueueUseCase.execute({
      statuses: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });

    res.status(200).json({
      data: page.items.map(toQueueItem),
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  },

  decide: async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /admin/reviews/:reviewId/decision reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { body, params } = validatedData<
      DecideReviewModerationRequest,
      unknown,
      { reviewId: string }
    >(req);

    const { review } = await deps.decideReviewModerationUseCase.execute({
      principal: req.principal,
      reviewId: toReviewId(params.reviewId),
      decision: body.decision,
    });

    res.status(200).json({ data: toDecisionResponse(review), meta: { requestId: getRequestId() } });
  },
});
