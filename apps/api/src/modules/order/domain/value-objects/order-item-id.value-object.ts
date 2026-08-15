import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type OrderItemId = Brand<string, 'OrderItemId'>;

const orderItemId = createIdType('OrderItemId');

export const isOrderItemId = orderItemId.is;
export const toOrderItemId = orderItemId.from;
