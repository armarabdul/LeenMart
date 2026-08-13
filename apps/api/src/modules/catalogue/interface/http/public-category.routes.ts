import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { categorySlugSchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { PublicCategoryController } from './public-category.controller.js';

const slugParamsSchema = z.object({ slug: categorySlugSchema }).strict();

/**
 * SDD §9.5's public catalogue cache header (S2-2c D-C12), set once for the
 * whole router rather than per handler. A single static header — no Redis, no
 * ETag, nothing that reads or varies per request, so this is not a caching
 * subsystem.
 */
const publicCacheControl: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  next();
};

/**
 * Mounted at `/api/v1/catalogue` — SDD §9.4's "Catalogue (public)" group.
 *
 * No `authenticate`, no `requirePermission`, no tenant context at all: the
 * S2-2a migration's own comment already requires this ("the public catalogue
 * must read them with no tenant context at all"), and `Category` carries no
 * tenant column and no RLS policy for one to establish. `Category`/
 * `CategoryAttribute` are also not in `TENANT_SCOPED_MODELS`, so the plain
 * app-tier Prisma client this router's use cases run on needs no context
 * either (see `catalogue.module.ts`).
 */
export const createPublicCategoryRouter = (controller: PublicCategoryController): Router => {
  const router = Router();
  router.use(publicCacheControl);

  router.get('/categories', asyncHandler(controller.list));
  router.get(
    '/categories/:slug',
    validate({ params: slugParamsSchema }),
    asyncHandler(controller.get),
  );

  return router;
};
