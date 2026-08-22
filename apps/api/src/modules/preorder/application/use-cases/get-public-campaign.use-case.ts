import type { PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import { CampaignNotFoundError } from '../../domain/errors/preorder-errors.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { CampaignId } from '../../domain/value-objects/campaign-id.value-object.js';

export interface GetPublicCampaignDeps {
  /** `publicPrisma`-bound — `preorder_campaigns_public_read` (`status != 'DRAFT'`) is the actual authority, this repository's own `findPublicById` filter is defence-in-depth. */
  readonly campaignRepository: CampaignRepository;
}

export class GetPublicCampaignUseCase {
  constructor(private readonly deps: GetPublicCampaignDeps) {}

  async execute(campaignId: CampaignId): Promise<PreorderCampaign> {
    const campaign = await this.deps.campaignRepository.findPublicById(campaignId);
    if (!campaign) throw new CampaignNotFoundError();
    return campaign;
  }
}
