import type { VendorId } from '../../../identity/index.js';
import { CampaignNotFoundError } from '../../domain/errors/preorder-errors.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import type { CampaignId } from '../../domain/value-objects/campaign-id.value-object.js';

export interface GetCampaignDemandSummaryDeps {
  readonly campaignRepository: CampaignRepository;
  /** Bound to the tenant-scoped `prisma` client (RLS-scoped vendor read), never `checkoutPrisma` — see `tenant-context.ts`'s own comment on why `PreorderReservation` joins `TENANT_SCOPED_MODELS` for exactly this read. */
  readonly reservationRepository: ReservationRepository;
}

export interface CampaignDemandSummary {
  readonly reservationCount: number;
  readonly confirmedCount: number;
  readonly totalUnitsCommitted: number;
}

/**
 * A vendor's own real-time demand read for one of their campaigns — every
 * number here is a fresh aggregate read off `preorder_reservations`, never
 * faked or derived client-side (the implementation brief's own explicit
 * instruction).
 */
export class GetCampaignDemandSummaryUseCase {
  constructor(private readonly deps: GetCampaignDemandSummaryDeps) {}

  async execute(input: {
    vendorId: VendorId;
    campaignId: CampaignId;
  }): Promise<CampaignDemandSummary> {
    const { campaignRepository, reservationRepository } = this.deps;

    const campaign = await campaignRepository.findByIdAndVendorId(input.campaignId, input.vendorId);
    if (!campaign) throw new CampaignNotFoundError();

    return reservationRepository.summarizeByCampaign(campaign.id);
  }
}
