import type {
  CampaignListPage,
  CampaignRepository,
} from '../../domain/repositories/campaign.repository.js';

export interface ListPublicCampaignsDeps {
  readonly campaignRepository: CampaignRepository;
}

export class ListPublicCampaignsUseCase {
  constructor(private readonly deps: ListPublicCampaignsDeps) {}

  execute(input: { limit: number; cursor?: string | undefined }): Promise<CampaignListPage> {
    return this.deps.campaignRepository.listPublic(input);
  }
}
