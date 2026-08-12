import { Router } from 'express';
import {
  createKycUploadIntentRequestSchema,
  registerVendorRequestSchema,
} from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import {
  tenantContext,
  type VendorTenantResolver,
} from '../../../../shared/interface/http/middleware/tenant-context.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { VendorController } from './vendor.controller.js';

/**
 * Mounted at `/api/v1/vendors`, so this router's `/` is `POST /api/v1/vendors`
 * — a plural resource created with POST, per SDD 9.2's naming and method
 * conventions. Registration is authenticated: `authenticate()` runs before
 * validation so an anonymous caller is rejected without the body being read.
 * Whether the caller *may* register (CUSTOMER only) is the use case's
 * decision, not this layer's.
 */
export const createVendorRouter = (
  controller: VendorController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
  resolveVendorTenant: VendorTenantResolver,
): Router => {
  const router = Router();

  // `tenantContext` sits immediately after `authenticate` and never before it:
  // it resolves the caller's vendor from the *verified* principal, so every
  // handler and repository below runs inside that vendor's database context
  // (KYC-2B-2). Registration itself precedes any vendor profile, so this
  // resolves to no context on that route — which is correct, and harmless,
  // because registration touches no tenant-scoped model through the boundary.
  router.post(
    '/',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    validate({ body: registerVendorRequestSchema }),
    asyncHandler(controller.register),
  );

  // Phase 1 of KYC submission (SDD 12.2/12.3). The order is load-bearing and
  // is SDD 7.4's three questions in sequence: `authenticate` answers "who is
  // this?", `tenantContext` binds the database session to that caller's
  // vendor, `requirePermission` answers "may this role do this at all?" —
  // step 2, declarative, in the interface layer — and only then is the body
  // parsed. Validation runs last on purpose: an unauthorised caller is
  // refused without their payload ever being read.
  //
  // This is `requirePermission`'s first production consumer. Step 3 ("may
  // *this* principal act on *this* object?") stays in the use case, which
  // loads the caller's own vendor profile and never accepts a vendor id from
  // the request.
  router.post(
    '/me/kyc/documents',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('SUBMIT_OR_EDIT_KYC'),
    validate({ body: createKycUploadIntentRequestSchema }),
    asyncHandler(controller.createKycUploadIntent),
  );

  return router;
};
