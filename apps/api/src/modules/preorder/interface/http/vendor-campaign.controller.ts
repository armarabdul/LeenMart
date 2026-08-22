import type { Request, Response } from 'express';
import type {
  CampaignDemandSummaryResponse,
  CreateCampaignRequest,
  UpdateCampaignRequest,
  CancelCampaignRequest,
  VendorCampaignListQuery,
  VendorCampaignResponse,
} from '@leen-mart/contracts';
import { getTenantContext } from '../../../../shared/infrastructure/persistence/tenant-context.js';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { VendorId } from '../../../identity/index.js';
import { toProductVariantId } from '../../../catalogue/domain/value-objects/product-variant-id.value-object.js';
import type { PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import { toCampaignId } from '../../domain/value-objects/campaign-id.value-object.js';
import type { CreateCampaignUseCase } from '../../application/use-cases/create-campaign.use-case.js';
import type { UpdateCampaignUseCase } from '../../application/use-cases/update-campaign.use-case.js';
import type { CancelCampaignUseCase } from '../../application/use-cases/cancel-campaign.use-case.js';
import type { GetCampaignUseCase } from '../../application/use-cases/get-campaign.use-case.js';
import type { ListCampaignsUseCase } from '../../application/use-cases/list-campaigns.use-case.js';
import type {
  CampaignDemandSummary,
  GetCampaignDemandSummaryUseCase,
} from '../../application/use-cases/get-campaign-demand-summary.use-case.js';

export interface VendorCampaignController {
  readonly create: (req: Request, res: Response) => Promise<void>;
  readonly update: (req: Request, res: Response) => Promise<void>;
  readonly cancel: (req: Request, res: Response) => Promise<void>;
  readonly get: (req: Request, res: Response) => Promise<void>;
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly demandSummary: (req: Request, res: Response) => Promise<void>;
}

export interface VendorCampaignControllerDeps {
  readonly createCampaignUseCase: CreateCampaignUseCase;
  readonly updateCampaignUseCase: UpdateCampaignUseCase;
  readonly cancelCampaignUseCase: CancelCampaignUseCase;
  readonly getCampaignUseCase: GetCampaignUseCase;
  readonly listCampaignsUseCase: ListCampaignsUseCase;
  readonly getCampaignDemandSummaryUseCase: GetCampaignDemandSummaryUseCase;
}

/** Mapped field by field, never spread — this codebase's own "deliberately narrow" DTO discipline. `vendorId` is never published back (the caller already knows it is their own). */
const toCampaignResponse = (campaign: PreorderCampaign): VendorCampaignResponse => ({
  id: campaign.id,
  variantId: campaign.variantId,
  status: campaign.status.name,
  opensAt: campaign.opensAt.toISOString(),
  orderCutoffAt: campaign.orderCutoffAt.toISOString(),
  fulfilmentWindowStart: campaign.fulfilmentWindowStart.toISOString(),
  fulfilmentWindowEnd: campaign.fulfilmentWindowEnd.toISOString(),
  totalQuantity: campaign.totalQuantity,
  remainingQuantity: campaign.remainingQuantity,
  advancePercent: campaign.advancePercent,
  maxPerCustomer: campaign.maxPerCustomer,
  fulfilmentMode: campaign.fulfilmentMode.name,
  firstReservationConfirmedAt: campaign.firstReservationConfirmedAt?.toISOString() ?? null,
  createdAt: campaign.createdAt.toISOString(),
  updatedAt: campaign.updatedAt.toISOString(),
});

const toDemandSummaryResponse = (
  summary: CampaignDemandSummary,
): CampaignDemandSummaryResponse => ({
  reservationCount: summary.reservationCount,
  confirmedCount: summary.confirmedCount,
  totalUnitsCommitted: summary.totalUnitsCommitted,
});

/**
 * The verified caller and the vendor they are acting as — mirrors
 * `vendor-product.controller.ts`'s own `contextOf` exactly, including its
 * own reasoning: the vendor comes from the ambient tenant context
 * (`tenantContext` middleware upstream), never the body, which is what makes
 * the id this handler writes and the id RLS enforces the same id by
 * construction.
 */
const contextOf = (
  req: Request,
  route: string,
): { principal: NonNullable<Request['principal']>; vendorId: VendorId } => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  const tenant = getTenantContext();
  if (tenant?.kind !== 'authenticated' || !tenant.vendorId) {
    throw new Error(`${route} reached without a resolved vendor tenant context.`);
  }
  return { principal: req.principal, vendorId: tenant.vendorId };
};

