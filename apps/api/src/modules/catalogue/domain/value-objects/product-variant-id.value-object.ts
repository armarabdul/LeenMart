import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type ProductVariantId = Brand<string, 'ProductVariantId'>;

const productVariantId = createIdType('ProductVariantId');

export const isProductVariantId = productVariantId.is;
export const toProductVariantId = productVariantId.from;
