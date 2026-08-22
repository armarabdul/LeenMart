import type { VendorId } from '../../../identity/index.js';
import type {
  CampaignListPage,
  CampaignRepository,
} from '../../domain/repositories/campaign.repository.js';

export interface ListCampaignsDeps {
  readonly campaignRepository: CampaignRepository;
}

export class ListCampaignsUseCase {
  constructor(private readonly deps: ListCampaignsDeps) {}

  execute(input: {
    vendorId: VendorId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<CampaignListPage> {
    return this.deps.campaignRepository.listByVendorId(input);
  }
}
