/** Only actions this module actually writes are listed — mirrors `VENDOR_AUDIT_ACTIONS`'s own doc comment. */
export const PREORDER_AUDIT_ACTIONS = {
  CAMPAIGN_CREATED: 'preorder.campaign.created',
  CAMPAIGN_CANCELLED: 'preorder.campaign.cancelled',
} as const;

export const PREORDER_AUDIT_ENTITY_TYPES = {
  CAMPAIGN: 'PreorderCampaign',
} as const;
