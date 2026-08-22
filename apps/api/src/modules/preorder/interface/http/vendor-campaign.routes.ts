import { Router } from 'express';
import { z } from 'zod';
import {
  cancelCampaignRequestSchema,
  createCampaignRequestSchema,
  updateCampaignRequestSchema,
  vendorCampaignListQuerySchema,
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
import type { VendorCampaignController } from './vendor-campaign.controller.js';

const campaignParamsSchema = z.object({ campaignId: z.string().uuid() }).strict();

export interface VendorCampaignRouterDeps {
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly resolveVendorTenant: VendorTenantResolver;
}

/**
 * Mounted at `/api/v1/vendor/preorder-campaigns` — the vendor-facing
 * preorder surface, shaped exactly like `vendor-product.routes.ts`:
 * `authenticate` ("who is this?"), `tenantContext` (bind the session to
 * *their* vendor — `PreorderCampaign` is in `TENANT_SCOPED_MODELS`, so a
 * query issued before the context existed fails closed), `requirePermission`
 * ("may this role do this at all?"), then validation.
 *
 * Every route reuses `CREATE_PREORDER_CAMPAIGN` — the one permission SDD 8.2
 * already defines for this surface (VENDOR_OWNER/MANAGER = `OWN`,
 * SUPER_ADMIN = `READ_ONLY`, everyone else `NONE`). The implementation brief
 * explicitly says not to add a new permission "unless absolutely
 * required" — reading/listing/cancelling one's own campaign is the same
 * "act on my own resource" authority as creating one, the same reasoning
 * `MANAGE_INVENTORY` already covers a full CRUD surface under one row.
 */
export const createVendorCampaignRouter = (
  controller: VendorCampaignController,
  deps: VendorCampaignRouterDeps,
): Router => {
  const { accessTokenService, sessionDenylist, resolveVendorTenant } = deps;
  const router = Router();
  const scoped = [
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    requirePermission('CREATE_PREORDER_CAMPAIGN'),
  ];

  router.post(
    '/',
    ...scoped,
    validate({ body: createCampaignRequestSchema }),
    asyncHandler(controller.create),
  );

  router.get(
    '/',
    ...scoped,
    validate({ query: vendorCampaignListQuerySchema }),
    asyncHandler(controller.list),
  );

  router.get(
    '/:campaignId',
    ...scoped,
    validate({ params: campaignParamsSchema }),
    asyncHandler(controller.get),
  );

  router.patch(
    '/:campaignId',
    ...scoped,
    validate({ params: campaignParamsSchema, body: updateCampaignRequestSchema }),
    asyncHandler(controller.update),
  );

  router.post(
    '/:campaignId/cancel',
    ...scoped,
    validate({ params: campaignParamsSchema, body: cancelCampaignRequestSchema }),
    asyncHandler(controller.cancel),
  );

  router.get(
    '/:campaignId/demand-summary',
    ...scoped,
    validate({ params: campaignParamsSchema }),
    asyncHandler(controller.demandSummary),
  );

  return router;
};
