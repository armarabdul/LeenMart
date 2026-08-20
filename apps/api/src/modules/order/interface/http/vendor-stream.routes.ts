import { Router } from 'express';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import {
  tenantContext,
  type VendorTenantResolver,
} from '../../../../shared/interface/http/middleware/tenant-context.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { VendorStreamController } from './vendor-stream.controller.js';

export interface VendorStreamRouterDeps {
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly resolveVendorTenant: VendorTenantResolver;
}

/**
 * Mounted at `/api/v1/vendor/stream` (S4-SSE, FR-64, SDD §11.5) — its own
 * top-level mount, sibling to `/vendor/orders`/`/vendor/products`/
 * `/vendor/earnings`, not nested under any of them.
 *
 * The chain is `vendor-order.routes.ts`'s own, unchanged: `authenticate`
 * ("who is this?"), `tenantContext` (resolve *their* vendor — the only
 * source of vendor identity this route ever uses, locked decision #13),
 * `requirePermission('VIEW_VENDOR_ORDERS')` — the existing grant, not a new
 * permission (`VENDOR_OWNER`/`MANAGER`/`STAFF` = `OWN`). No params to
 * validate: there is no resource id in this route at all (locked decision
 * N-2 — `SELF_SCOPED`).
 */
export const createVendorStreamRouter = (
  controller: VendorStreamController,
  deps: VendorStreamRouterDeps,
): Router => {
  const { accessTokenService, sessionDenylist, resolveVendorTenant } = deps;
  const router = Router();

  router.get(
    '/',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('VIEW_VENDOR_ORDERS'),
    asyncHandler(controller.stream),
  );

  return router;
};
