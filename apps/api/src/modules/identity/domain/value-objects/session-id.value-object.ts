import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type SessionId = Brand<string, 'SessionId'>;

const sessionId = createIdType('SessionId');

export const isSessionId = sessionId.is;
export const toSessionId = sessionId.from;
