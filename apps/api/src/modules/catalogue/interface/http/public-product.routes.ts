import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { PublicProductController } from './public-product.controller.js';

const productParamsSchema = z.object({ id: z.string().uuid() }).strict();

/**
 * Mounted at `/api/v1/catalogue`, alongside `publicCategoryRouter` — the same
 * unauthenticated, tenant-free public surface (SDD 9.4). Unlike `Category`,
 * `Product`/`ProductVariant`/`Inventory` are tenant-scoped, so this route
 * runs on `publicPrisma` (`leenmart_public`) rather than the ordinary
 * client — `products_public_read` (S2-7) and
 * `product_variants_public_read`/`inventory_public_read` (S3-1) are what
 * confine it to APPROVED, non-deleted rows regardless of caller (see
 * `catalogue.module.ts`).
 *
 * No `optionalAuthenticate`, no rate limiter, unlike `/api/v1/search`: this
 * is a single-entity lookup by id, the same shape and cost profile as
 * `/categories/:slug`, not the open-ended free-text query `/search`'s own
 * two-tier limiter exists to bound.
 */
export const createPublicProductRouter = (controller: PublicProductController): Router => {
  const router = Router();

  router.get(
    '/products/:id',
    validate({ params: productParamsSchema }),
    asyncHandler(controller.get),
  );

  return router;
};
