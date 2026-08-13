import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  adminCategoryListQuerySchema,
  createCategoryAttributeRequestSchema,
  createCategoryRequestSchema,
  reparentCategoryRequestSchema,
  updateCategoryAttributeRequestSchema,
  updateCategoryRequestSchema,
} from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import {
  requireFullAccess,
  requirePermission,
} from '../../../../shared/interface/http/middleware/authorize.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { AdminCategoryAttributeController } from './admin-category-attribute.controller.js';
import type { AdminCategoryController } from './admin-category.controller.js';

const categoryIdParamsSchema = z.object({ categoryId: z.string().uuid() }).strict();

const attributeParamsSchema = z
  .object({ categoryId: z.string().uuid(), attributeId: z.string().uuid() })
  .strict();

/**
 * Mounted at `/api/v1/admin/categories` — the admin surface (SDD 9.4).
 *
 * **`tenantContext` is deliberately absent**, for a different reason than the
 * admin KYC router's. There, the surface is cross-tenant; here there is no
 * tenant at all: categories are platform-owned and carry no vendor column, so
 * there is nothing a tenant context could scope. That is also why the table
 * sits outside `TENANT_SCOPED_MODELS` and carries no RLS policy.
 *
 * Ordering is SDD 7.4's questions in sequence: `authenticate` ("who is
 * this?"), `requirePermission` ("may this role do this at all?"),
 * `requireFullAccess` on the writes, then validation. Validation runs last on
 * purpose — an unauthorised caller is refused before their body is parsed.
 *
 * `MANAGE_CATEGORIES_OR_COMMISSION` is the permission for every route here.
 * SDD 8.2 grants it `FULL` to **FINANCE_ADMIN** and SUPER_ADMIN and
 * `READ_ONLY` to CATALOGUE_MODERATOR. That FINANCE_ADMIN rather than the
 * catalogue moderator holds taxonomy write is counter-intuitive and is
 * nonetheless exactly what the matrix says; it is reproduced faithfully rather
 * than quietly corrected here, because the matrix is the single place roles
 * are named and a local override would fork it.
 *
 * The commission half of that permission's name is **not** implemented:
 * `commission_rules` belongs to the pricing-tax module, which does not exist.
 */
/** The six category routes, split out purely to keep the composition function under this file's line budget. */
const registerCategoryRoutes = (
  router: Router,
  controller: AdminCategoryController,
  authenticated: readonly RequestHandler[],
): void => {
  router.get(
    '/',
    ...authenticated,
    validate({ query: adminCategoryListQuerySchema }),
    asyncHandler(controller.list),
  );

  router.get(
    '/:categoryId',
    ...authenticated,
    validate({ params: categoryIdParamsSchema }),
    asyncHandler(controller.get),
  );

  router.post(
    '/',
    ...authenticated,
    requireFullAccess,
    validate({ body: createCategoryRequestSchema }),
    asyncHandler(controller.create),
  );

  router.patch(
    '/:categoryId',
    ...authenticated,
    requireFullAccess,
    validate({ params: categoryIdParamsSchema, body: updateCategoryRequestSchema }),
    asyncHandler(controller.update),
  );

  // A sub-resource verb, not a `PATCH` field (SDD 9.2's "non-CRUD actions"):
  // moving a category rewrites the `path` and `depth` of its entire subtree,
  // which is an operation on the tree rather than an edit of one row.
  router.post(
    '/:categoryId/parent',
    ...authenticated,
    requireFullAccess,
    validate({ params: categoryIdParamsSchema, body: reparentCategoryRequestSchema }),
    asyncHandler(controller.reparent),
  );

  router.delete(
    '/:categoryId',
    ...authenticated,
    requireFullAccess,
    validate({ params: categoryIdParamsSchema }),
    asyncHandler(controller.remove),
  );
};

/**
 * Per-category attribute definitions (S2-2b), split out for the same reason
 * as the category routes above. Mounted on the same router rather than a
 * separate one: they are a sub-resource of a category, share its permission
 * and its guards exactly, and a second router would mean a second place to
 * keep that chain in step.
 */
const registerAttributeRoutes = (
  router: Router,
  attributes: AdminCategoryAttributeController,
  authenticated: readonly RequestHandler[],
): void => {
  router.get(
    '/:categoryId/attributes',
    ...authenticated,
    validate({ params: categoryIdParamsSchema }),
    asyncHandler(attributes.list),
  );

  router.get(
    '/:categoryId/attributes/:attributeId',
    ...authenticated,
    validate({ params: attributeParamsSchema }),
    asyncHandler(attributes.get),
  );

  router.post(
    '/:categoryId/attributes',
    ...authenticated,
    requireFullAccess,
    validate({ params: categoryIdParamsSchema, body: createCategoryAttributeRequestSchema }),
    asyncHandler(attributes.add),
  );

  router.patch(
    '/:categoryId/attributes/:attributeId',
    ...authenticated,
    requireFullAccess,
    validate({ params: attributeParamsSchema, body: updateCategoryAttributeRequestSchema }),
    asyncHandler(attributes.update),
  );

  router.delete(
    '/:categoryId/attributes/:attributeId',
    ...authenticated,
    requireFullAccess,
    validate({ params: attributeParamsSchema }),
    asyncHandler(attributes.remove),
  );
};

export const createAdminCategoryRouter = (
  controller: AdminCategoryController,
  attributes: AdminCategoryAttributeController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Router => {
  const router = Router();
  const authenticated = [
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('MANAGE_CATEGORIES_OR_COMMISSION'),
  ];

  registerCategoryRoutes(router, controller, authenticated);
  registerAttributeRoutes(router, attributes, authenticated);

  return router;
};
