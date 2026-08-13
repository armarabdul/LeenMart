import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  addProductVariantRequestSchema,
  createProductRequestSchema,
  updateProductRequestSchema,
  setInventoryRequestSchema,
  updateProductVariantRequestSchema,
  vendorProductListQuerySchema,
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
import type { VendorProductController } from './vendor-product.controller.js';
import type { VendorProductVariantController } from './vendor-product-variant.controller.js';
import type { VendorInventoryController } from './vendor-inventory.controller.js';

const productParamsSchema = z.object({ productId: z.string().uuid() }).strict();

const variantParamsSchema = z
  .object({ productId: z.string().uuid(), variantId: z.string().uuid() })
  .strict();

/**
 * Mounted at `/api/v1/vendor/products` — the vendor-facing catalogue surface
 * (SDD 9.4: "Vendor | /api/v1/vendor/* | vendor, tenant-scoped").
 *
 * **This is the catalogue module's first tenant-scoped router**, and the chain
 * is SDD 7.4's questions in the order the vendor KYC router already
 * established:
 *
 *   `authenticate`      — who is this?
 *   `tenantContext`     — bind the database session to *their* vendor
 *   `requirePermission` — may this role do this at all?
 *   `validate`          — is the request well-formed?
 *
 * `tenantContext` sits second and never later: every repository beneath these
 * handlers reads `Product`/`ProductVariant`, both of which are in
 * `TENANT_SCOPED_MODELS`, so a query issued before the context existed fails
 * closed rather than reading across tenants. RLS enforces the same boundary
 * again beneath it.
 *
 * There is deliberately **no `requireFullAccess`**. SDD 8.2 grants
 * `CREATE_OR_EDIT_PRODUCT` as `OWN` to VENDOR_OWNER, VENDOR_MANAGER and
 * VENDOR_STAFF, and `OWN` is not a weaker grant to be filtered here — it is
 * the statement that the caller may act on their own resources, which is
 * exactly what the tenant scoping enforces. `requireFullAccess` exists for the
 * admin surfaces, where READ_ONLY and FULL are genuinely different rights.
 */
export interface VendorProductRouterDeps {
  readonly controller: VendorProductController;
  readonly variants: VendorProductVariantController;
  readonly inventory: VendorInventoryController;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly resolveVendorTenant: VendorTenantResolver;
}

/**
 * The two per-variant stock routes (S2-4).
 *
 * `MANAGE_INVENTORY` rather than `CREATE_OR_EDIT_PRODUCT`: SDD 8.2 makes them
 * separate rows, and a vendor staff member who may adjust stock is not
 * necessarily one who may rewrite a listing. Same `OWN` semantics, so the
 * tenant scoping is again what enforces it and there is no `requireFullAccess`.
 */
const mountInventoryRoutes = (
  router: Router,
  inventory: VendorInventoryController,
  authenticated: RequestHandler[],
): void => {
  const scoped = [...authenticated, requirePermission('MANAGE_INVENTORY')];

  router.get(
    '/:productId/variants/:variantId/inventory',
    ...scoped,
    validate({ params: variantParamsSchema }),
    asyncHandler(inventory.get),
  );

  router.patch(
    '/:productId/variants/:variantId/inventory',
    ...scoped,
    validate({ params: variantParamsSchema, body: setInventoryRequestSchema }),
    asyncHandler(inventory.set),
  );
};

/** The five variant routes, split out purely to keep each function within its line budget. */
const mountVariantRoutes = (
  router: Router,
  variants: VendorProductVariantController,
  scoped: RequestHandler[],
): void => {
  // Variants are a sub-resource of a product and share its permission and its
  // guards exactly, so they hang off the same router rather than a second one
  // that would need keeping in step with it.
  router.post(
    '/:productId/variants',
    ...scoped,
    validate({ params: productParamsSchema, body: addProductVariantRequestSchema }),
    asyncHandler(variants.add),
  );

  router.get(
    '/:productId/variants',
    ...scoped,
    validate({ params: productParamsSchema }),
    asyncHandler(variants.list),
  );

  router.get(
    '/:productId/variants/:variantId',
    ...scoped,
    validate({ params: variantParamsSchema }),
    asyncHandler(variants.get),
  );

  router.patch(
    '/:productId/variants/:variantId',
    ...scoped,
    validate({ params: variantParamsSchema, body: updateProductVariantRequestSchema }),
    asyncHandler(variants.update),
  );

  router.delete(
    '/:productId/variants/:variantId',
    ...scoped,
    validate({ params: variantParamsSchema }),
    asyncHandler(variants.remove),
  );
};

export const createVendorProductRouter = (deps: VendorProductRouterDeps): Router => {
  const {
    controller,
    variants,
    inventory,
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
  } = deps;
  const router = Router();
  // `authenticate` then `tenantContext` is shared by every route here; the
  // permission differs, so it is applied per group rather than once.
  const authenticated = [
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
  ];
  const scoped = [...authenticated, requirePermission('CREATE_OR_EDIT_PRODUCT')];

  router.post(
    '/',
    ...scoped,
    validate({ body: createProductRequestSchema }),
    asyncHandler(controller.create),
  );

  router.get(
    '/',
    ...scoped,
    validate({ query: vendorProductListQuerySchema }),
    asyncHandler(controller.list),
  );

  router.get(
    '/:productId',
    ...scoped,
    validate({ params: productParamsSchema }),
    asyncHandler(controller.get),
  );

  router.patch(
    '/:productId',
    ...scoped,
    validate({ params: productParamsSchema, body: updateProductRequestSchema }),
    asyncHandler(controller.update),
  );

  router.delete(
    '/:productId',
    ...scoped,
    validate({ params: productParamsSchema }),
    asyncHandler(controller.remove),
  );

  // S2-5: DRAFT/REJECTED -> PENDING_REVIEW. Same permission and tenant
  // scoping as every other route here — submitting is still an act on the
  // caller's own product, not a new authority.
  router.post(
    '/:productId/submit',
    ...scoped,
    validate({ params: productParamsSchema }),
    asyncHandler(controller.submit),
  );

  mountVariantRoutes(router, variants, scoped);
  mountInventoryRoutes(router, inventory, authenticated);

  return router;
};
