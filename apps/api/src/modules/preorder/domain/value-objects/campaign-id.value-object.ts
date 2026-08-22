import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type CampaignId = Brand<string, 'CampaignId'>;

const campaignId = createIdType('CampaignId');

export const isCampaignId = campaignId.is;
export const toCampaignId = campaignId.from;
