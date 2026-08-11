import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type KycDocumentId = Brand<string, 'KycDocumentId'>;

const kycDocumentId = createIdType('KycDocumentId');

export const isKycDocumentId = kycDocumentId.is;
export const toKycDocumentId = kycDocumentId.from;
