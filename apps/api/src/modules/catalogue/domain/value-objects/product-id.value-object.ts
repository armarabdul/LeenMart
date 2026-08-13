import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type ProductId = Brand<string, 'ProductId'>;

const productId = createIdType('ProductId');

export const isProductId = productId.is;
export const toProductId = productId.from;
