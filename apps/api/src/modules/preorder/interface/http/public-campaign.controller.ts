import type { Request, Response } from 'express';
import type { PublicCampaignListQuery, PublicCampaignResponse } from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import { toCampaignId } from '../../domain/value-objects/campaign-id.value-object.js';
import type { GetPublicCampaignUseCase } from '../../application/use-cases/get-public-campaign.use-case.js';
import type { ListPublicCampaignsUseCase } from '../../application/use-cases/list-public-campaigns.use-case.js';

export interface PublicCampaignController {
  readonly get: (req: Request, res: Response) => Promise<void>;
  readonly list: (req: Request, res: Response) => Promise<void>;
}

export interface PublicCampaignControllerDeps {
  readonly getPublicCampaignUseCase: GetPublicCampaignUseCase;
  readonly listPublicCampaignsUseCase: ListPublicCampaignsUseCase;
}

/** The shopper-facing shape — unlike `toCampaignResponse` (vendor.controller.ts), this includes `vendorId` (who is selling) but never `firstReservationConfirmedAt` (an internal freeze marker). */
const toPublicCampaignResponse = (campaign: PreorderCampaign): PublicCampaignResponse => ({
  id: campaign.id,
  vendorId: campaign.vendorId,
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
});

const getHandler =
  (deps: PublicCampaignControllerDeps): PublicCampaignController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { campaignId: string }>(req);

    const campaign = await deps.getPublicCampaignUseCase.execute(toCampaignId(params.campaignId));

    res
      .status(200)
      .json({ data: toPublicCampaignResponse(campaign), meta: { requestId: getRequestId() } });
  };

const listHandler =
  (deps: PublicCampaignControllerDeps): PublicCampaignController['list'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { query } = validatedData<unknown, PublicCampaignListQuery>(req);

    const page = await deps.listPublicCampaignsUseCase.execute({
      limit: query.limit,
      cursor: query.cursor,
    });

    res.status(200).json({
      data: page.items.map(toPublicCampaignResponse),
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  };

export const createPublicCampaignController = (
  deps: PublicCampaignControllerDeps,
): PublicCampaignController => ({
  get: getHandler(deps),
  list: listHandler(deps),
});
