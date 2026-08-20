import { Router } from 'express';
import { z } from 'zod';
import {
  adminReviewQueueQuerySchema,
  decideReviewModerationRequestSchema,
} from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import {
  requireFullAccess,
  requirePermission,
} from '../../../../shared/interface/http/middleware/authorize.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { AdminReviewController } from './admin-review.controller.js';

const reviewParamsSchema = z.object({ reviewId: z.string().uuid() }).strict();

/**
 * Mounted at `/api/v1/admin/reviews` — the admin surface (SDD 9.4), mirrors
 * `admin-product.routes.ts` exactly.
 *
 * **`tenantContext` is deliberately absent.** This queue is cross-tenant by
 * definition — every review, from every vendor's products — so the
 * authority here is the `leenmart_admin` credential's RLS policies
 * (`reviews_admin_select`/`reviews_admin_update`) plus `requirePermission`,
 * never a tenant context.
 *
 * `MODERATE_REVIEWS` (SDD 8.2) is `READ_ONLY` for `SUPPORT_AGENT`/
 * `RISK_ANALYST` and `FULL` for `CATALOGUE_MODERATOR`/`SUPER_ADMIN` — unlike
 * `APPROVE_OR_REJECT_PRODUCT`, this permission genuinely has a `READ_ONLY`
 * grant, so `requireFullAccess` gates only the decision route, not the
 * queue read, mirroring `admin-kyc.routes.ts`'s own split for
 * `APPROVE_OR_REJECT_VENDOR_KYC`.
 */
export const createAdminReviewRouter = (
  controller: AdminReviewController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Router => {
  const router = Router();
  const requireAuth = authenticate(accessTokenService, sessionDenylist);
  const requireModerate = requirePermission('MODERATE_REVIEWS');

  router.get(
    '/',
    requireAuth,
    requireModerate,
    validate({ query: adminReviewQueueQuerySchema }),
    asyncHandler(controller.listQueue),
  );

  router.post(
    '/:reviewId/decision',
    requireAuth,
    requireModerate,
    requireFullAccess,
    validate({ params: reviewParamsSchema, body: decideReviewModerationRequestSchema }),
    asyncHandler(controller.decide),
  );

  return router;
};
