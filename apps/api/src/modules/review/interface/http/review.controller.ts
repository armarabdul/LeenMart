import type { Request, Response } from 'express';
import type {
  CreateReviewRequest,
  ListMyReviewsResponse,
  ReviewResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { Review } from '../../domain/entities/review.entity.js';
import { toOrderItemId } from '../../../order/index.js';
import type { CreateReviewUseCase } from '../../application/use-cases/create-review.use-case.js';
import type { ListMyReviewsUseCase } from '../../application/use-cases/list-my-reviews.use-case.js';

export interface ReviewController {
  readonly create: (req: Request, res: Response) => Promise<void>;
  readonly listMine: (req: Request, res: Response) => Promise<void>;
}

export interface ReviewControllerDeps {
  readonly createReviewUseCase: CreateReviewUseCase;
  readonly listMyReviewsUseCase: ListMyReviewsUseCase;
}

const requirePrincipal = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

/** Mapped field by field, never spread — the same reason every other `toResponse` in this codebase gives. */
const toReviewResponse = (review: Review): ReviewResponse => ({
  id: review.id,
  productId: review.productId,
  variantId: review.variantId,
  subOrderId: review.subOrderId,
  orderItemId: review.orderItemId,
  rating: review.rating,
  body: review.body,
  status: review.status,
  createdAt: review.createdAt.toISOString(),
  updatedAt: review.updatedAt.toISOString(),
});

/**
 * Thin HTTP adapter for the customer's own reviews (S8-REVIEWS). Parses
 * nothing itself, decides nothing, translates no errors — `validate()` and
 * the global error handler own those, mirroring `address.controller.ts`.
 */
export const createReviewController = (deps: ReviewControllerDeps): ReviewController => ({
  create: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'POST /me/reviews');
    const { body } = validatedData<CreateReviewRequest>(req);
    const review = await deps.createReviewUseCase.execute({
      principal,
      orderItemId: toOrderItemId(body.orderItemId),
      rating: body.rating,
      body: body.body,
    });
    res.status(201).json({ data: toReviewResponse(review), meta: { requestId: getRequestId() } });
  },

  listMine: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'GET /me/reviews');
    const reviews = await deps.listMyReviewsUseCase.execute({ principal });
    const data: ListMyReviewsResponse = reviews.map(toReviewResponse);
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },
});
