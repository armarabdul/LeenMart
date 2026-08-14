import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type CartItemId = Brand<string, 'CartItemId'>;

const cartItemId = createIdType('CartItemId');

export const isCartItemId = cartItemId.is;
export const toCartItemId = cartItemId.from;
