import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type MfaSecretId = Brand<string, 'MfaSecretId'>;

const mfaSecretId = createIdType('MfaSecretId');

export const isMfaSecretId = mfaSecretId.is;
export const toMfaSecretId = mfaSecretId.from;
