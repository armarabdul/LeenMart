import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type KycId = Brand<string, 'KycId'>;

const kycId = createIdType('KycId');

export const isKycId = kycId.is;
export const toKycId = kycId.from;
