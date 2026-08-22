import type { VendorId } from '../../../identity/index.js';
import type { PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import { CampaignNotFoundError } from '../../domain/errors/preorder-errors.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { CampaignId } from '../../domain/value-objects/campaign-id.value-object.js';

export interface GetCampaignDeps {
  readonly campaignRepository: CampaignRepository;
}

export class GetCampaignUseCase {
  constructor(private readonly deps: GetCampaignDeps) {}

  async execute(input: { vendorId: VendorId; campaignId: CampaignId }): Promise<PreorderCampaign> {
    const campaign = await this.deps.campaignRepository.findByIdAndVendorId(
      input.campaignId,
      input.vendorId,
    );
    if (!campaign) throw new CampaignNotFoundError();
    return campaign;
  }
}
