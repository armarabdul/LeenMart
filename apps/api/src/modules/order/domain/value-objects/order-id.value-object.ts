import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type OrderId = Brand<string, 'OrderId'>;

const orderId = createIdType('OrderId');

export const isOrderId = orderId.is;
export const toOrderId = orderId.from;
