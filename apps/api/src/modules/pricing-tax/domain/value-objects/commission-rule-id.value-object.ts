import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type CommissionRuleId = Brand<string, 'CommissionRuleId'>;

const commissionRuleId = createIdType('CommissionRuleId');

export const isCommissionRuleId = commissionRuleId.is;
export const toCommissionRuleId = commissionRuleId.from;
