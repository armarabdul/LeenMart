import { Router } from 'express';
import { z } from 'zod';
import { adminKycQueueQuerySchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { AdminKycController } from './admin-kyc.controller.js';

const kycIdParamsSchema = z.object({ kycId: z.string().uuid() }).strict();

/**
 * Mounted at `/api/v1/admin/kyc` — the admin surface (SDD 9.4), separate from
 * the vendor-facing `/api/v1/vendors` router even though both belong to the
 * `vendor` module's bounded context.
 *
 * **`tenantContext` is deliberately absent.** Every other authenticated route
 * establishes it; these must not. A tenant context binds the database session
 * to one vendor, and this queue is cross-tenant by definition — establishing
 * one would either scope an administrator to a vendor they do not have, or
 * require inventing a fake one. The authority here is instead the
 * `leenmart_admin` credential's `SELECT` policies plus `requirePermission`,
 * which is why the handlers reach `adminPrisma` and never the tenant-scoped
 * client.
 *
 * Ordering is SDD 7.4's questions in sequence: `authenticate` ("who is
 * this?"), then `requirePermission` ("may this role do this at all?"), then
 * validation. Validation runs last on purpose — an unauthorised caller is
 * refused before their query string is parsed.
 *
 * `APPROVE_OR_REJECT_VENDOR_KYC` is the permission for both routes. The matrix
 * grants it `FULL` to RISK_ANALYST and SUPER_ADMIN and `READ_ONLY` to
 * CATALOGUE_MODERATOR and FINANCE_ADMIN — all four may therefore read, which
 * is exactly the intent, and the read/write distinction those levels draw
 * becomes load-bearing only when Commit 3 adds the decision routes.
 */
export const createAdminKycRouter = (
  controller: AdminKycController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Router => {
  const router = Router();

  router.get(
    '/submissions',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('APPROVE_OR_REJECT_VENDOR_KYC'),
    validate({ query: adminKycQueueQuerySchema }),
    asyncHandler(controller.listQueue),
  );

  router.get(
    '/submissions/:kycId',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('APPROVE_OR_REJECT_VENDOR_KYC'),
    validate({ params: kycIdParamsSchema }),
    asyncHandler(controller.getSubmission),
  );

  return router;
};
