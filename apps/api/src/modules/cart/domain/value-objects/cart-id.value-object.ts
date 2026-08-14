import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type CartId = Brand<string, 'CartId'>;

const cartId = createIdType('CartId');

export const isCartId = cartId.is;
export const toCartId = cartId.from;
