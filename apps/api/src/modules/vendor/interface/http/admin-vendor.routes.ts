import { Router } from 'express';
import { z } from 'zod';
import { reinstateVendorRequestSchema, suspendVendorRequestSchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import {
  requireFullAccess,
  requirePermission,
} from '../../../../shared/interface/http/middleware/authorize.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { AdminVendorController } from './admin-vendor.controller.js';

const vendorIdParamsSchema = z.object({ vendorId: z.string().uuid() }).strict();

/**
 * Mounted at `/api/v1/admin/vendors` (Phase L.4) — a dedicated admin vendor
 * surface, deliberately separate from `/api/v1/admin/kyc`: suspension and
 * reinstatement act on a vendor's ongoing standing, not on a KYC submission,
 * and a vendor reachable here may have no KYC submission currently open.
 *
 * `SUSPEND_VENDOR_OR_USER` is `FULL` only for RISK_ANALYST and SUPER_ADMIN in
 * `PERMISSION_MATRIX` — no role holds a `READ_ONLY` grant on it — so
 * `requireFullAccess` on both routes is not a narrower rule than the
 * permission itself grants anyone; it is what makes a
 * same-permission-different-access-level bug (the kind
 * `admin-user-management.routes.ts` guards against) impossible to introduce
 * here by omission.
 *
 * No tenant context, the same reasoning `admin-kyc.routes.ts` and
 * `admin-category.routes.ts` both give: an administrator suspending *any*
 * vendor is cross-tenant by definition.
 *
 * `SUSPEND_VENDOR_OR_USER` is deliberately broader than vendor suspension —
 * it also names a bare user-suspension capability nothing here builds (see
 * `SuspendVendorUseCase`'s own doc comment). Only a vendor id reaches these
 * routes; there is no path here to suspend an arbitrary user account.
 */
export const createAdminVendorRouter = (
  controller: AdminVendorController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Router => {
  const router = Router();
  const authorized = [
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('SUSPEND_VENDOR_OR_USER'),
    requireFullAccess,
  ];

  router.post(
    '/:vendorId/suspend',
    ...authorized,
    validate({ params: vendorIdParamsSchema, body: suspendVendorRequestSchema }),
    asyncHandler(controller.suspend),
  );

  router.post(
    '/:vendorId/reinstate',
    ...authorized,
    validate({ params: vendorIdParamsSchema, body: reinstateVendorRequestSchema }),
    asyncHandler(controller.reinstate),
  );

  return router;
};
