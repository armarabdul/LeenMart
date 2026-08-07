import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type UserId = Brand<string, 'UserId'>;

const userId = createIdType('UserId');

export const isUserId = userId.is;
export const toUserId = userId.from;
