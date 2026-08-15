import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type SubOrderId = Brand<string, 'SubOrderId'>;

const subOrderId = createIdType('SubOrderId');

export const isSubOrderId = subOrderId.is;
export const toSubOrderId = subOrderId.from;
