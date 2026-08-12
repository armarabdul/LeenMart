import { Router } from 'express';
import { registerVendorRequestSchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
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

  return router;
};
