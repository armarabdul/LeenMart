import { Router } from 'express';
import { z } from 'zod';
import { publicCampaignListQuerySchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { PublicCampaignController } from './public-campaign.controller.js';

const campaignParamsSchema = z.object({ campaignId: z.string().uuid() }).strict();

/**
 * Mounted at `/api/v1/preorders` — unauthenticated, `publicPrisma`-bound
 * (`leenmart_public`), the same shape as `public-product.routes.ts`. RLS's
 * own `preorder_campaigns_public_read` policy (`status != 'DRAFT'`) is the
 * actual authority; this route adds no auth middleware of its own.
 */
export const createPublicCampaignRouter = (controller: PublicCampaignController): Router => {
  const router = Router();

  router.get(
    '/',
    validate({ query: publicCampaignListQuerySchema }),
    asyncHandler(controller.list),
  );

  router.get(
    '/:campaignId',
    validate({ params: campaignParamsSchema }),
    asyncHandler(controller.get),
  );

  return router;
};
