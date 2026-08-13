import { Router } from 'express';
import { z } from 'zod';
import { adminProductQueueQuerySchema, decideProductRequestSchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import {
  requireFullAccess,
  requirePermission,
} from '../../../../shared/interface/http/middleware/authorize.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { AdminProductController } from './admin-product.controller.js';

const productParamsSchema = z.object({ productId: z.string().uuid() }).strict();

/**
 * Mounted at `/api/v1/admin/products` — the admin surface (SDD 9.4), separate
 * from the vendor-facing `/api/v1/vendor/products` router even though both
 * belong to the `catalogue` module's bounded context. Mirrors
 * `admin-kyc.routes.ts` exactly.
 *
 * **`tenantContext` is deliberately absent.** This queue is cross-tenant by
 * definition — establishing a tenant context would either scope an
 * administrator to a vendor they do not have, or require inventing a fake
 * one. The authority here is the `leenmart_admin` credential's `SELECT`/
 * `UPDATE` policies plus `requirePermission`, which is why the handlers reach
 * `adminPrisma` and never the tenant-scoped client.
 *
 * Ordering is SDD 7.4's questions in sequence: `authenticate` ("who is
 * this?"), then `requirePermission` ("may this role do this at all?"), then
 * validation.
 *
 * `APPROVE_OR_REJECT_PRODUCT` is `FULL` for CATALOGUE_MODERATOR and
 * SUPER_ADMIN and `NONE` for every other role — there is no `READ_ONLY` grant
 * on this permission the way `APPROVE_OR_REJECT_VENDOR_KYC` has one, so
 * `requireFullAccess` is applied uniformly rather than only ahead of the
 * decision route. A role that may read this queue at all may also decide.
 */
export const createAdminProductRouter = (
  controller: AdminProductController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Router => {
  const router = Router();
  const guarded = [
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('APPROVE_OR_REJECT_PRODUCT'),
    requireFullAccess,
  ];

  router.get(
    '/submissions',
    ...guarded,
    validate({ query: adminProductQueueQuerySchema }),
    asyncHandler(controller.listQueue),
  );

  router.get(
    '/submissions/:productId',
    ...guarded,
    validate({ params: productParamsSchema }),
    asyncHandler(controller.getSubmission),
  );

  router.post(
    '/submissions/:productId/decision',
    ...guarded,
    validate({ params: productParamsSchema, body: decideProductRequestSchema }),
    asyncHandler(controller.decide),
  );

  return router;
};
