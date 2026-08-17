import { Router } from 'express';
import {
  createKycUploadIntentRequestSchema,
  registerVendorRequestSchema,
  setVendorPickupCapabilityRequestSchema,
  setVendorServiceablePincodesRequestSchema,
  setVendorShopAddressRequestSchema,
  setVendorShopNameRequestSchema,
  submitVendorKycRequestSchema,
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
 * S4-ADDR. The third self-service shop-profile attribute, on the same
 * `MANAGE_SHOP_PROFILE` permission as `/me/shop-profile` and
 * `/me/pickup-capability` — not a new capability, and deliberately not a new
 * permission.
 *
 * Split into its own function only to keep `createVendorRouter` inside this
 * repository's function-length budget; the middleware order is identical to
 * every route above it.
 */
const mountShopAddressRoutes = (
  router: Router,
  controller: VendorController,
  // The three auth collaborators travel as one object rather than as three
  // more positional arguments — they are always supplied together, and it
  // keeps this inside the four-parameter budget.
  auth: {
    readonly accessTokenService: AccessTokenService;
    readonly sessionDenylist: SessionDenylist;
    readonly resolveVendorTenant: VendorTenantResolver;
  },
): void => {
  const { accessTokenService, sessionDenylist, resolveVendorTenant } = auth;
  // GET is gated identically to the write: a role that may not manage the
  // shop profile has no business reading it back here either. The customer's
  // view of a pickup location is a different surface entirely — the order's
  // own snapshot — not this one.
  router.get(
    '/me/shop-address',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('MANAGE_SHOP_PROFILE'),
    asyncHandler(controller.getShopProfile),
  );

  // PUT, not PATCH: the address parts are only meaningful as a set, so this
  // replaces the whole address rather than merging field-by-field — a merge
  // could leave a new line1 sitting against a stale city.
  router.put(
    '/me/shop-address',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('MANAGE_SHOP_PROFILE'),
    validate({ body: setVendorShopAddressRequestSchema }),
    asyncHandler(controller.setShopAddress),
  );

  // S4-SERV. Gated by `CONFIGURE_DELIVERY_SLOTS` rather than
  // `MANAGE_SHOP_PROFILE`: SDD 8.2 has its own "Configure delivery/slots" row
  // (VENDOR_OWNER/VENDOR_MANAGER `OWN`, SUPER_ADMIN read-only) and declaring
  // where you deliver is that capability, not shop-profile presentation. The
  // permission has existed unused since the matrix was transcribed; this is
  // its first route.
  //
  // Same self-scoped shape as everything above — the vendor is resolved from
  // the principal and no vendor id is accepted from the request.
  router.get(
    '/me/serviceable-pincodes',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('CONFIGURE_DELIVERY_SLOTS'),
    asyncHandler(controller.getServiceablePincodes),
  );

  // PUT, matching `/me/shop-address`: the set is replaced wholesale, since a
  // partial patch would need add/remove semantics nothing here requires.
  router.put(
    '/me/serviceable-pincodes',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('CONFIGURE_DELIVERY_SLOTS'),
    validate({ body: setVendorServiceablePincodesRequestSchema }),
    asyncHandler(controller.setServiceablePincodes),
  );
};

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

  // Phase 2: the submission itself (SDD 15.1's `SUBMIT_KYC`). Same ordering
  // and the same permission as phase 1 — the two halves of one act, and a
  // caller allowed to mint upload capability is exactly the caller allowed to
  // submit what they uploaded.
  router.post(
    '/me/kyc',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('SUBMIT_OR_EDIT_KYC'),
    validate({ body: submitVendorKycRequestSchema }),
    asyncHandler(controller.submitKyc),
  );

  // S3-3A, decision D-S3-03. `MANAGE_SHOP_PROFILE` (SDD 8.2:
  // VENDOR_OWNER/VENDOR_MANAGER `OWN`) is the same "designed for, not yet
  // wired" permission `requirePermission`'s own doc comment names as an
  // example — this is its first route. Step 3 ("may this principal act on
  // *this* object?") stays in the use case, which loads the caller's own
  // vendor profile by `principal.userId` and never accepts a vendor id from
  // the request — the same discipline `/me/kyc*` above already establishes.
  router.patch(
    '/me/shop-profile',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('MANAGE_SHOP_PROFILE'),
    validate({ body: setVendorShopNameRequestSchema }),
    asyncHandler(controller.setShopName),
  );

  // S4-QR, locked decision #25. Same `MANAGE_SHOP_PROFILE` permission as
  // `/me/shop-profile` above — another self-service shop-profile attribute,
  // not a new capability.
  router.patch(
    '/me/pickup-capability',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('MANAGE_SHOP_PROFILE'),
    validate({ body: setVendorPickupCapabilityRequestSchema }),
    asyncHandler(controller.setPickupCapability),
  );

  mountShopAddressRoutes(router, controller, {
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
  });

  return router;
};