const createHandler =
  (deps: VendorCampaignControllerDeps): VendorCampaignController['create'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { principal, vendorId } = contextOf(req, 'POST /vendor/preorder-campaigns');
    const { body } = validatedData<CreateCampaignRequest>(req);

    const campaign = await deps.createCampaignUseCase.execute({
      principal,
      vendorId,
      variantId: toProductVariantId(body.variantId),
      opensAt: new Date(body.opensAt),
      orderCutoffAt: new Date(body.orderCutoffAt),
      fulfilmentWindowStart: new Date(body.fulfilmentWindowStart),
      fulfilmentWindowEnd: new Date(body.fulfilmentWindowEnd),
      totalQuantity: body.totalQuantity,
      advancePercent: body.advancePercent,
      maxPerCustomer: body.maxPerCustomer,
      fulfilmentMode: body.fulfilmentMode,
    });

    res
      .status(201)
      .json({ data: toCampaignResponse(campaign), meta: { requestId: getRequestId() } });
  };

const updateHandler =
  (deps: VendorCampaignControllerDeps): VendorCampaignController['update'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { principal, vendorId } = contextOf(req, 'PATCH /vendor/preorder-campaigns/:campaignId');
    const { params, body } = validatedData<UpdateCampaignRequest, unknown, { campaignId: string }>(
      req,
    );

    const campaign = await deps.updateCampaignUseCase.execute({
      principal,
      vendorId,
      campaignId: toCampaignId(params.campaignId),
      ...(body.opensAt !== undefined ? { opensAt: new Date(body.opensAt) } : {}),
      ...(body.orderCutoffAt !== undefined ? { orderCutoffAt: new Date(body.orderCutoffAt) } : {}),
      ...(body.fulfilmentWindowStart !== undefined
        ? { fulfilmentWindowStart: new Date(body.fulfilmentWindowStart) }
        : {}),
      ...(body.fulfilmentWindowEnd !== undefined
        ? { fulfilmentWindowEnd: new Date(body.fulfilmentWindowEnd) }
        : {}),
      ...(body.totalQuantity !== undefined ? { totalQuantity: body.totalQuantity } : {}),
      ...(body.advancePercent !== undefined ? { advancePercent: body.advancePercent } : {}),
      ...(body.maxPerCustomer !== undefined ? { maxPerCustomer: body.maxPerCustomer } : {}),
      ...(body.fulfilmentMode !== undefined ? { fulfilmentMode: body.fulfilmentMode } : {}),
    });

    res
      .status(200)
      .json({ data: toCampaignResponse(campaign), meta: { requestId: getRequestId() } });
  };

const cancelHandler =
  (deps: VendorCampaignControllerDeps): VendorCampaignController['cancel'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { principal, vendorId } = contextOf(
      req,
      'POST /vendor/preorder-campaigns/:campaignId/cancel',
    );
    const { params, body } = validatedData<CancelCampaignRequest, unknown, { campaignId: string }>(
      req,
    );

    const campaign = await deps.cancelCampaignUseCase.execute({
      principal,
      vendorId,
      campaignId: toCampaignId(params.campaignId),
      reason: body.reason,
    });

    res
      .status(200)
      .json({ data: toCampaignResponse(campaign), meta: { requestId: getRequestId() } });
  };

const getHandler =
  (deps: VendorCampaignControllerDeps): VendorCampaignController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { vendorId } = contextOf(req, 'GET /vendor/preorder-campaigns/:campaignId');
    const { params } = validatedData<unknown, unknown, { campaignId: string }>(req);

    const campaign = await deps.getCampaignUseCase.execute({
      vendorId,
      campaignId: toCampaignId(params.campaignId),
    });

    res
      .status(200)
      .json({ data: toCampaignResponse(campaign), meta: { requestId: getRequestId() } });
  };

const listHandler =
  (deps: VendorCampaignControllerDeps): VendorCampaignController['list'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { vendorId } = contextOf(req, 'GET /vendor/preorder-campaigns');
    const { query } = validatedData<unknown, VendorCampaignListQuery>(req);

    const page = await deps.listCampaignsUseCase.execute({
      vendorId,
      limit: query.limit,
      cursor: query.cursor,
    });

    res.status(200).json({
      data: page.items.map(toCampaignResponse),
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  };

const demandSummaryHandler =
  (deps: VendorCampaignControllerDeps): VendorCampaignController['demandSummary'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { vendorId } = contextOf(
      req,
      'GET /vendor/preorder-campaigns/:campaignId/demand-summary',
    );
    const { params } = validatedData<unknown, unknown, { campaignId: string }>(req);

    const summary = await deps.getCampaignDemandSummaryUseCase.execute({
      vendorId,
      campaignId: toCampaignId(params.campaignId),
    });

    res
      .status(200)
      .json({ data: toDemandSummaryResponse(summary), meta: { requestId: getRequestId() } });
  };

export const createVendorCampaignController = (
  deps: VendorCampaignControllerDeps,
): VendorCampaignController => ({
  create: createHandler(deps),
  update: updateHandler(deps),
  cancel: cancelHandler(deps),
  get: getHandler(deps),
  list: listHandler(deps),
  demandSummary: demandSummaryHandler(deps),
});
