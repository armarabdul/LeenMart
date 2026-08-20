import type { Request, Response } from 'express';
import type {
  ListProductReviewsQuery,
  ListProductReviewsResponse,
  PublicReviewItem as PublicReviewItemDto,
  ProductReviewSummary as ProductReviewSummaryDto,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import { toProductId } from '../../../catalogue/index.js';
import type {
  ProductReviewSummary,
  PublicReviewItem,
} from '../../application/ports/public-review-query.port.js';
import type { ListProductReviewsUseCase } from '../../application/use-cases/list-product-reviews.use-case.js';

export interface PublicReviewController {
  readonly listForProduct: (req: Request, res: Response) => Promise<void>;
}

export interface PublicReviewControllerDeps {
  readonly listProductReviewsUseCase: ListProductReviewsUseCase;
}

const toItemDto = (item: PublicReviewItem): PublicReviewItemDto => ({
  id: item.id,
  rating: item.rating,
  body: item.body,
  createdAt: item.createdAt.toISOString(),
});

const toSummaryDto = (summary: ProductReviewSummary): ProductReviewSummaryDto => ({
  averageRating: summary.averageRating,
  approvedReviewCount: summary.approvedReviewCount,
});

/**
 * Thin HTTP adapter for the public, approved-only product reviews surface
 * (S8-REVIEWS). No authentication — mirrors `public-product.controller.ts`.
 */
export const createPublicReviewController = (
  deps: PublicReviewControllerDeps,
): PublicReviewController => ({
  listForProduct: async (req: Request, res: Response): Promise<void> => {
    const { query, params } = validatedData<
      unknown,
      ListProductReviewsQuery,
      { productId: string }
    >(req);

    const result = await deps.listProductReviewsUseCase.execute({
      productId: toProductId(params.productId),
      limit: query.limit,
      cursor: query.cursor,
    });

    const data: ListProductReviewsResponse = {
      summary: toSummaryDto(result.summary),
      items: result.items.map(toItemDto),
      nextCursor: result.nextCursor,
    };
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },
});
