import { Router } from 'express';
import { z } from 'zod';
import { listProductReviewsQuerySchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { PublicReviewController } from './public-review.controller.js';

const productParamsSchema = z.object({ productId: z.string().uuid() }).strict();

/**
 * Mounted at `/api/v1/catalogue`, alongside `publicProductRouter` (S8-REVIEWS)
 * — a product's own reviews live under its own URL namespace, the natural
 * existing shape (`GET /api/v1/catalogue/products/:productId/reviews`),
 * without coupling `catalogue`'s tested detail endpoint to a module it
 * otherwise never touches. Same unauthenticated, tenant-free public surface
 * as `public-product.routes.ts`, on `publicPrisma` — `reviews_public_read`
 * (20260820180000) is what confines it to `APPROVED` rows regardless of
 * caller.
 */
export const createPublicReviewRouter = (controller: PublicReviewController): Router => {
  const router = Router();

  router.get(
    '/products/:productId/reviews',
    validate({ params: productParamsSchema, query: listProductReviewsQuerySchema }),
    asyncHandler(controller.listForProduct),
  );

  return router;
};
