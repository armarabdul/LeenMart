import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type MfaChallengeId = Brand<string, 'MfaChallengeId'>;

const mfaChallengeId = createIdType('MfaChallengeId');

export const isMfaChallengeId = mfaChallengeId.is;
export const toMfaChallengeId = mfaChallengeId.from;
