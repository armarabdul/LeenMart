import { Router } from 'express';
import { createReviewRequestSchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import {
  tenantContext,
  type VendorTenantResolver,
} from '../../../../shared/interface/http/middleware/tenant-context.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { ReviewController } from './review.controller.js';

/**
 * Mounted at `/api/v1/me` (SDD 9.4: "Customer self-service | /api/v1/me/*
 * | customer"), alongside `address.routes.ts`/`cart.routes.ts`.
 *
 * `tenantContext` is mounted on both routes even though nothing
 * vendor-scoped is read: it is what sets `app.user_id` on the connection,
 * which is what `reviews_customer_select`/`reviews_customer_insert` are
 * written against — `Review` is in `TENANT_SCOPED_MODELS`/
 * `USER_ROOTED_MODELS` for exactly the reason `Notification`'s own migration
 * comment gives (a customer has no vendor and never will). Without it every
 * query would refuse with `MissingTenantContextError` rather than silently
 * misbehave — failing closed, but for the wrong reason. Mirrors
 * `notification.routes.ts` exactly.
 *
 * `authenticate` ("who is this?"), then `requirePermission('WRITE_REVIEW')`
 * ("may this role write a review at all?", SDD 8.2: `CUSTOMER` → `OWN`) for
 * the write route — the same `CANCEL_OWN_ORDER` pattern `order.routes.ts`
 * already establishes for an `OWN`-scoped permission. The read route
 * (`GET /reviews`, the caller's own list) carries no `requirePermission`:
 * SDD 8.2 has no separate "view own reviews" row, the same gap
 * `address.routes.ts` already has for `GET /addresses` — step 3 ("may they
 * act on *this* object?") is `ListMyReviewsUseCase`'s own unconditional
 * `principal.userId` scoping, never a client-supplied id.
 */
export const createReviewRouter = (
  controller: ReviewController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
  resolveVendorTenant: VendorTenantResolver,
): Router => {
  const router = Router();
  const requireAuth = [
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
  ];

  router.post(
    '/reviews',
    ...requireAuth,
    requirePermission('WRITE_REVIEW'),
    validate({ body: createReviewRequestSchema }),
    asyncHandler(controller.create),
  );
  router.get('/reviews', ...requireAuth, asyncHandler(controller.listMine));

  return router;
};
