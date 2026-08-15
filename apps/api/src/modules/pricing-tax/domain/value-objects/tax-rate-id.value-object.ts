import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type TaxRateId = Brand<string, 'TaxRateId'>;

const taxRateId = createIdType('TaxRateId');

export const isTaxRateId = taxRateId.is;
export const toTaxRateId = taxRateId.from;
