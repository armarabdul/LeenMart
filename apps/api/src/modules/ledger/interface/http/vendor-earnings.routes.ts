import { Router } from 'express';
import { vendorEarningsQuerySchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import {
  tenantContext,
  type VendorTenantResolver,
} from '../../../../shared/interface/http/middleware/tenant-context.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { VendorEarningsController } from './vendor-earnings.controller.js';

export interface VendorEarningsRouterDeps {
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly resolveVendorTenant: VendorTenantResolver;
}

/**
 * Mounted at `/api/v1/vendor/earnings` (S3-8). A single `GET`, read-only —
 * there is no POST/PUT/PATCH/DELETE anywhere in this router (locked decision
 * #4), and none should be added without a separate, explicitly approved
 * decision: this is a reporting surface, not a payout or settlement API.
 *
 * The middleware chain mirrors `vendor-order.routes.ts` exactly:
 * `authenticate` ("who is this?"), `tenantContext` (bind the session to
 * *their* vendor — every read below runs through `leenmart_app` RLS keyed on
 * `app.vendor_id`), `requirePermission('VIEW_VENDOR_EARNINGS')` ("may this
 * role see this at all?"), then query validation. The ACTIVE-vendor gate is
 * an application-layer check inside the use case
 * (`requireActiveVendor`), not a route-level concern — same split as
 * `vendor-order.routes.ts`'s own comment documents.
 */
export const createVendorEarningsRouter = (
  controller: VendorEarningsController,
  deps: VendorEarningsRouterDeps,
): Router => {
  const { accessTokenService, sessionDenylist, resolveVendorTenant } = deps;
  const router = Router();

  router.get(
    '/',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('VIEW_VENDOR_EARNINGS'),
    validate({ query: vendorEarningsQuerySchema }),
    asyncHandler(controller.getEarnings),
  );

  return router;
};
