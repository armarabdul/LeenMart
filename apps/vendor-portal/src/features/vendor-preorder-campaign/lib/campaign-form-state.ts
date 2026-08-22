import type { PreorderCampaignFulfilmentModeDto } from '@leen-mart/contracts';

export interface CampaignFormState {
  readonly opensAt: string;
  readonly orderCutoffAt: string;
  readonly fulfilmentWindowStart: string;
  readonly fulfilmentWindowEnd: string;
  readonly totalQuantity: string;
  readonly advancePercent: string;
  readonly maxPerCustomer: string;
  readonly fulfilmentMode: PreorderCampaignFulfilmentModeDto;
}

export const EMPTY_CAMPAIGN_FORM: CampaignFormState = {
  opensAt: '',
  orderCutoffAt: '',
  fulfilmentWindowStart: '',
  fulfilmentWindowEnd: '',
  totalQuantity: '',
  advancePercent: '20',
  maxPerCustomer: '1',
  fulfilmentMode: 'DELIVERY',
};
