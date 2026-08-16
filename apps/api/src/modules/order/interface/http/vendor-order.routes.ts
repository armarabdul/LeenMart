import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import {
  tenantContext,
  type VendorTenantResolver,
} from '../../../../shared/interface/http/middleware/tenant-context.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { VendorOrderController } from './vendor-order.controller.js';

const subOrderParamsSchema = z.object({ id: z.string().uuid() }).strict();

export interface VendorOrderRouterDeps {
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly resolveVendorTenant: VendorTenantResolver;
}

/**
 * Mounted at `/api/v1/vendor/orders` (S3-5). Addressed by `SubOrderId`
 * throughout (locked decision #5) — there is no `:orderId` anywhere in this
 * router, unlike the customer-facing `/api/v1/orders/:id`.
 *
 * The chain mirrors `vendor-product.routes.ts`'s own, established for
 * exactly this shape of route: `authenticate` ("who is this?"),
 * `tenantContext` (bind the session to *their* vendor — every repository
 * beneath these handlers reads `SubOrder`/`OrderItem`/`Order`, all three in
 * `TENANT_SCOPED_MODELS` as of this milestone, so a query issued before the
 * context existed fails closed rather than reading across tenants),
 * `requirePermission` ("may this role do this at all?"), then validation.
 * The ACTIVE-vendor gate (locked decision #7) is deliberately not here —
 * it is an application-layer check inside each use case
 * (`requireActiveVendor`), not a route-level concern.
 */
export const createVendorOrderRouter = (
  controller: VendorOrderController,
  deps: VendorOrderRouterDeps,
): Router => {
  const { accessTokenService, sessionDenylist, resolveVendorTenant } = deps;
  const router = Router();
  const authenticated = [
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
  ];

  router.get(
    '/',
    ...authenticated,
    requirePermission('VIEW_VENDOR_ORDERS'),
    asyncHandler(controller.listVendorOrders),
  );

  router.get(
    '/:id',
    ...authenticated,
    requirePermission('VIEW_VENDOR_ORDERS'),
    validate({ params: subOrderParamsSchema }),
    asyncHandler(controller.getVendorOrder),
  );

  // CONFIRMED -> PROCESSING only (locked decision #4) — no reject/cancel
  // route exists here, and none should be added without a separate,
  // explicitly approved decision.
  router.post(
    '/:id/process',
    ...authenticated,
    requirePermission('ACCEPT_OR_REJECT_ORDER'),
    validate({ params: subOrderParamsSchema }),
    asyncHandler(controller.startProcessing),
  );

  // S3-6: PROCESSING -> SHIPPED -> DELIVERED. `UPDATE_ORDER_FULFILMENT`, not
  // `ACCEPT_OR_REJECT_ORDER` — locked decision #8 explicitly refuses to
  // stretch that permission a second time.
  router.post(
    '/:id/ship',
    ...authenticated,
    requirePermission('UPDATE_ORDER_FULFILMENT'),
    validate({ params: subOrderParamsSchema }),
    asyncHandler(controller.shipSubOrder),
  );

  router.post(
    '/:id/deliver',
    ...authenticated,
    requirePermission('UPDATE_ORDER_FULFILMENT'),
    validate({ params: subOrderParamsSchema }),
    asyncHandler(controller.deliverSubOrder),
  );

  return router;
};
